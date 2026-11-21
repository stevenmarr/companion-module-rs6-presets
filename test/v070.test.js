'use strict';
// 0.7.0: knob actions driven by the Companion fork's $(this:delta), and the generated-pages refresh feedback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const X = require('../src/sys');
const { sysActions } = require('../src/sysdefs');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));

function fakeInst(S) {
  const sent = []; const logs = [];
  const inst = {
    sys: S, ptzCats: {}, log: (l, m) => logs.push([l, m]), optimistic() {}, runSys: async (l, fn) => fn(),
    api: { ptz: async (name, body) => { sent.push([name, body]); return { ok: true }; } },
    pulses: null,
  };
  // the real pulse helper, on the fake
  const { ControlCenterInstance } = loadMain();
  inst.ptzPulse = ControlCenterInstance.prototype.ptzPulse.bind(inst);
  return { inst, sent, logs };
}
// main.js calls runEntrypoint(); load it with a stub base so the class can be reached in a test
function loadMain() {
  const file = require.resolve('../src/main');
  if (loadMain.cache) return loadMain.cache;
  const real = require('@companion-module/base');
  const orig = Module._load;
  let Klass = null;
  Module._load = function (req, ...rest) {
    if (req === '@companion-module/base') return { ...real, runEntrypoint: (k) => { Klass = k; } };
    return orig.call(this, req, ...rest);
  };
  try { delete require.cache[file]; require(file); } finally { Module._load = orig; }
  loadMain.cache = { ControlCenterInstance: Klass };
  return loadMain.cache;
}

test('0.7.0 knob turn: $(this:delta) as Companion hands it over, else the fallback', () => {
  assert.equal(X.deltaOf('3', 1), 3); assert.equal(X.deltaOf('-2', 1), -2); assert.equal(X.deltaOf(4, 1), 4);
  assert.equal(X.deltaOf('', -1), -1); assert.equal(X.deltaOf('$NA', 1), 1); assert.equal(X.deltaOf('$(this:delta)', -1), -1); assert.equal(X.deltaOf(undefined, 0), 0);
  assert.equal(X.clampSpeed(0), 1); assert.equal(X.clampSpeed(80), 49); assert.equal(X.clampSpeed(12.4), 12);
});

test('0.7.0 knob actions: zoom runs then stops by itself, levels and lists step, session speeds change', async () => {
  const S = fixture(); const { inst, sent } = fakeInst(S); const A = sysActions(inst);
  await A.ptz_lens_delta.callback({ actionId: 'ptz_lens_delta', options: { cam: 'cam1', axis: 'zoom', delta: '3', fallback: 1, step: 8, pulse: 60 } }, {});
  assert.deepEqual(sent.shift(), ['zoom', { cam: 'cam1', dir: 24, speed: true }]);
  await A.ptz_lens_delta.callback({ options: { cam: 'cam1', axis: 'focus', delta: '-1', fallback: 1, step: 4, pulse: 60 } }, {});
  assert.deepEqual(sent.shift(), ['focus', { cam: 'cam1', dir: -4, speed: true }]);
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(sent.splice(0).map(([n, b]) => `${n} ${b.cam} ${b.axes}`).sort(), ['stop cam1 focus', 'stop cam1 zoom']);
  // detents re-arm the stop: one stop after a burst
  for (let i = 0; i < 3; i++) await A.ptz_lens_delta.callback({ options: { cam: 'cam1', axis: 'zoom', delta: '1', step: 8, pulse: 60 } }, {});
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.filter((x) => x[0] === 'stop').length, 1); sent.length = 0;
  // an unparsed $(this:delta) is parsed through the context, then the fallback
  await A.ptz_lens_delta.callback({ options: { cam: 'cam1', axis: 'zoom', delta: '$(this:delta)', fallback: -1, step: 8, pulse: 50 } }, { parseVariablesInString: async () => '$NA' });
  assert.deepEqual(sent.shift(), ['zoom', { cam: 'cam1', dir: -8, speed: true }]);
  await new Promise((r) => setTimeout(r, 90)); sent.length = 0;
  // a press-only run (no turn, fallback 0) sends nothing
  await A.ptz_lens_delta.callback({ options: { cam: 'cam1', axis: 'zoom', delta: '', fallback: 0 } }, {});
  assert.equal(sent.length, 0);
  // iris: a range level, stepped by the turn
  inst.ptzCats.cam1 = { ops: [{ id: 'iris', type: 'range', range: { min: 0, max: 255, step: 1, centre: 128 } }, { id: 'gain', type: 'list', options: [['08', '0dB'], ['09', '1dB'], ['0A', '2dB']] }] };
  const cam1 = X.camOf(S, 'cam1'); cam1.values = { ...(cam1.values || {}), iris: 100, gain: '08' };
  await A.ptz_level_delta.callback({ options: { cam: 'cam1', op: 'iris', delta: '-5', fallback: 1, scale: 2 } }, {});
  assert.deepEqual(sent.shift(), ['op', { cam: 'cam1', op: 'iris', value: 90 }], 'iris 100 - 5 detents x 2');
  await A.ptz_list_delta.callback({ options: { cam: 'cam1', op: 'gain', delta: '1', fallback: 1 } }, {});
  assert.deepEqual(sent.shift(), ['op', { cam: 'cam1', op: 'gain', value: '09' }]);
  // speeds: by the turn from the app's session speed, or set
  S.views.ptz.speeds = { pt: 25, zoom: 25, focus: 15 };
  await A.ptz_speed_delta.callback({ options: { which: 'pt', delta: '4', fallback: 1, mode: 'delta' } }, {});
  assert.deepEqual(sent.shift(), ['speeds', { pt: 29 }]); assert.equal(S.views.ptz.speeds.pt, 29);
  await A.ptz_speed_delta.callback({ options: { which: 'zoom', delta: '25', fallback: 25, mode: 'set' } }, {});
  assert.deepEqual(sent.shift(), ['speeds', { zoom: 25 }]);
  await A.ptz_speed_delta.callback({ options: { which: 'pt', delta: '90', mode: 'delta' } }, {});
  assert.deepEqual(sent.shift(), ['speeds', { pt: 49 }]);
});

test('0.7.0 / 0.8.1 cc_pages_refresh: evaluating publishes the presets again (once per burst), and never lights', async () => {
  const { ControlCenterInstance } = loadMain();
  const calls = [];
  const inst = Object.create(ControlCenterInstance.prototype);
  Object.assign(inst, { state: null, sys: fixture(), config: {}, deck: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-deck-0.32.0.json'), 'utf8')), ptzCats: {}, holds: new Map(), log() {}, setPresetDefinitions: (structure, presets) => calls.push(Object.keys(presets || structure).length) });
  Object.defineProperty(inst, 'label', { value: 'pvcc' });
  const fb = inst.feedbacks().cc_pages_refresh;
  assert.equal(fb.type, 'boolean'); assert.equal(fb.callback(), false); assert.deepEqual(fb.defaultStyle, {});
  assert.equal(fb.subscribe, undefined, 'module-base 2 has no subscribe');
  for (let i = 0; i < 20; i++) assert.equal(fb.callback({}), false);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(calls.length, 1); assert.ok(calls[0] > 100);
  if (inst.republishTimer) clearTimeout(inst.republishTimer);
});


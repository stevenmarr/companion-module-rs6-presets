'use strict';
// 0.6.0 PV Control Center, end to end: this module's actions -> the real Control Center app (sibling checkout, --mock)
// -> the app's device mocks (E2, PixelHue, ATEM, Panasonic PTZ) -> back through the app's long-poll to this module's
// variables and feedbacks. Every request the module makes must go to the app; it never addresses a device.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { spawn } = require('child_process');
const { AppApi } = require('../src/api');

function loadInstance() {
  class InstanceBase {
    constructor() { this.calls = { status: [], vars: {}, varDefs: [], presets: {}, actions: {}, feedbacks: {}, logs: [] }; this.label = 'rs6presets'; }
    updateStatus(s, m) { this.calls.status.push([s, m]); }
    setVariableDefinitions(d) { this.calls.varDefs = d; }
    setVariableValues(v) { Object.assign(this.calls.vars, v); }
    setPresetDefinitions(structure, presets) { this.calls.presets = presets || structure; }
    setActionDefinitions(a) { this.calls.actions = a; }
    setFeedbackDefinitions(f) { this.calls.feedbacks = f; }
    checkFeedbacks() {}
    log(l, m) { this.calls.logs.push([l, m]); }
  }
  const captured = {};
  const stub = { InstanceBase, InstanceStatus: { Ok: 'ok', Connecting: 'connecting', ConnectionFailure: 'connection_failure', BadConfig: 'bad_config', UnknownWarning: 'unknown_warning' }, Regex: { HOSTNAME: '/.*/' }, runEntrypoint: (C) => { captured.Cls = C; } };
  const orig = Module._load;
  Module._load = function (r, ...rest) { return r === '@companion-module/base' ? stub : orig.call(this, r, ...rest); };
  delete require.cache[require.resolve('../src/main.js')];
  require('../src/main.js');
  Module._load = orig;
  return new captured.Cls();
}
const until = async (fn, ms = 5000, what = 'condition') => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 30)); } throw new Error(`timed out: ${what}${last ? ` (${last.message})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP_DIR = process.env.RS6_APP_DIR || path.join(__dirname, '..', '..', 'rs6-presets');
const haveApp = fs.existsSync(path.join(APP_DIR, 'server.js')) && fs.existsSync(path.join(APP_DIR, 'lib', 'drivers', 'ptz-commands.js'));

test('e2e: module -> Control Center app (mock) -> E2 / PixelHue / ATEM / PTZ device mocks', { skip: haveApp ? false : `Control Center app 0.8.0 not found at ${APP_DIR}`, timeout: 90000 }, async (t) => {
  const port = 25000 + Math.floor(Math.random() * 4000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcc-'));
  const app = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), '--mock', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: 'ignore', env: { ...process.env, RS6_QUIET: '1' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const api = new AppApi('127.0.0.1', port, 5000);
  const views = async () => (await api.sysViews()).views;
  const status = (cam) => api._req('GET', `/api/sys/ptz/cameras/${cam}/status`); // fresh camdata read through the app
  await until(async () => { const v = await views(); return ['e2', 'pixelhue', 'atem'].every((k) => v[k] && v[k].status.connected) && v.ptz.cameras.every((c) => c.connected) && v.e2.presets.length && v.pixelhue.presets.length; }, 20000, 'app up, every mock connected');

  // record every request the module makes
  const seen = []; const origFetch = global.fetch;
  global.fetch = (u, o) => { seen.push(`${(o && o.method) || 'GET'} ${String(u)}`); return origFetch(u, o); };
  t.after(() => { global.fetch = origFetch; });

  const inst = loadInstance();
  t.after(() => inst.destroy());
  await inst.init({ host: '127.0.0.1', port, poll: 100, updates: 'longpoll', systems: 'on', max_hold: 4000 });
  const c = inst.calls; const A = (id, options = {}) => c.actions[id].callback({ options });
  const F = (id, options = {}) => c.feedbacks[id].callback({ options });
  await until(() => c.vars.e2_connected === 'true' && c.vars.atem_connected === 'true' && c.vars.ptz_selected, 10000, 'module sees every system');
  assert.ok(seen.some((s) => /\/api\/sys\?since=-?\d+&timeout=\d+&views=all$/.test(s)), 'multi-system long-poll');
  assert.ok(c.presets.e2_preset_1 && c.presets.pixelhue_preset_1 && c.presets.atem_pgm_1 && c.presets.ptz_cam_cam1, 'button presets for every system');

  await t.test('E2: recall, destinations, take, cue', async () => {
    await A('e2_set_destinations', { dests: 'S1,S2' });
    await until(() => F('e2_dest_selected', { dest: 'S2' }) && c.vars.e2_selection === 'S1,S2', 3000, 'E2 selection');
    await A('e2_toggle_destination', { dest: 'S2' });
    await until(() => !F('e2_dest_selected', { dest: 'S2' }), 3000, 'E2 toggle');
    await A('e2_recall_preset', { preset: 2, target: 'preview' });
    await until(async () => (await views()).e2.presets.find((p) => p.tile === 2).tally.pvw !== 'none', 5000, 'E2 preset 2 on preview (app)');
    await until(() => F('e2_preset_pvw', { preset: 2, partial: true }), 3000, 'E2 pvw feedback');
    await A('e2_take');
    await until(() => F('e2_preset_pgm', { preset: 2, partial: true }), 5000, 'E2 take -> program feedback');
    assert.equal(c.vars.e2_last_preset, '2');
    await A('e2_auto_take', { mode: 'on' }); await until(() => F('e2_auto_take_on'), 3000, 'E2 auto take'); await A('e2_auto_take', { mode: 'off' });
    await A('e2_cue', { cue: 0, op: 'play' });
  });

  await t.test('PixelHue: recall and cut', async () => {
    await A('pixelhue_set_destinations', { dests: 'S1' });
    await until(() => F('pixelhue_dest_selected', { dest: 'S1' }), 3000, 'PixelHue selection');
    await A('pixelhue_recall_preset', { preset: 1, target: 'preview' });
    await until(() => F('pixelhue_preset_pvw', { preset: 1, partial: true }), 5000, 'PixelHue pvw');
    await A('pixelhue_cut');
    await until(() => F('pixelhue_preset_pgm', { preset: 1, partial: true }), 5000, 'PixelHue cut');
  });

  await t.test('ATEM: buses, cut/auto, keys, aux, macros, FTB', async () => {
    await A('atem_program', { source: 2 }); await A('atem_preview', { source: 3 });
    await until(() => F('atem_program_is', { source: 2 }) && F('atem_preview_is', { source: 3 }), 3000, 'ATEM buses');
    assert.equal((await views()).atem.program, 2, 'the ATEM mock reports the new program source');
    await A('atem_cut');
    await until(() => F('atem_program_is', { source: 3 }) && c.vars.atem_program_id === '3', 3000, 'ATEM cut');
    await A('atem_style', { style: 'MIX' }); await A('atem_mix_rate', { rate: 10 });
    await A('atem_auto');
    await until(() => F('atem_program_is', { source: 2 }), 5000, 'ATEM auto finished');
    await A('atem_usk_onair', { key: 0, mode: 'toggle' }); await until(() => F('atem_usk', { key: 0, what: 'onair' }), 3000, 'USK 1 on air');
    await A('atem_usk_onair', { key: 0, mode: 'off' }); await until(() => !F('atem_usk', { key: 0, what: 'onair' }), 3000, 'USK 1 off');
    await A('atem_dsk_onair', { key: 1, mode: 'on' }); await until(() => F('atem_dsk', { key: 1, what: 'onair' }), 3000, 'DSK 2 on air');
    await A('atem_dsk_tie', { key: 0, mode: 'on' }); await until(() => F('atem_dsk', { key: 0, what: 'tie' }), 3000, 'DSK 1 tie');
    await A('atem_aux', { aux: 1, source: 4 }); await until(() => F('atem_aux_is', { aux: 1, source: 4 }), 3000, 'aux 2 source');
    assert.equal(c.vars.atem_aux_2, (await views()).atem.inputs.find((i) => i.id === 4).short);
    await A('atem_macro_run', { macro: 0 }); await A('atem_macro_stop');
    await A('atem_ftb'); await until(() => F('atem_ftb_active'), 4000, 'FTB');
  });

  await t.test('PTZ: select, hold to move with keep-alive, stop on release, lens, paint, presets, power, tally', async () => {
    await A('ptz_select_camera', { cam: 'cam2' });
    await until(() => c.vars.ptz_selected === 'cam2' && F('ptz_selected', { cam: 'cam2' }), 3000, 'cam2 selected');
    const tilt0 = (await status('cam2')).pos.tilt;
    await A('ptz_move', { cam: 'selected', dir: 'up', speed: 30 });
    await sleep(2200); // longer than the app's 1500 ms dead-man: only the module's keep-alives keep it moving
    let cam2 = (await views()).ptz.cameras.find((x) => x.id === 'cam2');
    assert.equal(cam2.axes.pt, true, 'still moving while held');
    assert.ok(seen.filter((s) => s.endsWith('/api/sys/ptz/cmd/keepalive')).length >= 3, 'keep-alives while held');
    await A('ptz_stop', { cam: 'selected', axes: 'pt' });
    await until(async () => !(await views()).ptz.cameras.find((x) => x.id === 'cam2').axes.pt, 2000, 'stopped on release');
    cam2 = await status('cam2');
    assert.ok(cam2.pos.tilt > tilt0, `tilted up in the camera mock (${tilt0} -> ${cam2.pos.tilt})`);
    const n = seen.filter((s) => s.endsWith('/keepalive')).length; await sleep(700);
    assert.equal(seen.filter((s) => s.endsWith('/keepalive')).length, n, 'no keep-alives after release');
    // max hold: a lost release still stops
    await A('ptz_zoom', { cam: 'cam1', dir: 'tele', speed: 20 });
    await until(async () => (await views()).ptz.cameras.find((x) => x.id === 'cam1').axes.z, 2000, 'zooming');
    await until(async () => !(await views()).ptz.cameras.find((x) => x.id === 'cam1').axes.z, 8000, 'max hold stopped the zoom');
    assert.ok(c.logs.some(([l, m]) => l === 'warn' && /held for more than 4000 ms/.test(m)));
    await A('ptz_focus', { cam: 'cam1', dir: 'near', speed: 0 }); await A('ptz_stop', { cam: 'cam1', axes: 'all' });
    // exposure / paint through the catalog ops
    await A('ptz_toggle', { cam: 'cam1', op: 'irisMode', mode: 'off' });
    await until(() => c.vars.ptz_cam1_iris_mode === 'MANUAL', 3000, 'manual iris');
    const iris0 = Number(c.vars.ptz_cam1_iris);
    await A('ptz_adjust', { cam: 'cam1', op: 'iris', mode: 'inc', value: 5 });
    await until(async () => (await views()).ptz.cameras.find((x) => x.id === 'cam1').values.iris === iris0 + 5, 3000, 'iris +5 on the camera mock');
    await A('ptz_set', { cam: 'cam1', op: 'gain', value: '0A' }); await until(() => c.vars.ptz_cam1_gain === '2dB', 3000, 'gain 2dB');
    await A('ptz_step', { cam: 'cam1', op: 'gain', dir: 'up' }); await until(() => c.vars.ptz_cam1_gain === '3db', 3000, 'gain up');
    await A('ptz_set', { cam: 'cam1', op: 'wbMode', value: '1' }); await until(() => F('ptz_value', { cam: 'cam1', op: 'wbMode', value: '1' }), 3000, 'WB AWB A');
    await A('ptz_exec', { cam: 'cam1', op: 'awb' }); await A('ptz_exec', { cam: 'cam1', op: 'abb' });
    await A('ptz_adjust', { cam: 'cam1', op: 'rGain', mode: 'set', value: 12 });
    await until(async () => (await views()).ptz.cameras.find((x) => x.id === 'cam1').values.rGain === 12, 3000, 'R gain 12');
    await A('ptz_adjust', { cam: 'cam1', op: 'bPed', mode: 'dec', value: 3 });
    await until(async () => (await views()).ptz.cameras.find((x) => x.id === 'cam1').values.bPed === -3, 3000, 'B ped -3');
    // presets
    await A('ptz_preset_store', { cam: 'cam1', preset: 5, name: 'Lectern' });
    await until(() => c.vars.ptz_cam1_preset_5_name === 'Lectern', 3000, 'preset name variable');
    await A('ptz_preset_recall', { cam: 'cam1', preset: 5, speed: '750' });
    await until(() => F('ptz_last_preset', { cam: 'cam1', preset: 5 }), 3000, 'last preset feedback');
    // tally and power
    await A('ptz_tally', { cam: 'cam1', color: 'red', mode: 'on' }); await until(() => F('ptz_tally', { cam: 'cam1', color: 'red' }), 3000, 'red tally');
    await A('ptz_tally', { cam: 'cam1', color: 'red', mode: 'toggle' }); await until(() => !F('ptz_tally', { cam: 'cam1', color: 'red' }), 3000, 'red tally off');
    await A('ptz_power', { cam: 'cam3', mode: 'off' }); await until(() => !F('ptz_power_on', { cam: 'cam3' }), 4000, 'cam3 standby');
    await A('ptz_power', { cam: 'cam3', mode: 'toggle' }); await until(() => F('ptz_power_on', { cam: 'cam3' }), 4000, 'cam3 on');
    // OSD menu
    await A('ptz_toggle', { cam: 'cam1', op: 'menu', mode: 'on' }); await until(() => F('ptz_on', { cam: 'cam1', op: 'menu' }), 3000, 'menu on');
    await A('ptz_exec', { cam: 'cam1', op: 'menuDown' }); await A('ptz_exec', { cam: 'cam1', op: 'menuEnter' }); await A('ptz_toggle', { cam: 'cam1', op: 'menu', mode: 'off' });
    await A('ptz_stop_all');
  });

  const errors = c.logs.filter(([l]) => l === 'error');
  assert.deepEqual(errors, [], 'no failed actions');
  const base = `http://127.0.0.1:${port}/`;
  assert.deepEqual(seen.filter((s) => !s.split(' ')[1].startsWith(base)), [], 'every request went to the Control Center app');
  assert.ok(!seen.some((s) => /\/api\/(presets|take|cut|selection)/.test(s.split(' ')[1].slice(base.length - 1))), 'no RS6 command sent by the other systems');
});

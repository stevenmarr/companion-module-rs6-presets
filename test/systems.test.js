'use strict';
// 0.6.0 PV Control Center: E2 / PixelHue / ATEM / PTZ helpers, against a multi-system state captured from the
// Control Center app 0.8.0 in mock mode (GET /api/sys?since=0&views=all).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../src/sys');
const L = require('../src/logic');
const { sysActions, sysFeedbacks } = require('../src/sysdefs');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));
const fakeInst = (S) => ({ sys: S, ptzCats: {}, api: {}, log() {}, runSys: async (l, fn) => fn(), ptzHold() {}, ptzRelease() {}, ptzReleaseAll() {}, optimistic() {} });

test('systems: variables for E2, PixelHue, ATEM and PTZ; definitions cover every value', () => {
  const S = fixture();
  const defs = X.variableDefinitions(S).map((d) => d.variableId); const vals = X.variableValues(S);
  assert.equal(new Set(defs).size, defs.length, 'variable ids unique');
  for (const k of Object.keys(vals)) assert.ok(defs.includes(k), `definition for ${k}`);
  assert.equal(vals.e2_connected, 'true'); assert.equal(vals.atem_connected, 'true');
  assert.equal(vals.e2_tile_1_name, 'Walk-in'); assert.equal(vals.e2_last_preset_name, 'Walk-in'); assert.equal(vals.e2_S1_pvw, 'Walk-in');
  assert.equal(vals.e2_selection, S.views.e2.selection.join(','));
  assert.equal(vals.pixelhue_tile_1_name, 'Opener');
  assert.equal(vals.atem_program, 'CAM1'); assert.equal(vals.atem_preview, 'CAM2'); assert.equal(vals.atem_program_name, 'Cam 1 Wide');
  assert.equal(vals.atem_aux_1, X.atemName(S, S.views.atem.aux[0].source));
  assert.equal(vals.ptz_selected, 'cam1'); assert.equal(vals.ptz_sel_name, 'Cam 1 Wide'); assert.equal(vals.ptz_cam1_model, 'AW-UE150');
  assert.equal(vals.ptz_cam1_preset_2_name, 'Pulpit'); assert.equal(vals.ptz_cam1_preset_3_name, 'P3');
  assert.equal(vals.ptz_cam1_last_preset, '2'); assert.equal(vals.ptz_cam1_gain, '0dB'); assert.equal(vals.ptz_cam1_iris_mode, 'AUTO');
  assert.equal(vals.systems_connected.split(',').sort().join(','), 'atem,e2,pixelhue,ptz');
});

test('systems: feedbacks read the app views (tally, selection, ATEM buses/keys/aux/macros, PTZ state)', () => {
  const S = fixture();
  const p1 = S.views.e2.presets.find((p) => p.tile === 1);
  assert.equal(X.xTally(S, 'e2', 1, 'pvw', true), p1.tally.pvw !== 'none');
  assert.equal(X.xDestSelected(S, 'e2', 'S1'), S.views.e2.selection.includes('S1'));
  assert.equal(X.atemFeedback(S, 'program', { source: S.views.atem.program }), true);
  assert.equal(X.atemFeedback(S, 'preview', { source: S.views.atem.program }), false);
  assert.equal(X.atemFeedback(S, 'aux', { aux: 0, source: S.views.atem.aux[0].source }), true);
  assert.equal(X.atemFeedback(S, 'macro', { macro: 'any' }), false);
  assert.equal(X.atemFeedback(S, 'style', { style: S.views.atem.nextStyle }), true);
  assert.equal(X.ptzFeedback(S, 'selected', { cam: 'cam1' }), true);
  assert.equal(X.ptzFeedback(S, 'selected', { cam: 'cam2' }), false);
  assert.equal(X.ptzFeedback(S, 'power', { cam: 'selected' }), true);
  assert.equal(X.ptzFeedback(S, 'preset', { cam: 'cam1', preset: 2 }), true);
  assert.equal(X.ptzFeedback(S, 'on', { cam: 'cam1', op: 'irisMode' }), true);
  assert.equal(X.ptzFeedback(S, 'value', { cam: 'cam1', op: 'gain', value: '08' }), true);
  // no data: nothing lights, nothing throws
  for (const k of ['program', 'usk', 'dsk', 'aux', 'macro', 'ftb']) assert.equal(X.atemFeedback(null, k, {}), false);
  assert.equal(X.ptzFeedback(null, 'tally', { cam: 'selected' }), false);
  assert.deepEqual(X.variableDefinitions(null).map((d) => d.variableId), ['active_system', 'systems_connected']);
});

test('systems: PTZ bodies, steps and the full command set', () => {
  assert.deepEqual(X.moveBody('cam1', 'upLeft', 0), { cam: 'cam1', pan: -1, tilt: 1 });
  assert.deepEqual(X.moveBody('cam1', 'right', 30), { cam: 'cam1', pan: 30, tilt: 0, speed: true });
  assert.deepEqual(X.moveBody('cam1', 'down', 99), { cam: 'cam1', pan: 0, tilt: -49, speed: true });
  assert.deepEqual(X.lensBody('cam1', 'wide', 0), { cam: 'cam1', dir: -1 });
  assert.deepEqual(X.lensBody('cam1', 'far', 12), { cam: 'cam1', dir: 12, speed: true });
  const rGain = X.OP_BY_ID.get('rGain');
  assert.equal(X.stepRange(rGain, 198, 4), 200); assert.equal(X.stepRange(rGain, -10, -4), -14);
  const gain = X.OP_BY_ID.get('gain');
  assert.equal(X.stepList(gain, '08', 1), '09'); assert.equal(X.stepList(gain, '08', -1), '80');
  // every catalog command type has a generic action, and the app's 71 commands are all reachable
  const S = fixture(); const acts = sysActions(fakeInst(S));
  const reach = new Set(['ptz_exec', 'ptz_toggle', 'ptz_set', 'ptz_step', 'ptz_adjust'].flatMap((id) => acts[id].options.find((o) => o.id === 'op').choices.map((c) => c.id)));
  for (const o of X.OPS) assert.ok(reach.has(o.id), `PTZ command ${o.id} reachable from an action`);
  assert.ok(X.OPS.length >= 70);
});

test('systems: action and feedback ids are prefixed; RS6 ids are untouched', () => {
  const S = fixture(); const inst = fakeInst(S);
  const acts = Object.keys(sysActions(inst)); const fbs = Object.keys(sysFeedbacks(inst));
  for (const id of [...acts, ...fbs]) assert.match(id, /^(sys|e2|pixelhue|atem|ptz)_/, id);
  for (const id of ['recall_preset', 'take', 'cut', 'toggle_destination', 'auto_take', 'preset_pvw', 'preset_pgm', 'dest_selected']) assert.ok(!acts.includes(id) && !fbs.includes(id), `${id} stays the RS6 one`);
  for (const id of ['e2_recall_preset', 'e2_take', 'e2_cut', 'e2_cue', 'pixelhue_recall_preset', 'atem_program', 'atem_preview', 'atem_cut', 'atem_auto', 'atem_ftb', 'atem_usk_onair', 'atem_dsk_onair', 'atem_aux', 'atem_macro_run',
    'ptz_select_camera', 'ptz_move', 'ptz_zoom', 'ptz_focus', 'ptz_stop', 'ptz_preset_recall', 'ptz_preset_store', 'ptz_adjust', 'ptz_power', 'ptz_tally']) assert.ok(acts.includes(id), id);
});

test('ATEM output feedback: M/E program / preview come from mixEffects when the app lists them as buses (app 0.11.0+)', () => {
  const S = { views: { atem: { outputs: [{ key: 'aux:0', source: 3 }], mixEffects: [{ index: 0, program: 1, preview: 2 }, { index: 1, program: 4, preview: 6 }] } } };
  assert.equal(X.atemFeedback(S, 'output', { output: 'aux:0', source: 3 }), true);
  assert.equal(X.atemFeedback(S, 'output', { output: 'aux:0', source: 4 }), false);
  assert.equal(X.atemFeedback(S, 'output', { output: 'me:1:preview', source: 6 }), true);
  assert.equal(X.atemFeedback(S, 'output', { output: 'me:1:program', source: 6 }), false);
  assert.equal(X.atemFeedback(S, 'output', { output: 'me:0:program', source: 1 }), true);
  assert.equal(X.atemFeedback(S, 'output', { output: 'me:5:program', source: 1 }), false);
  assert.equal(X.atemFeedback(S, 'output', { output: 'mv:0:1', source: 1 }), false);
  // an app that still lists the M/E buses as outputs wins
  const old = { views: { atem: { outputs: [{ key: 'me:1:preview', source: 9 }], mixEffects: [{ index: 1, preview: 6 }] } } };
  assert.equal(X.atemFeedback(old, 'output', { output: 'me:1:preview', source: 9 }), true);
});

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
const isPng72 = (b64) => { const b = Buffer.from(b64, 'base64'); return b.slice(1, 4).toString() === 'PNG' && b.readUInt32BE(16) === 72 && b.readUInt32BE(20) === 72; };
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

test('systems: action and feedback ids are prefixed; RS6 ids are untouched; presets are styled', () => {
  const S = fixture(); const inst = fakeInst(S);
  const acts = Object.keys(sysActions(inst)); const fbs = Object.keys(sysFeedbacks(inst));
  for (const id of [...acts, ...fbs]) assert.match(id, /^(sys|e2|pixelhue|atem|ptz)_/, id);
  for (const id of ['recall_preset', 'take', 'cut', 'toggle_destination', 'auto_take', 'preset_pvw', 'preset_pgm', 'dest_selected']) assert.ok(!acts.includes(id) && !fbs.includes(id), `${id} stays the RS6 one`);
  for (const id of ['e2_recall_preset', 'e2_take', 'e2_cut', 'e2_cue', 'pixelhue_recall_preset', 'atem_program', 'atem_preview', 'atem_cut', 'atem_auto', 'atem_ftb', 'atem_usk_onair', 'atem_dsk_onair', 'atem_aux', 'atem_macro_run',
    'ptz_select_camera', 'ptz_move', 'ptz_zoom', 'ptz_focus', 'ptz_stop', 'ptz_preset_recall', 'ptz_preset_store', 'ptz_adjust', 'ptz_power', 'ptz_tally']) assert.ok(acts.includes(id), id);
  const p = X.buttonPresets(S);
  const fam = { e2: p.e2_preset_1, pixelhue: p.pixelhue_preset_1, atem: p.atem_pgm_1, ptz: p.ptz_cam_cam1 };
  for (const [f, b] of Object.entries(fam)) { assert.ok(b, f); assert.equal(b.style.png64, L.BG[f], `${f} family background`); }
  assert.equal(new Set(Object.values(fam).map((b) => b.style.png64)).size, 4, 'four distinct family looks');
  for (const [id, b] of Object.entries(p)) {
    assert.equal(b.style.size, L.TEXT_SIZE, `${id} text size`);
    assert.ok(b.style.png64 && isPng72(b.style.png64), `${id} background`);
    for (const s of b.steps) for (const a of [...s.down, ...s.up]) assert.ok(acts.includes(a.actionId), `${id} uses ${a.actionId}`);
    for (const f of b.feedbacks) { assert.ok(fbs.includes(f.feedbackId), `${id} uses ${f.feedbackId}`); if (f.style.bgcolor !== undefined) assert.ok(isPng72(f.style.png64), `${id} ${f.feedbackId} lit`); }
  }
  // hold-to-run presets stop on release
  for (const id of ['ptz_move_up', 'ptz_move_downLeft', 'ptz_tele', 'ptz_near']) assert.equal(p[id].steps[0].up[0].actionId, 'ptz_stop', id);
  // the text variables they show exist
  const defs = new Set([...X.variableDefinitions(S).map((d) => d.variableId)]);
  for (const [id, b] of Object.entries(p)) for (const m of String(b.style.text).matchAll(/\$\(rs6presets:(\w+)\)/g)) assert.ok(defs.has(m[1]), `${id}: $(rs6presets:${m[1]})`);
});

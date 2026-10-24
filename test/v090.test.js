'use strict';
// 0.9.0: Stream Deck as the primary live PTZ surface (design note 10-streamdeck-ptz.md).
// Deck presets (LIVE / PAINT / FUNCTIONS / MOVE), guarded recall, hold-to-repeat, dial fine/coarse,
// ramped hold, cycles, and brand layered graphics. Needs Control Center app 0.12.0 (ptzLiveGuard,
// ptzDeckFunctions). Every command goes through the app; nothing talks to a camera.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');
const X = require('../src/sys');
const G = require('../src/graphics');
const Deck = require('../src/deck');
const { sysActions, sysFeedbacks } = require('../src/sysdefs');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));
const APP = path.join(__dirname, '..', '..', 'rs6-presets');
const haveApp = fs.existsSync(path.join(APP, 'server.js'));

function fakeInst(S) {
  const sent = []; const logs = []; const vars = {}; const checked = [];
  const inst = {
    sys: S, ptzCats: {}, log: (l, m) => logs.push([l, m]), optimistic(cam, op, v) { const c = X.camOf(inst.sys, cam); if (c && c.values) c.values[op] = v; },
    runSys: async (l, fn) => fn(),
    api: {
      ptz: async (name, body) => {
        if (name === 'recall' && body.guarded && !body.confirmed) {
          const c = X.camOf(inst.sys, body.cam);
          const g = (inst.sys.views.ptz.liveGuard) || { mode: 'hold', holdMs: 600 };
          if (c && c.tally && g.mode === 'lock') throw new Error('cam1 is live: recall locked (live guard LOCK)');
          if (c && c.tally && g.mode === 'hold') throw new Error('hold the preset key 600 ms to recall (live guard HOLD)');
        }
        if (name === 'guard') {
          const cur = inst.sys.views.ptz.liveGuard || { mode: 'hold', holdMs: 600 };
          const order = ['off', 'hold', 'lock'];
          const mode = body.mode === 'cycle' ? order[(order.indexOf(cur.mode) + 1) % 3] : body.mode;
          const liveGuard = { mode, holdMs: cur.holdMs };
          inst.sys.views.ptz.liveGuard = liveGuard;
          sent.push([name, body]);
          return { ok: true, liveGuard };
        }
        sent.push([name, body]); return { ok: true };
      },
    },
    setVariableValues: (v) => Object.assign(vars, v),
    checkFeedbacks: (...ids) => checked.push(ids),
    ptzHold: async () => {}, ptzPulse: async () => {}, ptzRelease: async () => {},
  };
  inst.deck = new Deck.DeckRuntime(inst);
  return { inst, sent, logs, vars, checked };
}

test('0.9.0 deck presets: cameras, guarded presets, paint ±, functions, dials, move', () => {
  const S = fixture();
  S.views.ptz.liveGuard = { mode: 'hold', holdMs: 600 };
  const P = X.buttonPresets(S);
  const need = [
    'deck_cam_cam1', 'deck_cam_next', 'deck_sel_preset_1', 'deck_sel_preset_18',
    'deck_iris_up', 'deck_iris_down', 'deck_mped_up', 'deck_gain_up', 'deck_wb', 'deck_nd', 'deck_awb', 'deck_iris_auto',
    'deck_fn_tally', 'deck_fn_power', 'deck_fn_af', 'deck_fn_otaf', 'deck_fn_ois', 'deck_fn_bars', 'deck_fn_dext',
    'deck_fn_freeze', 'deck_fn_pspeed', 'deck_fn_autoiris', 'deck_fn_drs', 'deck_fn_night', 'deck_guard',
    'deck_move_up', 'deck_tele', 'deck_home', 'deck_stop_all',
    'deck_dial_iris', 'deck_strip_iris', 'deck_dial_mped', 'deck_dial_gain_rb', 'deck_dial_ped_rb', 'deck_dial_zoom', 'deck_dial_focus',
  ];
  for (const id of need) assert.ok(P[id], id);
  // guarded recall on DOWN / UP
  const r = P.deck_sel_preset_1;
  assert.equal(r.steps[0].down[0].actionId, 'deck_recall');
  assert.equal(r.steps[0].up[0].actionId, 'deck_recall');
  assert.equal(r.steps[0].down[0].options.phase, 'down');
  // paint ± repeats while held
  assert.equal(P.deck_iris_up.steps[0].down[0].actionId, 'deck_repeat');
  assert.equal(P.deck_iris_up.steps[0].up[0].options.phase, 'up');
  // functions cycle / toggle
  assert.equal(P.deck_fn_drs.steps[0].down[0].actionId, 'deck_cycle');
  assert.equal(P.deck_fn_tally.steps[0].down[0].options.op, 'tallyRed');
  // dial: rotary + push fine/coarse; strip tap = A/M
  assert.equal(P.deck_dial_iris.options.rotaryActions, true);
  assert.equal(P.deck_dial_iris.steps[0].down[0].actionId, 'deck_fine');
  assert.equal(P.deck_dial_iris.steps[0].rotate_right[0].actionId, 'deck_dial');
  assert.equal(P.deck_strip_iris.steps[0].down[0].actionId, 'ptz_toggle');
  // brand
  assert.equal(P.deck_cam_cam1.brand.kind, 'cam');
  assert.equal(P.deck_stop_all.brand.bg, 0xc42020);
});

test('0.9.0 brand layered: black/#121212 keys, white frame for selected, red accent', () => {
  const S = fixture();
  const P = X.buttonPresets(S);
  const pub = G.publishPresets({ cam: P.deck_cam_cam1, iris: P.deck_iris_up, fn: P.deck_fn_tally, stop: P.deck_stop_all });
  const cam = pub.presets.cam.variants[0];
  assert.equal(cam.type, 'layered');
  assert.equal(cam.elements.find((e) => e.id === 'bg').color, 0x121212);
  assert.equal(cam.elements.find((e) => e.id === 'frame').borderWidth, 7);
  const sel = cam.feedbacks.find((f) => f.feedbackId === 'ptz_selected');
  assert.ok(sel.styleOverrides.some((o) => o.elementId === 'frame' && o.elementProperty === 'borderColor' && o.override === 0xf5f5f5));
  const tally = cam.feedbacks.find((f) => f.feedbackId === 'ptz_tally');
  assert.ok(tally.styleOverrides.some((o) => o.elementId === 'bg' && o.override === 0xc42020));
  assert.equal(pub.presets.stop.variants[0].elements.find((e) => e.id === 'bg').color, 0xc42020);
  // house sizes: caption at SIZE.tag (15), name at SIZE.name (21)
  const tag = cam.elements.find((e) => e.id === 'tag');
  assert.equal(tag.font, 'companion-mono');
  assert.equal(tag.weight, 'bold');
});

test('0.9.0 deck actions and feedbacks are registered', () => {
  const S = fixture();
  const { inst } = fakeInst(S);
  const A = sysActions(inst); const F = sysFeedbacks(inst);
  for (const id of ['deck_recall', 'deck_repeat', 'deck_cycle', 'deck_dial', 'deck_fine', 'deck_ramp', 'deck_guard', 'deck_select_next']) {
    assert.ok(A[id], id);
  }
  for (const id of ['ptz_active', 'deck_live_guarded', 'deck_arming', 'deck_guard_is', 'deck_fine']) assert.ok(F[id], id);
});

test('0.9.0 guarded recall: hold then confirm, lock refuses, off recalls at once', async () => {
  const S = fixture();
  S.views.ptz.cameras[0].tally = true;
  S.views.ptz.liveGuard = { mode: 'hold', holdMs: 40 };
  const { inst, sent, vars } = fakeInst(S);
  await inst.deck.recall('cam1', 3, 'down');
  assert.equal(sent.length, 0, 'not recalled yet');
  assert.equal(inst.deck.isArming('cam1', 3), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], ['recall', { cam: 'cam1', preset: 3, guarded: true, confirmed: true }]);
  // lock
  sent.length = 0; S.views.ptz.liveGuard = { mode: 'lock', holdMs: 40 };
  await inst.deck.recall('cam1', 4, 'down');
  assert.equal(sent.length, 0);
  assert.match(vars.deck_msg || '', /LOCKED/);
  // off
  S.views.ptz.liveGuard = { mode: 'off', holdMs: 40 };
  await inst.deck.recall('cam1', 5, 'down');
  assert.deepEqual(sent[0], ['recall', { cam: 'cam1', preset: 5, guarded: true }]);
});

test('0.9.0 hold-to-repeat and cycle', async () => {
  const S = fixture();
  S.views.ptz.cameras[0].values = { ...(S.views.ptz.cameras[0].values || {}), iris: 50, irisMode: true, drs: '0', wbMode: '0' };
  const { inst, sent } = fakeInst(S);
  inst.ptzCats.cam1 = { ops: [
    { id: 'iris', type: 'range', range: { min: 1, max: 99, step: 1 } },
    { id: 'drs', type: 'list', options: [['0', 'OFF'], ['1', 'LOW'], ['2', 'MID'], ['3', 'HIGH']] },
    { id: 'wbMode', type: 'list', options: [['0', 'ATW'], ['1', 'AWC A'], ['4', '3200K']] },
  ] };
  await inst.deck.repeat('cam1', 'iris', 1, 'down', 1, 20, 15);
  assert.equal(sent[0][0], 'op');
  assert.equal(sent[0][1].value, 51);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.length >= 2, 'repeated');
  await inst.deck.repeat('cam1', 'iris', 1, 'up');
  sent.length = 0;
  await inst.deck.cycle('cam1', 'drs', '');
  assert.equal(sent[0][1].value, '1');
  assert.equal(Deck.isActive(S, inst.ptzCats, 'cam1', 'drs'), true);
  await inst.deck.cycle('cam1', 'wbMode', '0,1,4');
  assert.equal(sent[1][1].value, '1');
});

test('0.9.0 dial fine/coarse and guard cycle', async () => {
  const S = fixture();
  S.views.ptz.cameras[0].values = { iris: 40 };
  S.views.ptz.liveGuard = { mode: 'hold', holdMs: 600 };
  const { inst, sent, vars } = fakeInst(S);
  inst.ptzCats.cam1 = { ops: [{ id: 'iris', type: 'range', range: { min: 1, max: 99, step: 1 } }] };
  assert.equal(inst.deck.vars().deck_iris_fine, 'FINE');
  await inst.deck.dial('cam1', 'iris', 1);
  assert.equal(sent[0][1].value, 41); // fine: 1
  inst.deck.setFine('iris', 'coarse');
  assert.equal(vars.deck_iris_fine, 'COARSE');
  await inst.deck.dial('cam1', 'iris', 1);
  assert.equal(sent[1][1].value, 46); // coarse: 5
  await inst.deck.guard('cycle');
  assert.equal(S.views.ptz.liveGuard.mode, 'lock');
  await inst.deck.guard('cycle');
  assert.equal(S.views.ptz.liveGuard.mode, 'off');
});

test('0.9.0 multi-step R/B gain dial: push cycles axis × fine/coarse', async () => {
  const S = fixture();
  S.views.ptz.cameras[0].values = { rGain: 10, bGain: -4 };
  const { inst, sent, vars } = fakeInst(S);
  inst.ptzCats.cam1 = { ops: [
    { id: 'rGain', type: 'range', range: { min: -200, max: 200, step: 1, centre: 0 } },
    { id: 'bGain', type: 'range', range: { min: -200, max: 200, step: 1, centre: 0 } },
  ] };
  assert.equal(inst.deck.vars().deck_gain_rb_axis, 'R');
  assert.equal(inst.deck.vars().deck_gain_rb_fine, 'FINE');
  await inst.deck.dial('cam1', 'gain_rb', 1);
  assert.equal(sent[0][1].op, 'rGain');
  assert.equal(sent[0][1].value, 11);
  inst.deck.setFine('gain_rb', 'toggle'); // R·COARSE
  assert.equal(vars.deck_gain_rb_axis, 'R');
  assert.equal(vars.deck_gain_rb_fine, 'COARSE');
  await inst.deck.dial('cam1', 'gain_rb', 1);
  assert.equal(sent[1][1].op, 'rGain');
  assert.equal(sent[1][1].value, 16);
  inst.deck.setFine('gain_rb', 'toggle'); // B·FINE
  assert.equal(vars.deck_gain_rb_axis, 'B');
  assert.equal(vars.deck_gain_rb_fine, 'FINE');
  await inst.deck.dial('cam1', 'gain_rb', 1);
  assert.equal(sent[2][1].op, 'bGain');
  assert.equal(sent[2][1].value, -3);
  const P = require('../src/sys').buttonPresets(S);
  assert.ok(P.deck_dial_gain_rb);
  assert.equal(P.deck_dial_gain_rb.steps[0].down[0].actionId, 'deck_fine');
  assert.match(P.deck_dial_gain_rb.brand.main, /deck_gain_rb_readout/);
  assert.match(P.deck_dial_gain_rb.brand.value, /deck_gain_rb_axis/);
});

test('0.9.0 variables cover paint and function values for the selected camera', () => {
  const S = fixture();
  S.views.ptz.liveGuard = { mode: 'hold', holdMs: 600 };
  S.views.ptz.cameras[0].tally = true;
  S.views.ptz.cameras[0].values = { rGain: 10, bGain: -4, gamma: 45, chromaLevel: 12, kneePoint: 85, drs: '2', dayNight: true, freezePreset: false, ois: true, dExtender: '1', presetSpeed: '999' };
  S.views.ptz.selected = 'cam1';
  const cats = { cam1: { ops: [
    { id: 'rGain', type: 'range', range: { min: -200, max: 200, step: 1 } },
    { id: 'bGain', type: 'range', range: { min: -200, max: 200, step: 1 } },
    { id: 'gamma', type: 'range', range: { min: 0, max: 100, step: 1 } },
    { id: 'chromaLevel', type: 'range', range: { min: -100, max: 100, step: 1 } },
    { id: 'kneePoint', type: 'range', range: { min: 0, max: 100, step: 0.01 } },
    { id: 'drs', type: 'list', options: [['0', 'OFF'], ['1', 'LOW'], ['2', 'MID'], ['3', 'HIGH']] },
  ] } };
  const v = X.variableValues(S, cats);
  assert.equal(v.deck_guard, 'HOLD');
  assert.equal(v.ptz_sel_r_gain, '+10');
  assert.equal(v.ptz_sel_b_gain, '-4');
  assert.equal(v.ptz_sel_gamma, '0.45');
  assert.equal(v.ptz_sel_chroma, '+12%');
  assert.equal(v.ptz_sel_knee, '85.00%');
  assert.equal(v.ptz_sel_drs, 'MID'); // from generated ops options when no cam catalog... may be empty without cat
  assert.equal(v.ptz_cam1_recall_hint, 'HOLD');
  assert.equal(v.ptz_cam1_deck_state, 'LIVE · SEL');
  assert.ok(v.ptz_sel_preset_1_name);
});

test('0.9.0 e2e: deck actions through the mock app (guard, DRS, night, freeze)', { skip: haveApp ? false : 'app missing', timeout: 60000 }, async (t) => {
  const { spawn } = require('child_process');
  const os = require('os');
  const port = 26000 + Math.floor(Math.random() * 3000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcc-deck-'));
  const app = spawn(process.execPath, [path.join(APP, 'server.js'), '--mock', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: 'ignore', env: { ...process.env, RS6_QUIET: '1' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const { AppApi } = require('../src/api');
  const api = new AppApi('127.0.0.1', port, 5000);
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch {} await new Promise((r) => setTimeout(r, 40)); } throw new Error('timeout'); };
  await until(async () => { const v = await api.sysViews(); return v.views && v.views.ptz && v.views.ptz.cameras.some((c) => c.connected); });
  const ver = await api.version();
  assert.ok((ver.features || []).includes('ptzLiveGuard'), 'app features ptzLiveGuard');
  assert.ok((ver.features || []).includes('ptzDeckFunctions'), 'app features ptzDeckFunctions');
  const cams = (await api.sysViews()).views.ptz.cameras;
  const cam = cams.find((c) => /UE150/i.test(c.model || c.series || '')) || cams[0];
  // guard
  let g = await api.ptz('guard', { mode: 'lock' });
  assert.equal(g.liveGuard.mode, 'lock');
  await api.ptz('tally', { cam: cam.id, color: 'red', on: true });
  await assert.rejects(() => api.ptz('recall', { cam: cam.id, preset: 2, guarded: true }), /lock/i);
  g = await api.ptz('guard', { mode: 'hold', holdMs: 200 });
  assert.equal(g.liveGuard.mode, 'hold');
  await assert.rejects(() => api.ptz('recall', { cam: cam.id, preset: 2, guarded: true }), /hold/i);
  await api.ptz('recall', { cam: cam.id, preset: 2, guarded: true, confirmed: true });
  // DRS / night / freeze
  await api.ptz('op', { cam: cam.id, op: 'drs', value: '2' });
  await api.ptz('op', { cam: cam.id, op: 'dayNight', value: true });
  await api.ptz('op', { cam: cam.id, op: 'freezePreset', value: true });
  const st = await api._req('GET', `/api/sys/ptz/cameras/${cam.id}/status`);
  assert.equal(String(st.values.drs), '2');
  assert.equal(st.values.dayNight, true);
  assert.equal(st.values.freezePreset, true);
});

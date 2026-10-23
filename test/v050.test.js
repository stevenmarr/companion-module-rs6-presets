'use strict';
// 0.5.0: module vs app audit. Version warning, tile coverage, the recall/selection fix, and a contract test that
// runs this module against the real RS6 Presets app (sibling checkout, mock mode) when it is available.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Module = require('module');
const { spawn } = require('child_process');
const L = require('../src/logic');
const { AppApi } = require('../src/api');

function loadInstance() {
  class InstanceBase {
    constructor() { this.calls = { status: [], vars: {}, varDefs: [], presets: {}, actions: {}, feedbacks: {}, checked: 0, logs: [] }; this.label = 'rs6presets'; }
    updateStatus(s, m) { this.calls.status.push([s, m]); }
    setVariableDefinitions(d) { this.calls.varDefs = d; }
    setVariableValues(v) { Object.assign(this.calls.vars, v); }
    setPresetDefinitions(structure, presets) { this.calls.presets = presets || structure; }
    setActionDefinitions(a) { this.calls.actions = a; }
    setFeedbackDefinitions(f) { this.calls.feedbacks = f; }
    checkFeedbacks() { this.calls.checked++; }
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
const until = async (fn, ms = 4000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 25)); } throw new Error(`timed out: ${what}`); };
function serve(state) {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state())); }); });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('version check: warns (log once + status) when the app is older or newer than the module expects', async () => {
  // 0.8.0: the module expects app 0.10.0 (API 9); API 8 runs every system but the new ATEM controls (soft); API 5..7 the RS6 controls
  assert.equal(L.EXPECTED_API, 9); assert.equal(L.SYS_API, 8); assert.equal(L.MIN_API, 5);
  assert.equal(L.versionProblem({ appVersion: '0.10.0', apiVersion: 9 }), null);
  assert.match(L.versionProblem({ appVersion: '0.9.8', apiVersion: 8 }), /ATEM router .* need app 0\.10\.0/);
  assert.match(L.versionProblem({ appVersion: '0.5.0', apiVersion: 5 }), /RS6 controls work.*need app 0\.8\.0/);
  assert.equal(L.versionSoft({ apiVersion: 5 }), true); assert.equal(L.versionSoft({ apiVersion: 8 }), true); assert.equal(L.versionSoft({ apiVersion: 9 }), false); assert.equal(L.versionSoft({ apiVersion: 4 }), false);
  assert.match(L.versionProblem({ appVersion: '0.4.0' }), /0\.4\.0 is older.*update the app/);
  assert.match(L.versionProblem({ appVersion: '0.11.0', apiVersion: 10 }), /newer than this module.*update the Companion module/);
  assert.match(L.versionProblem({ appVersion: '0.4.9', apiVersion: 4 }), /API 4.*expects 9.*update the app/);
  let st = { appVersion: '0.4.0', connected: true, rev: 1, presets: [] };
  const srv = await serve(() => st);
  const inst = loadInstance();
  try {
    await inst.init({ host: '127.0.0.1', port: srv.address().port, poll: 50, updates: 'poll' });
    const c = inst.calls;
    await until(() => c.status.some(([s, m]) => s === 'unknown_warning' && /older/.test(m || '')), 3000, 'warning status');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(c.logs.filter(([l, m]) => l === 'warn' && /older/.test(m)).length, 1, 'logged once, not on every poll');
    st = { ...st, appVersion: '0.5.0', apiVersion: 5 };
    await until(() => c.status.length && c.status[c.status.length - 1][0] === 'ok', 3000, 'ok after the app update');
    assert.equal(c.vars.app_version, '0.5.0'); assert.equal(c.vars.app_api_version, '5');
  } finally { await inst.destroy(); srv.close(); }
});

test('tiles: variables, dropdown and button presets cover the app tile count (24..96), and used tiles above it', () => {
  const presets = [{ number: 1, name: 'A' }, { number: 50, name: 'B' }];
  for (const [tc, n] of [[undefined, 50], [24, 50], [48, 50], [72, 72], [96, 96], [50, 50], [500, 96]]) {
    const st = { tileCount: tc, presets };
    assert.equal(L.presetSlots(st).length, n, `tileCount ${tc}`);
  }
  const st = { tileCount: 96, presets: [...presets, { number: 400, name: 'far' }] };
  const slots = L.presetSlots(st);
  assert.equal(slots.length, 97); assert.equal(slots[96], 400, 'a used tile above 96 is still covered');
  const ids = L.variableDefinitions(st).map((d) => d.variableId);
  for (const n of [1, 2, 96, 400]) assert.ok(ids.includes(`preset_${n}_name`), n);
  assert.ok(!ids.includes('preset_97_name'), 'no variables for unused tiles above the tile count');
  assert.ok(ids.length < 400, `kept small: ${ids.length} variables`);
  const v = L.variableValues(st);
  assert.equal(v.preset_2_name, '2 (empty)'); assert.equal(v.preset_50_name, 'B'); assert.equal(v.tile_count, '96');
  const p = L.buttonPresets(st);
  assert.equal(p.preset_96.category, 'Preset tiles 73-96'); assert.equal(p.preset_1.category, 'Preset tiles 1-24');
  assert.equal(p.preset_2.name, '2 (empty tile)');
  assert.deepEqual(p.preset_96.steps[0].down[0], { actionId: 'recall_preset', options: { preset: 96 } });
  assert.equal(L.presetChoices(st).find((c) => c.id === 2).label, '2 (empty)');
  assert.notEqual(L.presetSignature({ tileCount: 48, presets }), L.presetSignature({ tileCount: 96, presets }), 'a tile count change rebuilds definitions');
});

test('backup feedback uses the app 0.4.0+ "active" flag', () => {
  const st = { live: { backup: { inputs: [{ number: 4, selected: '1', active: false }, { number: 5, selected: 'NONE', active: true }], groups: [{ group: 1, label: 'MEDIA BU', selected: '2', active: true }] } } };
  assert.equal(L.backupActive(st, 'input', 4), false); assert.equal(L.backupActive(st, 'input', 5), true);
  assert.equal(L.backupActive(st, 'group', 1), true); assert.equal(L.backupActive(st, 'group', 1, '2'), true);
  assert.equal(L.backupActive({ live: { backup: { inputs: [{ number: 4, selected: '1' }] } } }, 'input', 4), true, 'older apps: selected');
});

// ---------- contract test against the real app ----------
const APP_DIR = process.env.RS6_APP_DIR || path.join(__dirname, '..', '..', 'rs6-presets');
const haveApp = fs.existsSync(path.join(APP_DIR, 'server.js')) && fs.existsSync(path.join(APP_DIR, 'lib', 'shows.js'));
test('contract: this module against the real RS6 Presets app 0.5.0 (mock device)', { skip: haveApp ? false : `app not found at ${APP_DIR}` }, async (t) => {
  const port = 21000 + Math.floor(Math.random() * 4000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rs6c-'));
  const app = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), '--mock', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: 'ignore', env: { ...process.env, RS6_QUIET: '1' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const api = new AppApi('127.0.0.1', port, 4000);
  await until(async () => (await api.state()).connected, 15000, 'app up + mock connected');
  await until(async () => { const x = await api.state(); return x.presets.length >= 12 && x.live && x.live.backup && x.live.backup.groups.length; }, 8000, 'seeded presets + live backup data');
  // fields this module reads, served by the app
  const st = await api.state();
  for (const k of ['rev', 'connected', 'autoTake', 'selection', 'transitionTargets', 'destinations', 'presets', 'programPresets', 'lastRecalled', 'live', 'memories', 'multiviewers', 'appVersion', 'apiVersion', 'tileCount', 'show']) assert.ok(k in st, `state.${k}`);
  assert.equal(st.apiVersion, L.EXPECTED_API, 'app and module agree on the API version');
  for (const k of ['number', 'name', 'tally', 'destinations', 'memories', 'targets', 'mvMemories']) assert.ok(k in st.presets[0], `preset.${k}`);
  assert.ok(['pvw', 'pgm'].every((k) => k in st.presets[0].tally));
  for (const k of ['inputs', 'backup', 'audio', 'tally', 'mode']) assert.ok(k in st.live, `live.${k}`);
  assert.ok(Array.isArray(st.live.backup.groups) && st.live.backup.groups[0].label, 'backup groups with labels');
  assert.equal(L.variableValues(st)[`backup_group_${st.live.backup.groups[0].group}_name`], st.live.backup.groups[0].label);
  assert.equal(L.versionProblem(st), null);
  assert.equal(st.tileCount, 48); assert.equal(L.presetSlots(st).length, 48);
  // no Layer memories anywhere (removed in app 0.4.0) and the module does not ask for them
  assert.deepEqual(Object.keys(st.memories.items || st.memories).filter((k) => /layer/i.test(k)), []);
  const v = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json();
  assert.equal(v.apiVersion, L.EXPECTED_API); assert.ok(v.features.includes('swap'));
  // long-poll: a change in the app answers a waiting request
  const waiting = api.stateSince(st.rev, 10000);
  await fetch(`http://127.0.0.1:${port}/api/presets/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 2, b: 30 }) });
  const first = await waiting;
  assert.ok(first.rev > st.rev, 'long-poll answered with a newer rev');
  let after = first;
  await until(async () => { after = await api.state(); return after.presets.some((p) => p.number === 30); }, 3000, 'swap visible');
  // swap semantics: the variables follow the tile
  const vv = L.variableValues(after);
  assert.equal(vv.preset_30_name, st.presets.find((p) => p.number === 2).name);
  assert.equal(vv.preset_2_name, '2 (empty)');
  // the module instance end to end: recall through its action; the app selects the screens, the module doesn't
  const inst = loadInstance();
  try {
    await inst.init({ host: '127.0.0.1', port, poll: 100, updates: 'longpoll' });
    const c = inst.calls;
    await until(() => c.status.some(([s]) => s === 'ok'), 5000, 'module ok against the real app');
    const seen = [];
    const origFetch = global.fetch;
    global.fetch = (u, o) => { seen.push(`${(o && o.method) || 'GET'} ${String(u).replace(/^http:\/\/[^/]+/, '')}`); return origFetch(u, o); };
    try { await c.actions.recall_preset.callback({ options: { preset: 1 } }); } finally { global.fetch = origFetch; }
    assert.ok(seen.includes('POST /api/presets/1/recall'));
    assert.ok(!seen.some((x) => x.startsWith('POST /api/selection')), 'no second selection POST after a recall');
    const s2 = await api.state();
    assert.deepEqual(s2.transitionTargets, L.presetTargets(s2.presets.find((p) => p.number === 1)).filter((k) => s2.destinations.some((d) => d.key === k)));
    await until(() => c.vars.preset_30_name === vv.preset_30_name, 3000, 'module variables follow the moved tile');
    assert.equal(c.vars.preset_2_name, '2 (empty)');
    assert.equal(c.vars.show_name, 'Untitled show');
  } finally { await inst.destroy(); }
});

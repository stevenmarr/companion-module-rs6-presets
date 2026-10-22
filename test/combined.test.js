'use strict';
// v0.3.0: combined presets and imported device memories (app 0.3.0 state captured in --mock mode:
// preset 10 "Panel Master + MV" = Master 3 + S4 mem 30 + MV1 mem 2, taken; preset 9 on PVW).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const Module = require('module');
const L = require('../src/logic');
const { AppApi } = require('../src/api');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/app-state-0.3.0.json')));

test('preset dropdown lists combined presets with their contents', () => {
  const s = fixture();
  const c = L.presetChoices(s);
  assert.deepEqual(c.find((x) => x.id === 10), { id: 10, label: '10 Panel Master + MV (M:3 S4:30 MV1:2)' });
  assert.deepEqual(c.find((x) => x.id === 9), { id: 9, label: '9 Keynote + Sponsors (S1:10 S2:32 S3:33)' });
  // 0.5.0: every tile is a choice, filled or not (buttons follow the tile)
  const none = L.presetChoices(null);
  assert.equal(none.length, 24); assert.deepEqual(none[0], { id: 1, label: '1 (empty)' });
  assert.equal(L.presetChoices({ ...s, tileCount: 96 }).length, 96);
  assert.equal(L.presetTally(s, 10, 'pgm'), true); assert.equal(L.presetTally(s, 9, 'pvw'), true);
});

test('memory dropdowns and name variables come from the imported memories', () => {
  const s = fixture();
  assert.deepEqual(L.memoryChoices(s, 'screen').slice(0, 3), [{ id: 1, label: '1 Walk-in L' }, { id: 2, label: '2 Walk-in R' }, { id: 10, label: '10 Keynote' }]);
  assert.deepEqual(L.memoryChoices(s, 'master').map((x) => x.label), ['1 Show Open', '2 Keynote', '3 Panel', '4 Break', '5 Awards']);
  assert.deepEqual(L.mvChoices(s), [{ id: 'M1', label: 'M1 MVW1' }, { id: 'M2', label: 'M2 MVW2' }]);
  const v = L.variableValues(s);
  assert.equal(v.screen_mem_10_name, 'Keynote'); assert.equal(v.master_mem_4_name, 'Break');
  assert.equal(v.preset_10_summary, 'M:3 S4:30 MV1:2'); assert.ok(v.memories_imported);
  const ids = L.variableDefinitions(s).map((d) => d.variableId);
  assert.ok(ids.includes('screen_mem_53_name') && ids.includes('master_mem_1_name') && !ids.includes('screen_mem_3_name'));
  assert.ok(!ids.some((i) => /^mv_mem_/.test(i))); // MV names are not documented: none without the app's probe
  // older app (no memories block) degrades quietly
  assert.deepEqual(L.memoryChoices({ presets: [] }, 'screen'), [{ id: 1, label: '1' }]);
  // renaming a memory on the device changes the signature (dropdowns/variables get rebuilt)
  const s2 = fixture(); s2.memories.items.screen[0].label = 'Doors';
  assert.notEqual(L.presetSignature(s), L.presetSignature(s2));
});

test('button presets: Master memory buttons with tally, refresh and logo', () => {
  const p = L.buttonPresets(fixture());
  assert.deepEqual(p.master_mem_3.steps[0].down[0], { actionId: 'load_master_memory', options: { memory: 3, target: 'preview' } });
  assert.deepEqual(p.master_mem_3.feedbacks.map((f) => f.options.side), ['pvw', 'pgm']);
  assert.ok(p.refresh_memories && p.logo.style.png64.length > 1000);
  assert.ok(Buffer.from(p.logo.style.png64, 'base64').subarray(1, 4).toString() === 'PNG');
});

test('AppApi memory routes', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen.push(`${req.method} ${req.url} ${b}`); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const api = new AppApi('127.0.0.1', srv.address().port);
  try {
    await api.loadMemory('screen', '10', 'S2', 'preview'); await api.loadMemory('master', 3, undefined, 'program');
    await api.loadMemory('multiviewer', 2, 'M1'); await api.refreshMemories(); await api.stageLoad('preview');
    assert.deepEqual(seen, [
      'POST /api/memories/load {"type":"screen","slot":10,"dest":"S2","target":"preview"}',
      'POST /api/memories/load {"type":"master","slot":3,"target":"program"}',
      'POST /api/memories/load {"type":"multiviewer","slot":2,"dest":"M1"}',
      'POST /api/memories/refresh ', 'POST /api/stage/load {"target":"preview"}',
    ]);
  } finally { await new Promise((r) => srv.close(r)); }
});

test('instance: preset recall/feedback dropdowns list combined presets; memory actions post to the app', async () => {
  const state = fixture(); const posts = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { if (req.method === 'POST') posts.push(`${req.url} ${b}`); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state)); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const captured = {};
  class InstanceBase { constructor() { this.calls = { vars: {}, actions: {}, feedbacks: {}, presets: {}, status: [], logs: [] }; }
    updateStatus(s) { this.calls.status.push(s); } setVariableDefinitions() {} setVariableValues(v) { Object.assign(this.calls.vars, v); }
    setPresetDefinitions(p) { this.calls.presets = p; } setActionDefinitions(a) { this.calls.actions = a; } setFeedbackDefinitions(f) { this.calls.feedbacks = f; } checkFeedbacks() {} log(l, m) { this.calls.logs.push([l, m]); } }
  const stub = { InstanceBase, InstanceStatus: { Ok: 'ok', Connecting: 'c', ConnectionFailure: 'f', BadConfig: 'b', UnknownWarning: 'w' }, Regex: { HOSTNAME: '' }, runEntrypoint: (C) => { captured.C = C; } };
  const orig = Module._load; Module._load = function (r, ...a) { return r === '@companion-module/base' ? stub : orig.call(this, r, ...a); };
  delete require.cache[require.resolve('../src/main.js')]; require('../src/main.js'); Module._load = orig;
  const inst = new captured.C();
  try {
    await inst.init({ host: '127.0.0.1', port: srv.address().port, poll: 100, updates: 'poll' });
    const t0 = Date.now(); while (!inst.calls.vars.screen_mem_10_name && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 10));
    const c = inst.calls;
    assert.ok(c.actions.recall_preset.options[0].choices.some((x) => x.id === 10 && /M:3/.test(x.label)));
    assert.ok(c.feedbacks.preset_pgm.options[0].choices.some((x) => x.id === 10));
    assert.equal(c.feedbacks.preset_pgm.callback({ options: { preset: 10, partial: false } }), true);
    assert.equal(c.feedbacks.master_memory.callback({ options: { side: 'pgm', memory: 3 } }), true);
    assert.ok(c.actions.load_screen_memory.options[1].choices.some((x) => x.label === '10 Keynote'));
    await c.actions.recall_preset.callback({ options: { preset: 10 } });
    await c.actions.load_screen_memory.callback({ options: { dest: 's3', memory: 12, target: 'preview' } });
    await c.actions.load_master_memory.callback({ options: { memory: 4, target: 'program' } });
    await c.actions.load_mv_memory.callback({ options: { mv: 'm2', memory: 3 } });
    await c.actions.refresh_memories.callback({ options: {} });
    assert.deepEqual(posts, [
      '/api/presets/10/recall ',
      '/api/selection {"destinations":["S1","S2","S3","S4","A1","A2"]}',
      '/api/memories/load {"type":"screen","slot":12,"dest":"S3","target":"preview"}',
      '/api/memories/load {"type":"master","slot":4,"target":"program"}',
      '/api/memories/load {"type":"multiviewer","slot":3,"dest":"M2"}',
      '/api/memories/refresh ',
    ]);
  } finally { await inst.destroy(); await new Promise((r) => { srv.closeAllConnections(); srv.close(r); }); }
});

test('0.3.1 buttons: preset name (live variable, number as fallback), Master name, TAKE shows its targets, connection label', () => {
  const s = fixture();
  s.presets.push({ number: 12, name: '  ', destinations: ['S1'], memories: { S1: 1 }, master: null, mvMemories: {}, tally: { pvw: 'none', pgm: 'none' } });
  s.transitionTargets = ['S1', 'A1'];
  const p = L.buttonPresets(s);
  assert.equal(p.preset_10.style.text, '$(rs6presets:preset_10_name)'); assert.equal(p.preset_10.style.size, L.TEXT_SIZE);
  const v = L.variableValues(s);
  assert.equal(v.preset_10_name, 'Panel Master + MV'); assert.equal(v.preset_12_name, '12');
  assert.equal(p.master_mem_4.style.text, '$(rs6presets:master_mem_4_name)');
  assert.equal(v.selection, 'S1,A1'); assert.equal(p.take.style.text, 'TAKE\\n$(rs6presets:selection)');
  const r = L.buttonPresets(s, 'rs6_show');
  assert.equal(r.preset_10.style.text, '$(rs6_show:preset_10_name)'); assert.equal(r.take.style.text, 'TAKE\\n$(rs6_show:selection)');
  assert.ok(!JSON.stringify(r).includes('$(rs6presets:'));
});

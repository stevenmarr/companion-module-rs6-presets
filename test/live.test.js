'use strict';
// v0.2.0 live-device features: tally/memory/freeze/backup/audio helpers, variables, presets,
// API routes, and the long-poll update loop (with poll fallback for pre-0.2.0 apps).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const Module = require('module');
const L = require('../src/logic');
const { AppApi } = require('../src/api');

// Captured from the RS6 Presets app 0.2.0 in --mock mode (preset 1 taken, preset 4 on PVW,
// IN 3 + IN 5 frozen, audio IN1 ch2 muted, IN 4 on backup 1). lastMaster is filled in below.
const BASE = require('./fixtures/app-state-0.2.0.json');
const fixture = () => {
  const s = JSON.parse(JSON.stringify(BASE));
  s.live.lastMaster = { program: { id: 2, label: 'Keynote' }, preview: { id: 3, label: 'Panel' } };
  return s;
};

test('input tally from the device, per destination', () => {
  const s = fixture();
  assert.equal(L.inputTally(s, 1, 'pgm'), true);            // Cam 1 on S1 program
  assert.equal(L.inputTally(s, 1, 'pgm', 'S1'), true);
  assert.equal(L.inputTally(s, 1, 'pgm', 'S2'), false);
  assert.equal(L.inputTally(s, 1, 'pvw', 's2'), true);       // case-insensitive dest key
  assert.equal(L.inputTally(s, '9', 'pvw', 'any'), true);     // custom dropdown values arrive as strings
  assert.equal(L.inputTally(s, 4, 'pgm'), false);
  assert.equal(L.inputTally(s, 12, 'pvw'), false);
  assert.equal(L.inputTally({ presets: [] }, 1, 'pgm'), false); // pre-0.2.0 app: no live block
  assert.deepEqual(L.inputChoices(s).slice(0, 2), [{ id: 1, label: '1 Cam 1 Wide' }, { id: 2, label: '2 Cam 2 Tight' }]);
});

test('memory, freeze, availability, backup and audio feedback logic', () => {
  const s = fixture();
  assert.equal(L.destMemoryIs(s, 'S1', 'pgm', 1), true);
  assert.equal(L.destMemoryIs(s, 'S1', 'pvw', 20), true);
  assert.equal(L.destMemoryIs(s, 'S1', 'pvw', 21), false);
  assert.equal(L.destMemoryIs(s, 'S9', 'pgm', 1), false);
  assert.equal(L.masterIs(s, 'pgm', 2), true); assert.equal(L.masterIs(s, 'pvw', 2), false);
  assert.equal(L.inputFrozen(s, 3), true); assert.equal(L.inputFrozen(s, 1), false);
  assert.equal(L.inputProblem(s, 6, 'unavailable'), true); assert.equal(L.inputProblem(s, 6, 'disabled'), false);
  assert.equal(L.inputProblem(s, 8, 'disabled'), true); assert.equal(L.inputProblem(s, 8), true);
  assert.equal(L.inputProblem(s, 1), false);
  assert.equal(L.backupActive(s, 'input', 4), true);
  assert.equal(L.backupActive(s, 'input', 4, '1'), true);
  assert.equal(L.backupActive(s, 'input', 4, '2'), false);
  assert.equal(L.backupActive(s, 'bg', 'S1/1'), false);
  assert.equal(L.backupActive(s, 'bg', 's1/1', 'NONE'), true);
  assert.equal(L.backupActive(s, 'group', 1), false);
  assert.equal(L.audioMuted(s, 'inputs', 1, 2), true);
  assert.equal(L.audioMuted(s, 'inputs', 1, 1), false);
  assert.equal(L.audioMuted(s, 'outputs', 1, 2), false);
});

test('variables: input labels, memory numbers/names, master, PGM layer-1 source', () => {
  const s = fixture();
  const ids = L.variableDefinitions(s).map((d) => d.variableId);
  for (const id of ['input_1_label', 'input_12_label', 'S1_pgm_memory_number', 'S1_pvw_memory_name', 'A2_pgm_memory_number', 'master_pgm_number', 'master_pvw_name', 'S1_pgm_layer1', 'live_mode']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'variable ids are unique');
  const v = L.variableValues(s);
  assert.equal(v.input_1_label, 'Cam 1 Wide');
  assert.equal(v.S1_pgm_memory_number, 1); assert.equal(v.S1_pgm_memory_name, 'Walk-in L');
  assert.equal(v.S1_pvw_memory_number, 20); assert.equal(v.S1_pvw_memory_name, 'Panel C');
  assert.equal(v.S1_pgm_layer1, 'Cam 1 Wide');
  assert.equal(v.master_pgm_number, 2); assert.equal(v.master_pgm_name, 'Keynote');
  assert.equal(v.live_mode, 'push');
  const empty = L.variableValues(null);
  assert.equal(empty.master_pgm_number, ''); assert.equal(empty.live_mode, 'off');
});

test('presets: tally per input, freeze per input, backups, audio mutes', () => {
  const s = fixture();
  const p = L.buttonPresets(s);
  assert.ok(p.input_tally_1 && p.input_tally_12 && p.input_freeze_3);
  assert.deepEqual(p.input_tally_1.feedbacks.map((f) => f.feedbackId), ['input_pvw', 'input_pgm', 'input_problem']);
  assert.equal(p.input_freeze_3.steps[0].down[0].actionId, 'input_freeze');
  assert.ok(p.input_backup_4_1 && p.input_backup_4_NONE && !p.input_backup_1_1);
  assert.equal(p.audio_inputs_1_2.steps[0].down[0].options.channel, 2);
  assert.equal(p.audio_outputs_4_8.feedbacks[0].feedbackId, 'audio_muted');
  // signature tracks structure (labels, channels) but not mute values, so mutes don't rebuild definitions
  const a = L.presetSignature(s); const s2 = fixture(); s2.live.audio.inputs[0].channels[0].mute = true;
  assert.equal(L.presetSignature(s2), a);
  s2.live.inputs[0].label = 'Renamed'; assert.notEqual(L.presetSignature(s2), a);
});

test('API client hits the app 0.2.0 control routes', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { seen.push([req.method, req.url, b ? JSON.parse(b) : null]); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const api = new AppApi('127.0.0.1', srv.address().port);
    await api.freeze(3); await api.freeze(3, true);
    await api.backup('input', 4, '1'); await api.backupMode('input', 4, true);
    await api.backup('bg', 's2/3', 'NONE'); await api.backupMode('bg', 'S2/3', false);
    await api.backup('group', 4, 2);
    await api.audioMute('inputs', 1, 2); await api.audioMute('outputs', 4, 3, false);
    await api.stateSince(7, 100);
    assert.deepEqual(seen, [
      ['POST', '/api/inputs/3/freeze', {}], ['POST', '/api/inputs/3/freeze', { value: true }],
      ['POST', '/api/inputs/4/backup', { slot: '1' }], ['POST', '/api/inputs/4/backup/mode', { auto: true }],
      ['POST', '/api/backgrounds/S2/3/backup', { slot: 'NONE' }], ['POST', '/api/backgrounds/S2/3/backup/mode', { auto: false }],
      ['POST', '/api/groups/4/backup', { slot: '2' }],
      ['POST', '/api/audio/inputs/1/channels/2/mute', {}], ['POST', '/api/audio/outputs/4/channels/3/mute', { value: false }],
      ['GET', '/api/state?since=7&timeout=100', null],
    ]);
  } finally { srv.close(); }
});

function loadInstance() {
  class InstanceBase {
    constructor() { this.calls = { status: [], vars: {}, varDefs: [], presets: {}, actions: {}, feedbacks: {}, checked: 0, logs: [] }; }
    updateStatus(s, m) { this.calls.status.push([s, m]); }
    setVariableDefinitions(d) { this.calls.varDefs = d; }
    setVariableValues(v) { Object.assign(this.calls.vars, v); }
    setPresetDefinitions(p) { this.calls.presets = p; }
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

// Fake app with ?since=rev long-poll semantics (like lib/server.js in the app).
function fakeApp({ longPoll = true } = {}) {
  let state = fixture(); const waiters = new Set(); const reqs = [];
  const send = (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); const s = { ...state }; if (!longPoll) delete s.rev; res.end(JSON.stringify(s)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'); reqs.push(req.method + ' ' + req.url);
      if (req.method === 'POST') {
        if (u.pathname === '/api/inputs/1/freeze') { const i = state.live.inputs[0]; i.freeze = !i.freeze; state.rev++; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        for (const w of waiters) w();
        return;
      }
      const since = u.searchParams.get('since');
      if (longPoll && since != null && state.rev <= Number(since)) {
        const done = () => { waiters.delete(done); clearTimeout(t); send(res); };
        const t = setTimeout(done, Number(u.searchParams.get('timeout')) || 1000);
        waiters.add(done); res.on('close', () => { waiters.delete(done); clearTimeout(t); }); // res, not req: req 'close' fires as soon as the body is read (Node 16+)
        return;
      }
      send(res);
    });
  });
  return {
    srv, reqs,
    listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', r)),
    change: (fn) => { fn(state); state.rev++; for (const w of [...waiters]) w(); },
    close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }),
  };
}
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('instance: long-poll delivers device changes immediately; live actions/feedbacks wired', async () => {
  const app = fakeApp(); await app.listen();
  const inst = loadInstance();
  try {
    await inst.init({ host: '127.0.0.1', port: app.srv.address().port, poll: 5000, updates: 'longpoll' });
    const c = inst.calls;
    await until(() => c.vars.input_1_label === 'Cam 1 Wide');
    assert.ok(c.status.some(([s]) => s === 'ok'));
    assert.deepEqual(c.feedbacks.input_pgm.options[0].choices.slice(0, 1), [{ id: 1, label: '1 Cam 1 Wide' }]);
    assert.equal(c.feedbacks.input_pgm.callback({ options: { input: 1, dest: 'any' } }), true);
    assert.equal(c.feedbacks.input_pvw.callback({ options: { input: 8, dest: 'S1' } }), true);
    assert.equal(c.feedbacks.dest_memory.callback({ options: { dest: 'S1', side: 'pgm', memory: 1 } }), true);
    assert.equal(c.feedbacks.input_frozen.callback({ options: { input: 3 } }), true);
    assert.equal(c.feedbacks.input_problem.callback({ options: { input: 6, what: 'either' } }), true);
    assert.equal(c.feedbacks.backup_active.callback({ options: { kind: 'input', id: '4', slot: 'any' } }), true);
    assert.equal(c.feedbacks.audio_muted.callback({ options: { dir: 'inputs', id: 1, channel: 2 } }), true);
    assert.ok(c.presets.input_tally_1 && c.presets.audio_inputs_1_1);

    // An external change (e.g. RC400T/Web RCS) arrives over the held long-poll well before the 5 s poll interval.
    const t0 = Date.now();
    app.change((s) => { s.destinations[0].programMemory = { id: 30, label: 'Logo' }; s.live.inputs[0].label = 'Cam 1 Renamed'; });
    await until(() => c.vars.S1_pgm_memory_number === 30, 1500);
    assert.ok(Date.now() - t0 < 1500);
    assert.equal(c.vars.input_1_label, 'Cam 1 Renamed');
    assert.ok(app.reqs.some((r) => /since=\d+/.test(r)), 'used long-poll');

    await c.actions.input_freeze.callback({ options: { input: 1, mode: 'toggle' } });
    await c.actions.backup_trigger.callback({ options: { kind: 'group', id: '2', slot: '1' } });
    await c.actions.backup_mode.callback({ options: { kind: 'bg', id: 'S1/1', auto: 'on' } });
    await c.actions.audio_mute.callback({ options: { dir: 'outputs', id: 2, channel: 5, mode: 'on' } });
    const posts = app.reqs.filter((r) => r.startsWith('POST'));
    assert.deepEqual(posts, ['POST /api/inputs/1/freeze', 'POST /api/groups/2/backup', 'POST /api/backgrounds/S1/1/backup/mode', 'POST /api/audio/outputs/2/channels/5/mute']);
    await until(() => c.feedbacks.input_frozen.callback({ options: { input: 1 } }) === true);
  } finally { await inst.destroy(); await app.close(); }
});

test('instance: falls back to interval polling when the app has no long-poll (no rev)', async () => {
  const app = fakeApp({ longPoll: false }); await app.listen();
  const inst = loadInstance();
  try {
    await inst.init({ host: '127.0.0.1', port: app.srv.address().port, poll: 100, updates: 'longpoll' });
    await until(() => app.reqs.length >= 3);
    assert.ok(app.reqs.every((r) => r === 'GET /api/state'), 'plain polling');
    assert.ok(inst.calls.logs.some(([, m]) => /polling instead/.test(m)));
    app.change((s) => { s.live.inputs[1].label = 'Cam 2 New'; });
    await until(() => inst.calls.vars.input_2_label === 'Cam 2 New');
  } finally { await inst.destroy(); await app.close(); }
});

test('instance: "Poll only" never long-polls; stop() aborts a held long-poll promptly', async () => {
  const app = fakeApp(); await app.listen();
  const inst = loadInstance();
  try {
    await inst.init({ host: '127.0.0.1', port: app.srv.address().port, poll: 100, updates: 'poll' });
    await until(() => app.reqs.length >= 3);
    assert.ok(app.reqs.every((r) => r === 'GET /api/state'));
    await inst.destroy();
    const inst2 = loadInstance();
    await inst2.init({ host: '127.0.0.1', port: app.srv.address().port, poll: 100 });
    await until(() => app.reqs.some((r) => r.includes('since=')));
    const t0 = Date.now(); await inst2.destroy(); const n = app.reqs.length;
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(app.reqs.length, n, 'no requests after destroy'); assert.ok(Date.now() - t0 < 1000);
  } finally { await inst.destroy(); await app.close(); }
});

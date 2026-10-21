'use strict';
// Loads src/main.js with a stubbed @companion-module/base so the wiring (polling, variables,
// feedbacks, presets, actions) is exercised without a running Companion.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const Module = require('module');

function stubBase() {
  const captured = { instance: null };
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
  return {
    captured,
    exports: {
      InstanceBase,
      InstanceStatus: { Ok: 'ok', Connecting: 'connecting', ConnectionFailure: 'connection_failure', BadConfig: 'bad_config', UnknownWarning: 'unknown_warning' },
      Regex: { HOSTNAME: '/.*/' },
      runEntrypoint: (Cls) => { captured.Cls = Cls; },
    },
  };
}

test('module instance polls the app, exposes variables/feedbacks/presets and sends actions', async () => {
  let state = { appVersion: '0.5.0', apiVersion: 5,
    connected: true, autoTake: false, selection: ['S1'], lastRecalled: { number: 3, name: 'Panel' }, programPresets: [],
    destinations: [{ key: 'S1', label: 'Center' }, { key: 'A1', label: 'Conf' }],
    presets: [{ number: 3, name: 'Panel', tally: { pvw: 'full', pgm: 'none' } }],
  };
  const posts = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.method === 'POST') {
        posts.push(req.url);
        if (req.url === '/api/take') state = { ...state, programPresets: [3], presets: [{ number: 3, name: 'Panel', tally: { pvw: 'full', pgm: 'full' } }] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(state));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const stub = stubBase();
  const origLoad = Module._load;
  Module._load = function (req, ...rest) { return req === '@companion-module/base' ? stub.exports : origLoad.call(this, req, ...rest); };
  delete require.cache[require.resolve('../src/main.js')];
  require('../src/main.js');
  Module._load = origLoad;

  const inst = new stub.captured.Cls();
  try {
    assert.equal(inst.getConfigFields().find((f) => f.id === 'port').default, 8080);
    await inst.init({ host: '127.0.0.1', port: srv.address().port, poll: 100 });
    await new Promise((r) => setTimeout(r, 250));
    const c = inst.calls;
    assert.equal(c.vars.last_preset_name, 'Panel'); assert.equal(c.vars.last_preset_number, 3);
    assert.ok(c.presets.preset_3 && c.presets.take && c.presets.dest_A1);
    assert.ok(c.status.some(([s]) => s === 'ok'));
    assert.equal(c.feedbacks.preset_pvw.callback({ options: { preset: 3, partial: false } }), true);
    assert.equal(c.feedbacks.preset_pgm.callback({ options: { preset: 3, partial: false } }), false);
    assert.equal(c.feedbacks.dest_selected.callback({ options: { dest: 'S1' } }), true);
    assert.deepEqual(c.actions.toggle_destination.options[0].choices.map((x) => x.id), ['S1', 'A1']);

    await c.actions.recall_preset.callback({ options: { preset: 3 } });
    await c.actions.take.callback({ options: {} });
    await c.actions.cut.callback({ options: {} });
    await c.actions.toggle_destination.callback({ options: { dest: 'a1' } });
    await c.actions.auto_take.callback({ options: { mode: 'on' } });
    assert.deepEqual(posts, ['/api/presets/3/recall', '/api/take', '/api/cut', '/api/destinations/A1/toggle', '/api/autotake']);
    assert.equal(c.feedbacks.preset_pgm.callback({ options: { preset: 3, partial: false } }), true);

    // app goes away -> connection failure status
    await new Promise((r) => { srv.closeAllConnections(); srv.close(r); });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(c.status.some(([s]) => s === 'connection_failure'));
  } finally { await inst.destroy(); if (srv.listening) srv.close(); }
});

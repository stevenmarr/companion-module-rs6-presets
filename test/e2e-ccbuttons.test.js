'use strict';
// 0.10.0, end to end: Control Center 0.31.0 BUTTONS / PAGES -> GET /api/companion/buttons -> this module's presets,
// dropdowns and variables; cc_button_run -> the app -> its ATEM mock; the module's hello shows on the COMPANION tab.
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
const haveApp = fs.existsSync(path.join(APP_DIR, 'lib', 'companion', 'bridge.js'));

test('e2e: Control Center buttons and pages become presets; a preset runs its CC actions', { skip: haveApp ? false : `Control Center app 0.31.0 not found at ${APP_DIR}`, timeout: 90000 }, async (t) => {
  const port = 25000 + Math.floor(Math.random() * 4000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcc-'));
  const app = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), '--mock', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, RS6_QUIET: '1', CC_DECK_USB: '0' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const api = new AppApi('127.0.0.1', port, 5000);
  await until(async () => (await api.version()).appVersion, 20000, 'app up');
  const req = (m, p, b) => api._req(m, p, b);

  const cut = await req('POST', '/api/buttons', { name: 'CUT', role: 'hot', text: 'CUT', actions: { press: [{ action: 'atem.cut' }] } });
  const pgm2 = await req('POST', '/api/buttons', { name: 'PGM 2', role: 'program', text: 'PGM 2', actions: { press: [{ action: 'atem.program', params: { input: 2 } }] } });
  const page = await req('POST', '/api/surface-pages', { name: 'Show', surface: 'plus', keys: [{ row: 0, col: 0, buttonId: pgm2.id }, { row: 1, col: 3, buttonId: cut.id }] });

  const inst = loadInstance();
  t.after(() => inst.destroy());
  await inst.init({ host: '127.0.0.1', port, poll: 100, updates: 'longpoll', systems: 'on', max_hold: 4000 });
  const c = inst.calls;
  await until(() => c.presets[`cc_btn_${cut.id}`] && c.vars.cc_button_count === '2', 15000, 'CC button presets');
  assert.ok(c.presets[`cc_pg_${page.id}_k1_3`], 'page slot preset');
  assert.equal(c.vars.cc_page_count, '1');
  assert.deepEqual(c.actions.cc_button_run.options[0].choices.map((x) => x.id).sort(), [cut.id, pgm2.id].sort());
  assert.equal(c.feedbacks.cc_button_look.callback({ options: { button: cut.id } }).text, 'CUT');

  // run a page button through the module: the module posts it to the app, the app runs the button's CC actions
  // (device state is not checked here: the app's mocks need their connections enabled first)
  const ran = []; const ccRun = inst.api.ccRun.bind(inst.api);
  inst.api.ccRun = async (id, body) => { const out = await ccRun(id, body); ran.push([id, body, out]); return out; };
  await c.actions.cc_button_run.callback({ options: { button: pgm2.id, event: 'press', delta: '' } });
  await until(() => ran.length === 1, 5000, 'run reached the app');
  assert.deepEqual(ran[0].slice(0, 2), [pgm2.id, { event: 'press' }]);
  assert.equal(ran[0][2].id, pgm2.id);
  assert.ok(Array.isArray(ran[0][2].ran) && ran[0][2].ran.length === 1, 'the app ran the one CC action');

  // the COMPANION tab sees this module, its version and the revision it has
  await until(async () => { const v = await req('GET', '/api/companion'); return v.module && v.module.version === require('../package.json').version && v.module.current; }, 10000, 'hello on the COMPANION tab');

  // an edit in the app reaches the module: rename, then SYNC
  const rev = c.vars.cc_buttons_rev;
  await req('PUT', `/api/buttons/${cut.id}`, { text: 'TAKE' });
  await until(() => c.vars.cc_buttons_rev !== rev && c.feedbacks.cc_button_look.callback({ options: { button: cut.id } }).text === 'TAKE', 10000, 'edit reaches the module');
  const rev2 = c.vars.cc_buttons_rev;
  await req('POST', '/api/companion/sync');
  await until(() => c.vars.cc_buttons_rev !== rev2, 10000, 'SYNC reaches the module');
});

'use strict';
// 0.12.0, end to end: Control Center 0.32.0 deck pages -> GET /api/companion/deck (long-poll) -> this module's presets,
// feedbacks and variables; cc_deck_key opens PTZ on the Companion virtual deck, cc_deck_dial turns the R / B gain
// knob on the app's PTZ mock, and the strip readout follows.
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
    constructor() { this.calls = { status: [], vars: {}, varDefs: [], presets: {}, actions: {}, feedbacks: {}, logs: [], checked: [] }; this.label = 'pvcc'; }
    updateStatus(s, m) { this.calls.status.push([s, m]); }
    setVariableDefinitions(d) { this.calls.varDefs = d; }
    setVariableValues(v) { Object.assign(this.calls.vars, v); }
    setPresetDefinitions(structure, presets) { this.calls.presets = presets || structure; this.calls.structure = structure; }
    setActionDefinitions(a) { this.calls.actions = a; }
    setFeedbackDefinitions(f) { this.calls.feedbacks = f; }
    checkFeedbacks(...ids) { this.calls.checked.push(...ids); }
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

const APP_DIR = process.env.RS6_APP_DIR || path.join(__dirname, '..', '..', 'rs6-presets');
const haveApp = fs.existsSync(path.join(APP_DIR, 'lib', 'companion', 'deck-mirror.js'));

test('e2e: Control Center deck pages become presets; a knob turns the camera and its strip readout follows', { skip: haveApp ? false : `Control Center app 0.32.0 not found at ${APP_DIR}`, timeout: 90000 }, async (t) => {
  const port = 29000 + Math.floor(Math.random() * 3000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcc-deck-'));
  const app = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), '--mock', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: process.env.E2E_VERBOSE ? 'inherit' : 'ignore', env: { ...process.env, RS6_QUIET: '1', CC_DECK_USB: '0' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const api = new AppApi('127.0.0.1', port, 5000);
  await until(async () => (await api.version()).features.includes('companionDeck'), 20000, 'app 0.32.0 up');
  await api._req('POST', '/api/sys/armed', { system: 'ptz', on: true });

  const inst = loadInstance();
  t.after(() => inst.destroy());
  await inst.init({ host: '127.0.0.1', port, poll: 100, updates: 'longpoll', systems: 'on', max_hold: 4000, deck_surfaces: ['plusxl'] });
  const c = inst.calls;
  await until(() => c.presets.ccd_plusxl_k0_0 && c.presets.ccd_plusxl_ptz_0_s2 && c.vars.cc_deck_plusxl_page === 'home.0', 20000, 'deck presets');
  assert.ok(c.presets.ccw_gainRb_strip, 'standalone R / B gain display');
  assert.equal(c.presets.ccd_plusxl_ptz_0_s2.type, 'simple');
  assert.ok(c.actions.cc_deck_key && c.actions.cc_deck_dial && c.actions.cc_dial_widget && c.actions.cc_button_run);
  assert.ok(c.feedbacks.cc_deck_look && c.feedbacks.cc_dial_look && c.feedbacks.cc_button_look);

  // HOME -> PTZ on the Companion virtual deck
  const fb = c.feedbacks.cc_deck_look;
  const home = inst.deck.surfaces[0].live.keys.find((k) => k.lines.includes('PTZ'));
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'key', row: home.row, col: home.col, pin: '' } }).text, 'OPEN\\nPTZ');
  await c.actions.cc_deck_key.callback({ options: { surface: 'plusxl', row: home.row, col: home.col, event: 'press', pin: '' } });
  await c.actions.cc_deck_key.callback({ options: { surface: 'plusxl', row: home.row, col: home.col, event: 'release', pin: '' } });
  await until(() => /^ptz\./.test(c.vars.cc_deck_plusxl_page), 10000, 'deck on PTZ');
  const live = inst.deck.surfaces[0].live;
  const gain = live.dials.find((d) => d.widget === 'gainRb');
  assert.ok(gain, 'the PTZ page has the R / B gain knob');
  const before = fb.callback({ options: { surface: 'plusxl', part: 'strip', index: gain.index, pin: '' } }).text;
  assert.match(before, /R GAIN/);

  // turn the knob: R gain moves on the app's PTZ mock, and the strip readout and variable follow
  await c.actions.cc_deck_dial.callback({ options: { surface: 'plusxl', index: gain.index, event: 'rotate', delta: '1', pin: '' } });
  await c.actions.cc_deck_dial.callback({ options: { surface: 'plusxl', index: gain.index, event: 'rotate', delta: '1', pin: '' } });
  const v = `cc_strip_plusxl_${gain.index + 1}`;
  await until(() => /R GAIN \+\d/.test(c.vars[v]), 15000, `${v} shows the new R gain (${c.vars[v]})`);
  assert.match(fb.callback({ options: { surface: 'plusxl', part: 'strip', index: gain.index, pin: '' } }).text, /R GAIN \+\d/);
  assert.ok(c.checked.includes('cc_deck_look'));
  const deckPresets = () => Object.keys(c.presets).filter((k) => /^cc[dw]_/.test(k)).length;
  const pinnedPresets = deckPresets();

  // push switches the knob to B gain; the layout (presets) does not change for a new value
  await c.actions.cc_deck_dial.callback({ options: { surface: 'plusxl', index: gain.index, event: 'push', delta: '', pin: '' } });
  await until(() => /^>B GAIN/m.test(fb.callback({ options: { surface: 'plusxl', part: 'strip', index: gain.index, pin: '' } }).text.split('\\n')[1] || ''), 10000, 'B side active');
  assert.equal(deckPresets(), pinnedPresets);

  // standalone R / B gain knob
  await c.actions.cc_dial_widget.callback({ options: { widget: 'gainRb', event: 'rotate', delta: '1' } });
  await until(() => /R GAIN \+\d/.test(c.vars.cc_dial_gainRb || ''), 10000, `cc_dial_gainRb (${c.vars.cc_dial_gainRb})`);

  // a pinned press moves the virtual deck back to HOME
  await c.actions.cc_deck_dial.callback({ options: { surface: 'plusxl', index: 0, event: 'tap', delta: '', pin: 'home.0' } });
  await until(() => c.vars.cc_deck_plusxl_page === 'home.0', 10000, 'pinned to HOME');
});

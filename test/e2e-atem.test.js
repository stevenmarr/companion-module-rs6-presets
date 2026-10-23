'use strict';
// 0.8.0 (app 0.10.0, API 9), end to end against the app's ATEM simulator as a 2 M/E Constellation HD (--atem-model chd2me):
// router, Fairlight audio mute / fader, keys per M/E, SuperSource box source / on-off / layout recall, and the button
// presets. Every request goes to the app on 127.0.0.1; the module never addresses a device.
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

test('e2e ATEM 0.8.0: router, audio, keys per M/E, SuperSource (app simulator chd2me)', { skip: haveApp ? false : `Control Center app not found at ${APP_DIR}`, timeout: 60000 }, async (t) => {
  const port = 29000 + Math.floor(Math.random() * 900);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcc-atem-'));
  const app = spawn(process.execPath, [path.join(APP_DIR, 'server.js'), '--mock', '--atem-model', 'chd2me', '--port', String(port), '--host', '127.0.0.1', '--data', data], { stdio: 'ignore', env: { ...process.env, RS6_QUIET: '1' } });
  t.after(async () => { const gone = new Promise((r) => app.once('exit', r)); app.kill(); await gone; fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 }); });
  const api = new AppApi('127.0.0.1', port, 5000);
  const atem = async () => (await api.sysViews()).views.atem;
  await until(async () => { const a = await atem(); return a && a.status.connected && a.mixEffects && a.mixEffects.length === 2; }, 20000, 'app up, ATEM simulator (2 M/E) connected');
  const seen = []; const origFetch = global.fetch;
  global.fetch = (u, o) => { seen.push(String(u)); return origFetch(u, o); };
  t.after(() => { global.fetch = origFetch; });
  const inst = loadInstance(); t.after(() => inst.destroy());
  await inst.init({ host: '127.0.0.1', port, poll: 100, updates: 'longpoll', systems: 'on', max_hold: 4000 });
  const c = inst.calls; const A = (id, options = {}) => c.actions[id].callback({ options }); const F = (id, options = {}) => c.feedbacks[id].callback({ options });
  await until(() => c.vars.atem_connected === 'true' && c.vars.atem_out_aux_11 !== undefined, 10000, 'module sees the ATEM outputs');
  assert.ok(!c.status.some(([s, m]) => s === 'unknown_warning' && /API/.test(m || '')), 'no version warning against app 0.10.0');
  for (const id of ['atem_route_output', 'atem_audio_mute', 'atem_audio_fader_nudge', 'atem_audio_master_nudge', 'atem_ss_box_source', 'atem_ss_box_enable', 'atem_ss_layout_recall']) assert.ok(c.actions[id], id);
  for (const id of ['atem_output_is', 'atem_audio_muted', 'atem_ss_box']) assert.ok(c.feedbacks[id], id);

  await t.test('router: aux and M/E 2 preview through route, feedback + variable', async () => {
    await A('atem_route_output', { output: 'aux:3', source: 5 });
    await until(() => F('atem_output_is', { output: 'aux:3', source: 5 }), 3000, 'aux 4 = 5');
    assert.equal((await atem()).aux[3].source, 5);
    assert.equal(c.vars.atem_out_aux_3, (await atem()).sources.find((i) => i.id === 5).short);
    await A('atem_route_output', { output: 'me:1:preview', source: 6 });
    await until(async () => (await atem()).mixEffects[1].preview === 6, 3000, 'M/E 2 preview 6');
    await until(() => F('atem_output_is', { output: 'me:1:preview', source: 6 }), 3000, 'M/E 2 preview feedback');
    await A('atem_route_output', { output: 'mv:0:5', source: 3 });
    await until(async () => (await atem()).multiviewers[0].windows[5].source === 3, 3000, 'MV 1 window 6');
  });
  await t.test('audio: mute toggle, fader nudge, master nudge', async () => {
    const was = F('atem_audio_muted', { input: 1 });
    await A('atem_audio_mute', { input: 1, mode: 'toggle' });
    await until(() => F('atem_audio_muted', { input: 1 }) === !was, 3000, 'input 1 mute toggled');
    await A('atem_audio_mute', { input: 1, mode: 'off' });
    await until(() => !F('atem_audio_muted', { input: 1 }), 3000, 'input 1 unmuted');
    const f0 = (await atem()).audio.inputs.find((i) => i.id === 2).fader;
    await A('atem_audio_fader_nudge', { input: 2, db: -3 });
    await until(async () => Math.abs((await atem()).audio.inputs.find((i) => i.id === 2).fader - (f0 - 3)) < 0.05, 3000, 'input 2 -3 dB');
    await until(() => c.vars.atem_audio_2_fader === (f0 - 3).toFixed(1), 3000, 'fader variable');
    const m0 = (await atem()).audio.master.fader;
    await A('atem_audio_master_nudge', { db: -2 });
    await until(async () => Math.abs((await atem()).audio.master.fader - (m0 - 2)) < 0.05, 3000, 'master -2 dB');
  });
  await t.test('keys: M/E 2 key 2 on air, old actions without M/E stay on M/E 1', async () => {
    await A('atem_usk_onair', { me: 2, key: 1, mode: 'toggle' });
    await until(() => F('atem_usk', { me: 2, key: 1, what: 'onair' }), 3000, 'M/E 2 key 2 on air');
    assert.equal((await atem()).mixEffects[0].keyers[1].onAir, false, 'M/E 1 untouched');
    await A('atem_usk_onair', { key: 0, mode: 'on' });
    await until(async () => (await atem()).mixEffects[0].keyers[0].onAir, 3000, 'no M/E option = M/E 1');
    await until(() => F('atem_usk', { key: 0, what: 'onair' }), 3000, 'feedback without M/E = M/E 1');
    await A('atem_usk_onair', { me: 2, key: 1, mode: 'off' }); await until(() => !F('atem_usk', { me: 2, key: 1, what: 'onair' }), 3000, 'off');
  });
  await t.test('SuperSource: box source, box off / on, layout recall', async () => {
    await A('atem_ss_box_source', { ss: 0, box: 2, source: 7 });
    await until(() => F('atem_ss_box', { ss: 0, box: 2, what: 'source', source: 7 }), 3000, 'box 3 = 7');
    await A('atem_ss_box_enable', { ss: 0, box: 3, mode: 'toggle' });
    await until(() => !F('atem_ss_box', { ss: 0, box: 3, what: 'enabled' }) && c.vars.atem_ss1_box4 === 'off', 3000, 'box 4 off');
    await A('atem_ss_layout_recall', { ss: 0, layout: 'pip', withSources: false });
    await until(async () => (await atem()).superSources[0].boxes[0].size === 1000, 3000, 'PiP layout');
    assert.equal((await atem()).superSources[0].boxes[2].source, 7, 'recall without sources keeps the box sources');
  });
  await t.test('button presets: router, audio, M/E 2 keys, SuperSource (ATEM gold family, uniform text size)', () => {
    const L = require('../src/logic'); const p = require('../src/sys').buttonPresets(inst.sys);
    for (const id of ['atem_out_aux_0_status', 'atem_route_aux_0_1', 'atem_route_me_1_program_3', 'atem_audio_1_mute', 'atem_audio_1_up', 'atem_audio_master_down', 'atem_me2_usk_0_air', 'atem_ss1_box1_on', 'atem_ss1_box1_1', 'atem_ss1_layout_quad']) {
      assert.ok(p[id], `preset ${id}`); assert.equal(p[id].style.size, L.TEXT_SIZE, `${id} text size`);
    }
    assert.equal(p.atem_route_aux_0_1.style.png64, L.BG.atem, 'gold ATEM background');
    assert.equal(p.atem_audio_1_mute.feedbacks[0].feedbackId, 'atem_audio_muted');
    assert.equal(Object.keys(p).filter((k) => k.startsWith('atem_aux_')).length, 0, 'router presets replace the aux grid on API 9');
  });
  assert.ok(seen.every((u) => u.startsWith(`http://127.0.0.1:${port}/`)), 'every request went to the app');
});

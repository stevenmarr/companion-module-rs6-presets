'use strict';
// 0.14.0: Control Center only. The older per-system preset sections (RS6 tiles, E2, PixelHue, ATEM, PTZ) and their
// setting are gone, nothing user-facing says "RS6 presets", every action and feedback id from 0.13.0 is still
// defined (buttons already placed keep working), and the upgrade script drops the removed setting.
// Hermetic: no app, no network, no child processes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const G = require('../src/graphics');
const UpgradeScripts = require('../src/upgrades');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const RS6_PRESETS = /rs6[\s_-]*presets/i;
const OLDER = /older (per-system )?presets/i;

function loadMain() {
  if (loadMain.cache) return loadMain.cache;
  const file = require.resolve('../src/main');
  const real = require('@companion-module/base');
  const orig = Module._load;
  let Klass = null;
  Module._load = function (req, ...rest) {
    if (req === '@companion-module/base') return { ...real, runEntrypoint: (k) => { Klass = k; } };
    return orig.call(this, req, ...rest);
  };
  try { delete require.cache[file]; require(file); } finally { Module._load = orig; }
  loadMain.cache = Klass;
  return Klass;
}
function inst(config = {}) {
  const Cls = loadMain();
  const cc = { rev: 'r1', buttons: [{ id: 'b1', name: 'Cam 1', element: 'key', role: 'key', look: { lines: ['CAM 1'] } }], pages: [] };
  const o = Object.create(Cls.prototype); Object.defineProperty(o, 'label', { value: 'pvcc' });
  return Object.assign(o, {
    config, cc, state: json('test/fixtures/app-state-0.3.0.json'), sys: json('test/fixtures/app-sys-0.8.0.json'),
    deck: json('test/fixtures/app-deck-0.32.0.json'), ptzCats: {}, catKeys: {}, holds: new Map(), log() {},
  });
}

test('only Control Center presets are published, even with the old setting still saved', () => {
  for (const config of [{}, { legacy_presets: 'show' }, { legacy_presets: 'hide' }]) {
    const ids = Object.keys(inst(config).presets());
    assert.ok(ids.length > 100, `${ids.length} presets`);
    assert.ok(ids.every((id) => /^cc(d|w|_btn|_pg)_/.test(id)), ids.find((id) => !/^cc(d|w|_btn|_pg)_/.test(id)));
    assert.ok(ids.some((id) => id.startsWith('cc_btn_')) && ids.some((id) => id.startsWith('ccd_plusxl_')));
  }
  const { structure } = G.publishPresets(inst().presets());
  for (const s of structure) assert.ok(!/RS6|preset tiles|older/i.test(s.name), s.name);
});

test('every 0.13.0 action and feedback id is still defined, so placed buttons keep working', () => {
  const ids = json('test/fixtures/ids-0.13.0.json');
  const i = inst();
  const actions = i.actions(); const feedbacks = i.feedbacks();
  assert.deepEqual(ids.actions.filter((id) => !actions[id]), [], 'actions');
  assert.deepEqual(ids.feedbacks.filter((id) => !feedbacks[id]), [], 'feedbacks');
  // the CC ones are there too
  for (const id of ['cc_button_run', 'cc_deck_key', 'cc_deck_dial']) assert.ok(actions[id], id);
  for (const id of ['cc_button_look', 'cc_deck_look', 'cc_dial_look', 'cc_pages_refresh']) assert.ok(feedbacks[id], id);
});

test('settings: no older-presets switch, nothing says RS6 presets', () => {
  const fields = loadMain().prototype.getConfigFields.call({});
  assert.equal(fields.find((f) => f.id === 'legacy_presets'), undefined);
  for (const id of ['host', 'port', 'updates', 'poll', 'systems', 'deck_surfaces', 'max_hold']) assert.ok(fields.find((f) => f.id === id), id);
  const text = JSON.stringify(fields);
  assert.doesNotMatch(text, RS6_PRESETS); assert.doesNotMatch(text, OLDER); assert.doesNotMatch(text, /RS6 only/);
  const h = Object.assign(inst({ legacy_presets: 'hide' }), { deckState: 'ok' }).deckHello();
  assert.equal('legacyPresets' in h, false, 'hello no longer reports the removed setting');
});

test('action, feedback, preset and variable names never say RS6 presets', () => {
  const i = inst();
  const names = [
    ...Object.values(i.actions()).flatMap((a) => [a.name, a.description, ...(a.options || []).map((o) => `${o.label} ${o.tooltip || ''}`)]),
    ...Object.values(i.feedbacks()).flatMap((f) => [f.name, f.description, ...(f.options || []).map((o) => `${o.label} ${o.tooltip || ''}`)]),
    ...Object.values(i.presets()).flatMap((p) => [p.name, p.category]),
  ].filter(Boolean).join('\n');
  assert.doesNotMatch(names, RS6_PRESETS); assert.doesNotMatch(names, OLDER);
});

test('upgrade script 0.14.0 drops legacy_presets; earlier scripts keep their place', () => {
  assert.equal(UpgradeScripts.length, 2, 'append only: Companion remembers how many scripts ran');
  const run = (config) => UpgradeScripts.reduce((cfg, fn) => { const r = fn({}, { config: cfg, actions: [], feedbacks: [] }); return r.updatedConfig || cfg; }, config);
  // a connection from the first module id (0.10.0): nothing set yet
  assert.deepEqual(run({ host: '10.0.0.5', port: 8080 }), { host: '10.0.0.5', port: 8080, deck_surfaces: ['plusxl'] });
  // a 0.13.0 connection that hid the older presets
  const r = UpgradeScripts[1]({}, { config: { host: 'h', deck_surfaces: ['plus'], legacy_presets: 'hide', systems: 'off' }, actions: [], feedbacks: [] });
  assert.deepEqual(r.updatedConfig, { host: 'h', deck_surfaces: ['plus'], systems: 'off' });
  assert.deepEqual(r.updatedActions, []); assert.deepEqual(r.updatedFeedbacks, []);
  // already clean, or no config: nothing to write
  assert.equal(UpgradeScripts[1]({}, { config: { host: 'h' }, actions: [], feedbacks: [] }).updatedConfig, null);
  assert.equal(UpgradeScripts[1]({}, { config: null, actions: [], feedbacks: [] }).updatedConfig, null);
  // the saved config object is not changed in place
  const saved = { legacy_presets: 'show' }; UpgradeScripts[1]({}, { config: saved, actions: [], feedbacks: [] });
  assert.equal(saved.legacy_presets, 'show');
});

test('manifest and package: Control Center naming, 0.14.0, the legacy id kept for migration only', () => {
  const m = json('companion/manifest.json'); const p = json('package.json');
  assert.equal(m.id, 'pvllc-control-center');
  assert.deepEqual(m.legacyIds, ['rs6-presets'], 'moves connections made with the first release; keep it');
  assert.equal(m.version, p.version); assert.equal(p.version, '0.15.0');
  assert.equal(m.name, 'Performance Video Control Center');
  for (const t of [m.description, p.description, ...(m.keywords || []), ...(m.products || [])]) { assert.doesNotMatch(t, RS6_PRESETS, t); assert.doesNotMatch(t, OLDER, t); }
  assert.match(read('src/main.js'), /legacyIds \["rs6-presets"\]/, 'main.js says why the legacy id stays');
});

test('README, HELP and source never say RS6 presets (except the legacy id note)', () => {
  const files = ['README.md', 'companion/HELP.md', ...fs.readdirSync(path.join(root, 'src')).map((f) => `src/${f}`)];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((line, n) => {
      if (!RS6_PRESETS.test(line) && !OLDER.test(line)) return;
      // allowed: the legacy module id / repository name, where the text explains it is internal (migration only)
      const ok = /legacyIds|legacy id|first (module )?id|first release|repo(sitory)?\b|companion-module-rs6-presets|0\.10\.0/i.test(line) && !OLDER.test(line);
      assert.ok(ok, `${f}:${n + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
});

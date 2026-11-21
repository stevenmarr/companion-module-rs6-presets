'use strict';
// 0.13.0: Control Center presets first (0.14.0: only), the deck-pages default for connections made before 0.12.0,
// and what the module tells Control Center's COMPANION tab about the deck pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const G = require('../src/graphics');
const D = require('../src/ccdeck');
const UpgradeScripts = require('../src/upgrades');

const deck = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-deck-0.32.0.json'), 'utf8'));
const sys = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));

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
function inst(config) {
  const Cls = loadMain();
  const cc = { rev: 'r1', buttons: [{ id: 'b1', name: 'Cam 1', element: 'key', role: 'key', look: { lines: ['CAM 1'] } }], pages: [] };
  const o = Object.create(Cls.prototype); Object.defineProperty(o, 'label', { value: 'cc' });
  return Object.assign(o, { config, state: null, sys: sys(), cc, deck: deck(), ptzCats: {}, catKeys: {}, holds: new Map(), log() {} });
}

test('Companion lists the CC deck sections first, then CC buttons and pages, and nothing else (0.14.0)', () => {
  const i = inst({});
  const { structure } = G.publishPresets(i.presets());
  const names = structure.map((x) => x.name);
  assert.match(names[0], /^CC deck: Stream Deck \+ XL \(whole deck/);
  assert.ok(names.every((n) => /^CC (deck|buttons|page)/.test(n)), names.find((n) => !/^CC (deck|buttons|page)/.test(n)));
  const firstButtons = names.findIndex((n) => !/^CC deck/.test(n));
  assert.ok(firstButtons > 0 && names.slice(firstButtons).every((n) => !/^CC deck/.test(n)), 'deck sections come first');
});

test('a connection with no deck_surfaces (made before 0.12.0, or moved from the first module id) gets + XL deck pages', () => {
  for (const cfg of [{}, { deck_surfaces: [] }, { deck_surfaces: '' }, { deck_surfaces: ['nope'] }, null]) assert.deepEqual(D.surfaceIds(cfg), ['plusxl']);
  assert.ok(Object.keys(inst({}).presets()).some((id) => id.startsWith('ccd_plusxl_k')));
  // the upgrade script writes the default so the setting shows it
  const r = UpgradeScripts[0]({}, { config: { host: '127.0.0.1', port: 8080 }, actions: [], feedbacks: [] });
  assert.deepEqual(r.updatedConfig.deck_surfaces, ['plusxl']);
  assert.equal(r.updatedConfig.host, '127.0.0.1');
  assert.equal('legacy_presets' in r.updatedConfig, false, '0.14.0: no longer writes the older-presets setting');
  const kept = UpgradeScripts[0]({}, { config: { deck_surfaces: ['plus', 'xl'] }, actions: [], feedbacks: [] });
  assert.equal(kept.updatedConfig, null);
  assert.equal(UpgradeScripts[0]({}, { config: null, actions: [], feedbacks: [] }).updatedConfig, null);
});

test('hello tells the COMPANION tab how many deck presets there are, for which decks, or why none', () => {
  const i = inst({});
  i.deckState = 'ok';
  const h = i.deckHello();
  assert.ok(h.deckPresets > 100);
  assert.deepEqual(h.deckSurfaces, ['plusxl']);
  assert.equal(h.deckState, 'ok');
  const none = Object.assign(inst({}), { deck: null, deckStarted: false });
  assert.deepEqual({ n: none.deckHello().deckPresets, s: none.deckHello().deckState }, { n: 0, s: 'off' });
  const failed = Object.assign(inst({}), { deck: null, deckStarted: true, deckState: 'error', deckError: 'HTTP 404' });
  assert.equal(failed.deckHello().deckError, 'HTTP 404');
});

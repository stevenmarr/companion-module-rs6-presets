'use strict';
// 0.15.0: Companion buttons for Control Center deck keys draw Control Center's own picture (app 0.35.0,
// GET /api/companion/deck/art/<id>.png), fetched once per id; text look before it arrives or with an older app.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/ccdeck');
const A = require('../src/ccart');
const G = require('../src/graphics');

const id = (n) => n.toString(16).padStart(20, '0');
function model() {
  const keys = [{ row: 0, col: 0, lines: ['PAGE', 'HOME'], color: '#FFFFFF', bgcolor: '#243044', pressable: true, img: id(1) }];
  const dials = [{ index: 0, col: 0, label: 'IRIS', lines: ['IRIS', '34'], knob: ['IRIS'], color: '#7c8cff', bgcolor: '#101012', img: id(2), knobImg: id(3) }];
  return {
    rev: 'r1', layoutRev: 'l1',
    art: { url: '/api/companion/deck/art/', ext: '.png', blank: id(9) },
    surfaces: [{ id: 'plusxl', label: 'Stream Deck + XL', cols: 9, rows: 4, knobCols: [0, 2, 3, 5, 6, 8], live: { keys, dials }, pages: [{ id: 'ptz.0', title: 'PTZ', keys, dials: [{ ...dials[0], img: id(4) }] }] },
      { id: 'xl', label: 'Stream Deck XL', cols: 8, rows: 4, knobCols: [], live: { keys: [{ row: 0, col: 0, lines: ['X'], img: id(7) }], dials: [] }, pages: [] }],
    widgets: { gainRb: { label: 'R GAIN', lines: ['R GAIN'], knob: ['GAIN'], color: '#ff8a8f', bgcolor: '#101012', img: id(5), knobImg: id(6) } },
    widgetList: [{ id: 'gainRb', name: 'R GAIN / B GAIN', pair: true }],
  };
}

test('artIds: live and dial displays first, then pages; only the chosen deck sizes; none from an older app', () => {
  const ids = A.artIds(model(), ['plusxl']);
  assert.deepEqual(ids, [id(9), id(1), id(2), id(3), id(5), id(6), id(4)]);
  assert.ok(!ids.includes(id(7)));
  const old = model(); delete old.art;
  assert.deepEqual(A.artIds(old, ['plusxl']), []);
});

test('ArtCache: fetches each id once, at most N at a time, retries a failure later, drops unused pictures', async () => {
  let t = 0; let running = 0; let peak = 0; const asked = [];
  const cache = new A.ArtCache(async (x) => { asked.push(x); running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; if (x === id(2)) throw new Error('HTTP 404'); return `png-${x}`; }, { concurrency: 2, now: () => t });
  const got = await Promise.all([cache.want([id(1), id(2), id(3), id(4)]), cache.want([id(1), id(3)])]);
  assert.deepEqual(got, [3, 0]);
  assert.equal(peak, 2);
  assert.deepEqual(asked.filter((x) => x === id(1)).length, 1, 'fetched once');
  assert.equal(cache.get(id(1)), `png-${id(1)}`);
  assert.equal(cache.get(id(2)), null);
  assert.equal(await cache.want([id(2)]), 0); assert.equal(asked.filter((x) => x === id(2)).length, 1, 'not retried at once');
  t += 11000; await cache.want([id(2)]); assert.equal(asked.filter((x) => x === id(2)).length, 2, 'retried after 10 s');
  cache.keepOnly([id(3)]);
  assert.equal(cache.get(id(1)), null); assert.equal(cache.get(id(3)), `png-${id(3)}`);
});

test('cc_deck_look / cc_dial_look: Control Center picture when held (no text on top), text look until then', () => {
  const m = model(); const held = new Map([[id(1), 'KEYPNG'], [id(2), 'STRIPPNG'], [id(3), 'KNOBPNG'], [id(5), 'WPNG'], [id(9), 'BLANKPNG']]);
  const inst = { deck: m, art: { get: (x) => held.get(x) || null } };
  const fb = D.feedbacks(inst).cc_deck_look;
  assert.ok(fb.affectedProperties.includes('png64'));
  const key = fb.callback({ options: { surface: 'plusxl', part: 'key', row: 0, col: 0, pin: '' } });
  assert.equal(key.png64, 'KEYPNG'); assert.equal(key.text, '');
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'key', row: 3, col: 8, pin: '' } }).png64, 'BLANKPNG', 'an empty key is Control Center\'s empty key');
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'strip', index: 0, pin: '' } }).png64, 'STRIPPNG');
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'knob', index: 0, pin: '' } }).png64, 'KNOBPNG');
  const notYet = fb.callback({ options: { surface: 'plusxl', part: 'strip', index: 0, pin: 'ptz.0' } });
  assert.equal(notYet.png64, undefined); assert.equal(notYet.text, 'IRIS\\n34');
  assert.equal(D.feedbacks(inst).cc_dial_look.callback({ options: { widget: 'gainRb', part: 'strip' } }).png64, 'WPNG');
  assert.equal(D.feedbacks({ deck: m }).cc_deck_look.callback({ options: { surface: 'plusxl', part: 'key', row: 0, col: 0, pin: '' } }).text, 'PAGE\\nHOME', 'no cache: text');
});

test('presets carry the picture when held and never a top bar, so the picture fills the button', () => {
  const m = model(); const art = { get: (x) => (x === id(1) ? 'KEYPNG' : null) };
  const p = G.publishPresets(D.presets(m, ['plusxl'], art)).presets;
  assert.equal(p.ccd_plusxl_k0_0.style.png64, 'KEYPNG');
  assert.equal(p.ccd_plusxl_k0_0.style.text, '');
  assert.equal(p.ccd_plusxl_k0_0.style.show_topbar, false);
  assert.equal(p.ccd_plusxl_ptz_0_s0.style.png64, undefined);
  assert.equal(p.ccd_plusxl_ptz_0_s0.style.show_topbar, false);
  assert.equal(p.ccw_gainRb_strip.style.show_topbar, false);
});

test('main: a new deck model fetches its pictures, redraws, and republishes the presets once per page set', async () => {
  const Module = require('module');
  class InstanceBase { constructor() { this.checked = []; this.published = 0; } updateStatus() {} setVariableDefinitions() {} setVariableValues() {} setPresetDefinitions() { this.published++; } setActionDefinitions() {} setFeedbackDefinitions() {} checkFeedbacks(...ids) { this.checked.push(...ids); } log() {} }
  const captured = {};
  const stub = { InstanceBase, InstanceStatus: {}, Regex: { HOSTNAME: '' }, runEntrypoint: (C) => { captured.Cls = C; } };
  const orig = Module._load;
  Module._load = function (r, ...rest) { return r === '@companion-module/base' ? stub : orig.call(this, r, ...rest); };
  delete require.cache[require.resolve('../src/main.js')];
  require('../src/main.js');
  Module._load = orig;
  const inst = new captured.Cls();
  inst.config = { deck_surfaces: ['plusxl'] };
  inst.art = new A.ArtCache(async (x) => `png-${x}`);
  inst.republishSoon = () => { inst.republished = (inst.republished || 0) + 1; };
  inst.redefine = () => {};
  const m = model();
  inst.applyDeck(m, ['plusxl']);
  await inst.fetchArt(m, ['plusxl']);
  assert.equal(inst.art.get(id(1)), `png-${id(1)}`);
  assert.ok(inst.checked.includes('cc_deck_look'));
  assert.equal(inst.republished, 1);
  const m2 = model(); m2.rev = 'r2'; m2.surfaces[0].live.dials[0].img = id(8);
  inst.applyDeck(m2, ['plusxl']);
  await inst.fetchArt(m2, ['plusxl']);
  assert.equal(inst.republished, 1, 'a new value redraws, it does not republish');
  assert.equal(inst.art.get(id(8)), `png-${id(8)}`);
  assert.equal(inst.art.get(id(2)), null, 'the old value\'s picture is dropped');
});

test('ArtCache: clear() aborts fetches for the old host and drops their answers; after stop() it never fetches', async () => {
  const signals = []; let release;
  const gate = new Promise((r) => { release = r; });
  const cache = new A.ArtCache(async (x, signal) => { signals.push(signal); await gate; return `png-${x}`; });
  const pending = cache.want([id(1), id(2)]);
  await new Promise((r) => setImmediate(r));
  cache.clear();
  assert.ok(signals.length && signals.every((s) => s.aborted), 'running fetches see the abort');
  release();
  assert.equal(await pending, 0, 'nothing to redraw from the old host');
  assert.equal(cache.get(id(1)), null);
  assert.equal(await cache.want([id(1)]), 1, 'fetches again after clear()');
  cache.stop();
  let asked = 0;
  cache.fetchPng = async () => { asked++; return 'x'; };
  assert.equal(await cache.want([id(3)]), 0);
  assert.equal(asked, 0, 'no fetch after stop()');
});

test('main: destroy() aborts picture fetches still running and leaves no redraw or publish timer behind', async () => {
  const Module = require('module');
  const { mockApp } = require('./mock-app');
  const { AppApi } = require('../src/api');
  let closed = 0; let arrived;
  const asked = new Promise((r) => { arrived = r; });
  const srv = mockApp((req, res) => { arrived(); res.on('close', () => { closed++; }); /* never answers */ });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    class InstanceBase { constructor() { this.checked = 0; this.published = 0; } updateStatus() {} setVariableDefinitions() {} setVariableValues() {} setPresetDefinitions() { this.published++; } setActionDefinitions() {} setFeedbackDefinitions() {} checkFeedbacks() { this.checked++; } log() {} }
    const captured = {};
    const stub = { InstanceBase, InstanceStatus: {}, Regex: { HOSTNAME: '' }, runEntrypoint: (C) => { captured.Cls = C; } };
    const orig = Module._load;
    Module._load = function (r, ...rest) { return r === '@companion-module/base' ? stub : orig.call(this, r, ...rest); };
    delete require.cache[require.resolve('../src/main.js')];
    require('../src/main.js');
    Module._load = orig;
    const inst = new captured.Cls();
    inst.config = { deck_surfaces: ['plusxl'] };
    inst.holds = new Map();
    inst.destroyed = false;
    inst.api = new AppApi('127.0.0.1', srv.address().port);
    inst.art = new A.ArtCache((x, signal) => inst.api.ccDeckArt(x, { signal }));
    inst.presetArtPending = true;
    const m = model();
    inst.deck = m;
    const fetching = inst.fetchArt(m, ['plusxl']);
    await asked;
    const checkedBefore = inst.checked;
    await inst.destroy();
    assert.equal(await fetching, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(closed >= 1, 'the open request was aborted');
    assert.equal(inst.checked, checkedBefore, 'no redraw after destroy');
    assert.equal(inst.republishTimer, null, 'no publish timer left');
    inst.republishSoon();
    assert.equal(inst.republishTimer, null, 'a late feedback subscription does not start one either');
    assert.equal(await inst.fetchArt(m, ['plusxl']), 0, 'no fetch after destroy');
  } finally { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
});

test('mock servers answer stray GET / and /favicon.ico (port-forwarding probes) with 404 and never pass them on', async () => {
  const { mockApp } = require('./mock-app');
  const seen = [];
  const srv = mockApp((req, res) => { seen.push(req.url); res.writeHead(200); res.end('{}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
    assert.deepEqual(seen, ['/api/state']);
  } finally { await new Promise((r) => srv.close(r)); }
});

test('ArtCache: one picture at a time by default, across overlapping want() calls (Control Center draws on its main thread)', async () => {
  let running = 0; let peak = 0;
  const cache = new A.ArtCache(async (x) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 3)); running--; return `png-${x}`; });
  const got = await Promise.all([cache.want([id(1), id(2), id(3)]), cache.want([id(4), id(5)]), cache.want([id(6)])]);
  assert.deepEqual(got, [3, 2, 1]);
  assert.equal(peak, 1);
});

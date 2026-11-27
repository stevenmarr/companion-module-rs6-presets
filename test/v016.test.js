'use strict';
// 0.16.0 (overhaul phase 1): no plain-text flash when a value changes; a refused press is a warning, not silence.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/ccdeck');
const A = require('../src/ccart');

const id = (n) => n.toString(16).padStart(20, '0');
function model(stripImg) {
  const keys = [{ row: 0, col: 0, lines: ['PAGE', 'HOME'], color: '#FFFFFF', bgcolor: '#243044', pressable: true, img: id(1) }];
  const dials = [{ index: 0, col: 0, label: 'IRIS', lines: ['IRIS', '34'], knob: ['IRIS'], color: '#7c8cff', bgcolor: '#101012', img: stripImg, knobImg: id(3) }];
  return {
    rev: 'r1', layoutRev: 'l1', art: { url: '/api/companion/deck/art/', ext: '.png', blank: id(9) },
    surfaces: [{ id: 'plusxl', label: 'Stream Deck + XL', cols: 9, rows: 4, knobCols: [0, 2, 3, 5, 6, 8], live: { id: 'ptz.1', keys, dials }, pages: [{ id: 'ptz.0', title: 'PTZ', keys, dials }] }],
    widgets: {}, widgetList: [],
  };
}

test('a strip whose value changed keeps its last picture until the new one arrives (no text look in between)', async () => {
  const art = new A.ArtCache(async (x) => `png-${x}`);
  const o = { surface: 'plusxl', part: 'strip', pin: '', index: 0 };
  await art.want([id(2)]);
  assert.equal(D.slotLook(model(id(2)), o, art).png64, `png-${id(2)}`);
  const look = D.slotLook(model(id(8)), o, art); // iris moved: a new picture id, not fetched yet
  assert.equal(look.png64, `png-${id(2)}`, 'the old frame stays up');
  assert.equal(look.text, '');
  await art.want([id(8)]);
  art.keepOnly([id(8)]);
  assert.equal(D.slotLook(model(id(8)), o, art).png64, `png-${id(8)}`, 'then the new frame');
  // another page is another slot: it never shows this page's old picture
  const other = D.slotLook(model(id(10)), { ...o, pin: 'ptz.0' }, art);
  assert.ok(!other.png64, 'a slot that never had a picture shows the text look');
  art.clear();
  assert.ok(!D.slotLook(model(id(11)), o, art).png64, 'clear() forgets the held frames (new host)');
});

test('run(): a { ok:false } answer and an error both warn and set the status; deck actions skip the extra state fetch', async () => {
  const Module = require('module');
  const InstanceStatus = { Ok: 'ok', UnknownWarning: 'unknown_warning', ConnectionFailure: 'connection_failure', BadConfig: 'bad_config', Connecting: 'connecting' };
  const captured = {};
  class Base { constructor() { this.logs = []; this.status = []; } log(l, m) { this.logs.push([l, m]); } updateStatus(s, m) { this.status.push([s, m]); } setVariableValues() {} checkFeedbacks() {} }
  const stub = { InstanceBase: Base, InstanceStatus, runEntrypoint: (Cls) => { captured.Cls = Cls; }, combineRgb: (r, g, b) => (r << 16) + (g << 8) + b, Regex: {} };
  const orig = Module._load;
  Module._load = function (r, ...rest) { return r === '@companion-module/base' ? stub : orig.call(this, r, ...rest); };
  delete require.cache[require.resolve('../src/main.js')];
  require('../src/main.js');
  Module._load = orig;
  const inst = new captured.Cls();
  let stateGets = 0;
  inst.api = { state: async () => { stateGets++; return {}; } };
  inst.applyState = () => {};
  try {
    await inst.run('CC deck key plusxl 0/3', async () => ({ ok: false, noop: true, reason: 'This key has no function' }), { refetch: false });
    assert.equal(stateGets, 0);
    assert.ok(inst.logs.some(([l, m]) => l === 'warn' && /0\/3: This key has no function/.test(m)), JSON.stringify(inst.logs));
    assert.ok(inst.status.some(([s, m]) => s === 'unknown_warning' && /refused: This key has no function/.test(m)));
    await inst.run('Recall', async () => { throw new Error('Panel is locked'); });
    assert.equal(stateGets, 1, 'other actions still refetch');
    assert.ok(inst.logs.some(([l, m]) => l === 'error' && /Panel is locked/.test(m)));
    inst.lastRefusal = null;
    inst.ccWarnStatus(['The panel is LOCKED (CONSOLE page LOCK): every Stream Deck key and Companion button is refused until UNLOCK.']);
    assert.match(inst.status.at(-1)[1], /panel is LOCKED/);
    inst.ccWarnStatus([]);
    assert.equal(inst.status.at(-1)[0], 'ok', 'cleared when Control Center reports nothing');
  } finally { clearTimeout(inst.refusalTimer); }
});

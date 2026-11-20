'use strict';
// 0.12.0: Control Center deck pages (HOME, PTZ, ATEM, CONSOLE) and the + / + XL touch-strip displays as Companion
// presets, against GET /api/companion/deck from Control Center 0.32.0 (fixture captured from the app in --mock).
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/ccdeck');
const C = require('../src/ccbuttons');
const G = require('../src/graphics');
const model = require('./fixtures/app-deck-0.32.0.json');

const clone = () => JSON.parse(JSON.stringify(model));

test('fixture: Control Center 0.32.0 serves HOME, the PTZ and ATEM pages and the + XL knobs', () => {
  const s = model.surfaces[0];
  assert.equal(s.id, 'plusxl');
  assert.deepEqual(s.knobCols, [0, 2, 3, 5, 6, 8]);
  const ids = s.pages.map((p) => p.id);
  for (const id of ['home.0', 'ptz.0', 'atem.0', 'console.0']) assert.ok(ids.includes(id), id);
  assert.ok(model.widgets.gainRb && model.layoutRev && model.rev);
});

test('presets: the whole deck, every page pinned, and standalone strip displays', () => {
  const p = D.presets(model, ['plusxl']);
  // whole deck: 36 keys, 6 strip cells, 6 knobs
  const whole = Object.keys(p).filter((k) => /^ccd_plusxl_(k\d+_\d+|s\d|e\d)$/.test(k));
  assert.equal(whole.length, 36 + 6 + 6);
  assert.equal(p.ccd_plusxl_k0_0.category, 'CC deck: Stream Deck + XL (whole deck, follows HOME and page keys)');
  assert.deepEqual(p.ccd_plusxl_k0_2.steps[0].down[0], { actionId: 'cc_deck_key', options: { surface: 'plusxl', row: 0, col: 2, event: 'press', pin: '' } });
  assert.equal(p.ccd_plusxl_k0_2.steps[0].up[0].options.event, 'release');
  assert.equal(p.ccd_plusxl_k0_2.style.text, 'OPEN\\nPTZ');
  assert.equal(p.ccd_plusxl_e2.options.rotaryActions, true);
  assert.equal(p.ccd_plusxl_e2.steps[0].rotate_left[0].options.delta, '-1');
  assert.equal(p.ccd_plusxl_e2.steps[0].rotate_right[0].options.event, 'rotate');
  assert.equal(p.ccd_plusxl_s2.steps[0].down[0].options.event, 'tap');
  // a pinned PTZ page: R / B gain strip readout with its knob, same index
  const strip = p.ccd_plusxl_ptz_0_s2;
  assert.ok(strip, 'PTZ page strip cell');
  assert.match(strip.category, /^CC deck: Stream Deck \+ XL · .+ \[ptz\.0\]$/);
  assert.match(strip.style.text, /R GAIN 0\\n B GAIN 0/);
  assert.equal(strip.style.color, 0xff8a8f);
  assert.equal(strip.feedbacks[0].feedbackId, 'cc_deck_look');
  assert.deepEqual(strip.feedbacks[0].options, { surface: 'plusxl', part: 'strip', pin: 'ptz.0', row: 0, col: 0, index: 2 });
  assert.equal(p.ccd_plusxl_ptz_0_e2.steps[0].rotate_right[0].options.pin, 'ptz.0');
  assert.match(p.ccd_plusxl_ptz_0_e2.name, /Knob col 4: GAIN/);
  // standalone dial displays
  assert.equal(p.ccw_gainRb_strip.steps[0].down[0].actionId, 'cc_dial_widget');
  assert.equal(p.ccw_gainRb_knob.steps[0].rotate_left[0].options.delta, '-1');
  assert.equal(p.ccw_gainRb_strip.feedbacks[0].feedbackId, 'cc_dial_look');
  assert.ok(p.ccw_iris_strip && p.ccw_masterDetail_strip && p.ccw_pedRb_knob);
  assert.deepEqual(D.presets(null), {});
  assert.equal(Object.keys(D.presets(model, ['plus'])).filter((k) => k.startsWith('ccd_')).length, 0, 'only the configured sizes');
});

test('deck presets publish as simple presets so the live look feedback is kept', () => {
  const published = G.publishPresets(D.presets(model, ['plusxl']));
  const strip = published.presets.ccd_plusxl_ptz_0_s2;
  assert.equal(strip.type, 'simple');
  assert.equal(strip.feedbacks[0].feedbackId, 'cc_deck_look');
  assert.ok(published.structure.some((c) => c.name.startsWith('CC deck: Stream Deck + XL · ')));
  // CC buttons too (0.12.0): their cc_button_look was dropped by the layered variant
  const cc = G.publishPresets(C.presets({ rev: 'a', buttons: [{ id: 'b1', name: 'CUT', element: 'button', text: 'CUT', look: {}, events: ['press'] }], pages: [] }));
  assert.equal(cc.presets.cc_btn_b1.type, 'simple');
  assert.equal(cc.presets.cc_btn_b1.feedbacks[0].feedbackId, 'cc_button_look');
});

test('cc_deck_look follows the deck: page change, new values, missing slots', () => {
  const inst = { deck: clone() };
  const fb = D.feedbacks(inst).cc_deck_look;
  assert.deepEqual(fb.affectedProperties, ['text', 'color', 'bgcolor']);
  const home = fb.callback({ options: { surface: 'plusxl', part: 'key', row: 0, col: 2, pin: '' } });
  assert.equal(home.text, 'OPEN\\nPTZ');
  // the virtual deck opened PTZ: "live" is now that page
  const ptz = inst.deck.surfaces[0].pages.find((p) => p.id === 'ptz.0');
  inst.deck.surfaces[0].live = { keys: ptz.keys, dials: ptz.dials };
  const knob = fb.callback({ options: { surface: 'plusxl', part: 'strip', index: 2, pin: '' } });
  assert.match(knob.text, /^>R GAIN 0/);
  ptz.dials[2].lines = [' R GAIN +12', '>B GAIN -3', 'AWB'];
  ptz.dials[2].color = '#8fb8ff';
  const after = fb.callback({ options: { surface: 'plusxl', part: 'strip', index: 2, pin: 'ptz.0' } });
  assert.equal(after.text, ' R GAIN +12\\n>B GAIN -3\\nAWB');
  assert.equal(after.color, 0x8fb8ff);
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'knob', index: 2, pin: 'ptz.0' } }).text, 'GAIN\\nR GAIN');
  assert.deepEqual(fb.callback({ options: { surface: 'plus', part: 'key', row: 0, col: 0, pin: '' } }), {});
  assert.equal(fb.callback({ options: { surface: 'plusxl', part: 'key', row: 9, col: 9, pin: '' } }).text, '');
  const wl = D.feedbacks(inst).cc_dial_look;
  assert.deepEqual(wl.affectedProperties, ['text', 'color', 'bgcolor']);
  assert.match(wl.callback({ options: { widget: 'gainRb', part: 'strip' } }).text, /R GAIN/);
  assert.deepEqual(wl.callback({ options: { widget: 'nope', part: 'strip' } }), {});
});

test('actions send the right requests (turns are signed detents, $(this:delta) parsed)', async () => {
  const sent = [];
  const inst = {
    deck: model,
    run: (label, fn) => fn(),
    api: {
      ccDeckKey: async (s, b) => { sent.push(['key', s, b]); return { ok: true }; },
      ccDeckDial: async (s, b) => { sent.push(['dial', s, b]); return { ok: true }; },
      ccDialWidget: async (w, b) => { sent.push(['widget', w, b]); return { ok: true }; },
    },
  };
  const a = D.actions(inst);
  await a.cc_deck_key.callback({ options: { surface: 'plusxl', row: 0, col: 2, event: 'press', pin: '' } });
  await a.cc_deck_dial.callback({ options: { surface: 'plusxl', index: 2, event: 'rotate', delta: '-1', pin: 'ptz.0' } });
  await a.cc_deck_dial.callback({ options: { surface: 'plusxl', index: 2, event: 'rotate', delta: '$(this:delta)', pin: '' } }, { parseVariablesInString: async () => '3' });
  await a.cc_deck_dial.callback({ options: { surface: 'plusxl', index: 2, event: 'push', delta: '', pin: '' } });
  await a.cc_dial_widget.callback({ options: { widget: 'gainRb', event: 'rotate', delta: '' } });
  assert.deepEqual(sent[0], ['key', 'plusxl', { row: 0, col: 2, event: 'press', pin: '' }]);
  assert.deepEqual(sent[1], ['dial', 'plusxl', { index: 2, event: 'rotate', pin: 'ptz.0', ticks: -1 }]);
  assert.equal(sent[2][2].ticks, 3);
  assert.deepEqual(sent[3][2], { index: 2, event: 'push', pin: '' });
  assert.deepEqual(sent[4], ['widget', 'gainRb', { event: 'rotate', ticks: 1 }]);
  assert.ok(a.cc_dial_widget.options[0].choices.some((c) => c.id === 'gainRb' && /R GAIN \/ B GAIN/.test(c.label)));
});

test('variables: the page shown, each knob readout, each standalone dial', () => {
  const defs = D.variableDefinitions(model, ['plusxl']).map((d) => d.variableId);
  for (const id of ['cc_deck_rev', 'cc_deck_plusxl_page', 'cc_strip_plusxl_1', 'cc_strip_plusxl_6', 'cc_dial_gainRb', 'cc_dial_iris']) assert.ok(defs.includes(id), id);
  const v = D.variableValues(model, ['plusxl']);
  assert.equal(v.cc_deck_plusxl_page, 'home.0');
  assert.equal(v.cc_dial_gainRb, 'R GAIN 0 / B GAIN 0');
  assert.equal(v.cc_deck_rev, model.rev);
});

test('config: deck sizes default to the + XL; layoutKey ignores a new value', () => {
  assert.deepEqual(D.surfaceIds({}), ['plusxl']);
  assert.deepEqual(D.surfaceIds({ deck_surfaces: ['plus', 'bogus'] }), ['plus']);
  assert.deepEqual(D.surfaceIds({ deck_surfaces: [] }), ['plusxl']);
  const m2 = clone(); m2.rev = 'other';
  assert.equal(D.layoutKey(m2, ['plusxl']), D.layoutKey(model, ['plusxl']));
  assert.notEqual(D.layoutKey(model, ['plus']), D.layoutKey(model, ['plusxl']));
});

test('0.10 / 0.11 ids are unchanged', () => {
  const a = C.actions({ cc: null });
  assert.ok(a.cc_button_run);
  assert.ok(C.feedbacks({ cc: null }).cc_button_look);
});

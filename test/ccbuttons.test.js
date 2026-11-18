'use strict';
// 0.10.0: Control Center BUTTONS / PAGES as Companion presets, the cc_button_run action and the cc_button_look feedback,
// against GET /api/companion/buttons from Control Center 0.31.0.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/ccbuttons');
const G = require('../src/graphics');

const model = {
  rev: 'abc123.1', appVersion: '0.31.0', apiVersion: 9, moduleId: 'rs6-presets',
  buttons: [
    { id: 'bcut', name: 'CUT', element: 'button', role: 'hot', text: 'CUT', look: { bgcolor: '#FF2D2D', color: '#FFFFFF' }, events: ['press'] },
    { id: 'bpgm', name: 'Program', element: 'button', role: 'program', text: '$(atem:name)', look: { bgcolor: '#101010', color: '#FFFFFF' }, events: ['press', 'release'] },
    { id: 'biris', name: 'Iris', element: 'encoder', role: 'toggle', text: 'IRIS', look: { bgcolor: '#000000', color: '#E0B030' }, events: ['turn', 'push'] },
    { id: 'bseg', name: 'Iris value', element: 'touch-segment', role: 'info', text: 'IRIS', look: { bgcolor: '#000000', color: '#FFFFFF' }, events: ['touch'] },
  ],
  pages: [{ id: 'p1', name: 'Show ATEM', surface: 'plusxl', layout: { label: 'Stream Deck + XL', cols: 9, rows: 4, knobCols: [0, 2, 3, 5, 6, 8], touchRow: 4, encoderRow: 5, companionLayout: 'streamdeck-plus-xl' },
    keys: [{ row: 3, col: 8, buttonId: 'bcut' }, { row: 0, col: 0, buttonId: 'bpgm' }], encoders: [{ col: 2, buttonId: 'biris' }], touch: [{ col: 2, buttonId: 'bseg' }] }],
};

test('presets: one per CC button, and one per page slot in keys / strip / knob order', () => {
  const p = C.presets(model);
  assert.equal(p.cc_btn_bcut.category, 'CC buttons');
  assert.equal(p.cc_btn_bcut.style.bgcolor, 0xff2d2d);
  assert.equal(p.cc_btn_bcut.steps[0].down[0].actionId, 'cc_button_run');
  assert.deepEqual(p.cc_btn_bcut.steps[0].down[0].options, { button: 'bcut', event: 'press', delta: '' });
  assert.equal(p.cc_btn_bpgm.style.text, 'Program', 'a CC variable is not left for Companion to misread');
  assert.equal(p.cc_btn_bpgm.steps[0].up[0].options.event, 'release');
  assert.equal(p.cc_btn_biris.options.rotaryActions, true);
  assert.equal(p.cc_btn_biris.steps[0].rotate_left[0].options.delta, '-1');
  assert.equal(p.cc_btn_biris.steps[0].down[0].options.event, 'push');
  assert.equal(p.cc_btn_bseg.steps[0].down[0].options.event, 'touch');
  const page = Object.keys(p).filter((k) => k.startsWith('cc_pg_p1_'));
  assert.deepEqual(page, ['cc_pg_p1_k0_0', 'cc_pg_p1_k3_8', 'cc_pg_p1_t2', 'cc_pg_p1_e2']);
  assert.equal(p.cc_pg_p1_k3_8.category, 'CC page: Show ATEM (Stream Deck + XL)');
  assert.equal(p.cc_pg_p1_k3_8.name, 'Row 4 col 9: CUT');
  assert.equal(p.cc_pg_p1_e2.name, 'Knob col 3: Iris');
  assert.deepEqual(C.presets(null), {});
  const published = G.publishPresets(p);
  assert.ok(published.structure.some((c) => c.name === 'CC buttons'));
  assert.ok(published.presets.cc_btn_bcut);
});

test('cc_button_run posts the button and event to the app; a knob turn sends the signed delta', async () => {
  const posts = [];
  const inst = { cc: model, log() {}, run: async (l, fn) => fn(), api: { ccRun: async (id, body) => { posts.push([id, body]); return { ok: true, ran: [] }; } } };
  const a = C.actions(inst).cc_button_run;
  assert.equal(a.options[0].choices[0].id, 'bcut');
  await a.callback({ options: { button: 'bcut', event: 'press', delta: '' } });
  await a.callback({ options: { button: 'biris', event: 'turn', delta: '$(this:delta)' } }, { parseVariablesInString: async () => '-3' });
  await a.callback({ options: { button: 'biris', event: 'turn', delta: '' } });
  assert.deepEqual(posts, [['bcut', { event: 'press' }], ['biris', { event: 'turn', delta: -3 }], ['biris', { event: 'turn', delta: 1 }]]);
  const empty = C.actions({ cc: null }).cc_button_run;
  assert.equal(empty.options[0].choices[0].id, '');
});

test('cc_button_look returns the CC text and colors; variables count buttons and pages', () => {
  const f = C.feedbacks({ cc: model }).cc_button_look;
  assert.equal(f.type, 'advanced');
  assert.deepEqual(f.callback({ options: { button: 'bcut' } }), { text: 'CUT', color: 0xffffff, bgcolor: 0xff2d2d });
  assert.deepEqual(f.callback({ options: { button: 'gone' } }), {});
  assert.deepEqual(C.variableValues(model), { cc_buttons_rev: 'abc123.1', cc_button_count: '4', cc_page_count: '1' });
  assert.deepEqual(C.variableValues(null), { cc_buttons_rev: '', cc_button_count: '0', cc_page_count: '0' });
  assert.equal(C.variableDefinitions().length, 3);
  assert.equal(C.deltaOf(' -2 '), -2);
  assert.equal(C.deltaOf('x'), 0);
});

'use strict';
// 0.7.3: published buttons are layered. 0.8.1: one text element per line, styled by what the key does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic');
const X = require('../src/sys');
const G = require('../src/graphics');

const rs6 = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-state-0.3.0.json'), 'utf8'));
const sys = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));

function labelOf(layered) { return layered.elements.find((e) => e.id === 'label'); }
function published() {
  return G.publishPresets({ ...L.buttonPresets(rs6()), ...X.buttonPresets(sys()) });
}

// 0.8.1: every line of a label is its own text element (the fork's text styling: font, weight, styles, outline),
// and each line kind has one size on every key of a type. Text Size is a percent of the element, so the test checks
// the size the key actually gets: fontsize x element height.
const KNOWN = {
  text: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'text', 'fontsize', 'fontsizeAllowShrink', 'font', 'weight', 'styles', 'color', 'outlineColor', 'halign', 'valign'],
  line: ['id', 'type', 'name', 'fromX', 'fromY', 'toX', 'toY', 'borderWidth', 'borderColor', 'borderPosition'],
  box: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'color', 'cornerRadius'],
  image: ['id', 'type', 'name', 'x', 'y', 'width', 'height', 'base64Image', 'fillMode', 'halign', 'valign'],
};
function sizeKind(role, id) {
  if (role === 'lcd') return 'lcd';
  if (id === 'tag') return 'tag';
  if (id === 'detail') return 'detail';
  return role === 'take' || role === 'motion' ? 'verb' : 'name';
}

test('0.8.1 text styling: one element per line, one size per line kind, only properties the fork knows', () => {
  const { structure, presets } = published();
  const all = { ...L.buttonPresets(rs6()), ...X.buttonPresets(sys()) };
  assert.ok(Object.keys(presets).length > 100);
  const listed = structure.flatMap((s) => s.definitions);
  assert.deepEqual(listed.sort(), Object.keys(presets).sort());
  assert.equal(new Set(structure.map((s) => s.id)).size, structure.length, 'section ids unique');

  const roles = new Set();
  for (const [id, p] of Object.entries(presets)) {
    assert.equal(p.type, 'alternatives', id);
    assert.equal(p.variants[0].type, 'layered', id);
    assert.equal(p.variants[1].type, 'simple', id);
    assert.deepEqual(p.variants[1].style, all[id].style, `${id} classic style untouched`);
    const layer = p.variants[0];
    const role = G.roleOf(id, all[id]); roles.add(role);
    assert.equal(layer.canvas.decoration, 'none', id);
    assert.equal(layer.elements[0].id, 'bg', id);
    assert.equal(layer.elements[1].id, 'art', id);
    assert.match(layer.elements[1].base64Image, /^data:image\/png;base64,/, id);
    for (const e of layer.elements) for (const k of Object.keys(e)) assert.ok(KNOWN[e.type].includes(k), `${id} ${e.type}.${k}`);
    const texts = layer.elements.filter((e) => e.type === 'text');
    if (!labelOf(layer)) { assert.equal(layer.elements.length, 2, id); continue; }
    for (const t of texts) {
      const drawn = (t.fontsize * t.height) / 100;
      assert.ok(Math.abs(drawn - G.SIZE[sizeKind(role, t.id)]) < 0.1, `${id} ${t.id} draws ${drawn}% of the key`);
      assert.ok(t.fontsize <= 100, `${id} ${t.id} fontsize ${t.fontsize}`);
      assert.equal(t.fontsizeAllowShrink, true, id);
      assert.ok(['companion-sans', 'companion-mono'].includes(t.font), id);
      assert.ok(['normal', 'bold'].includes(t.weight), id);
      for (const st of t.styles) assert.ok(['italic', 'underline', 'strikethrough'].includes(st), id);
      assert.ok(!/\\n/.test(t.id === 'label' && role !== 'lcd' && role !== 'source' ? t.text : ''), `${id} one line in the main element`);
    }
    const label = labelOf(layer);
    assert.equal(label.outlineColor, G.outlineFor(label.color), id);
    if (label.color === 0xffffff) {
      const a = G.colorAlpha(label.outlineColor);
      assert.ok(a > 0 && a < 1, `${id} white text keeps a soft outline (alpha ${a})`);
    }
    const ids = new Set(layer.elements.map((e) => e.id));
    for (const f of layer.feedbacks) {
      assert.ok(f.styleOverrides.length, `${id} ${f.feedbackId}`);
      assert.ok(!f.style, `${id} ${f.feedbackId} still has a legacy style`);
      for (const o of f.styleOverrides) {
        assert.ok(ids.has(o.elementId), `${id} ${o.elementId}`);
        const el = layer.elements.find((e) => e.id === o.elementId);
        assert.ok(KNOWN[el.type].includes(o.elementProperty), `${id} override ${el.type}.${o.elementProperty}`);
      }
    }
  }
  for (const r of ['source', 'mode', 'take', 'motion', 'step', 'lcd']) assert.ok(roles.has(r), `role ${r} used`);
});

test('0.8.1 text styling: each button function has its own look, feedbacks restyle every line', () => {
  const { presets } = published();
  const el = (id, eid) => presets[id].variants[0].elements.find((e) => e.id === eid);

  // take: the verb large in bold sans, the selection under it in mono
  assert.equal(el('take', 'label').text, 'TAKE');
  assert.equal(el('take', 'label').font, 'companion-sans'); assert.equal(el('take', 'label').weight, 'bold');
  assert.equal(el('take', 'detail').font, 'companion-mono');
  assert.equal(el('e2_take', 'tag').text, 'E2'); assert.equal(el('e2_take', 'label').text, 'TAKE');
  assert.equal(el('atem_ftb', 'label').text, 'FTB');

  // source: a mono caption top left, the name in bold sans; ATEM keeps its gold
  const pgm = presets.atem_pgm_1.variants[0];
  assert.equal(el('atem_pgm_1', 'tag').text, 'PGM'); assert.equal(el('atem_pgm_1', 'tag').halign, 'left');
  assert.equal(el('atem_pgm_1', 'tag').font, 'companion-mono');
  assert.equal(el('atem_pgm_1', 'tag').color, G.ACCENT.atem);
  assert.equal(el('atem_pgm_1', 'label').text, '$(rs6presets:atem_input_1_name)');
  const lit = pgm.feedbacks[0].styleOverrides;
  assert.ok(lit.some((o) => o.elementId === 'art' && String(o.override).startsWith('data:image/png')));
  assert.ok(lit.some((o) => o.elementId === 'tag' && o.elementProperty === 'color'), 'caption follows the lit colour');
  assert.ok(lit.some((o) => o.elementId === 'label' && o.elementProperty === 'color'));

  // mode: centred caption over a hairline, the state below
  assert.equal(el('atem_usk_0_air', 'tag').text, 'KEY 1'); assert.equal(el('atem_usk_0_air', 'label').text, 'ON AIR');
  assert.equal(el('atem_usk_0_air', 'rule').type, 'line');
  assert.equal(el('auto_take', 'tag').text, 'AUTO TAKE');

  // motion (has a release action): the arrow in sans, what it moves in mono
  assert.equal(G.roleOf('ptz_move_up', { style: presets.ptz_move_up.variants[1].style, steps: presets.ptz_move_up.variants[1].steps }), 'motion');
  assert.equal(el('ptz_move_up', 'label').text, '▲'); assert.equal(el('ptz_move_up', 'label').font, 'companion-sans');
  assert.equal(el('ptz_tele', 'label').text, 'TELE'); assert.equal(el('ptz_tele', 'label').font, 'companion-mono');

  // step: caption, the step, the live value in mono
  const step = G.layeredOf({ category: 'ATEM: audio faders', style: { text: 'MIC 1\\n+1 dB\\n$(rs6presets:atem_audio_1_fader)', color: 0xffffff, png64: require('../src/styles').atem }, steps: [{ down: [], up: [] }] }, 'atem_audio_1_up');
  assert.deepEqual(step.elements.filter((e) => e.type === 'text').map((e) => [e.id, e.text]), [['tag', 'MIC 1'], ['label', '+1 dB'], ['detail', '$(rs6presets:atem_audio_1_fader)']]);

  // lcd: mono throughout, header bold and underlined
  assert.deepEqual(el('ptz_status', 'tag').styles, ['underline']); assert.equal(el('ptz_status', 'tag').font, 'companion-mono');
  assert.equal(el('ptz_status', 'label').font, 'companion-mono'); assert.equal(el('ptz_status', 'label').halign, 'left');

  // amber "selected": black text, no outline (the light stroke spiked at sharp joins)
  const dest = Object.values(presets).find((p) => p.variants[0].name.startsWith('Toggle '));
  const sel = dest.variants[0].feedbacks[0].styleOverrides;
  assert.equal(sel.find((o) => o.elementId === 'label' && o.elementProperty === 'color').override, L.COLORS.black);
  assert.equal(sel.find((o) => o.elementId === 'label' && o.elementProperty === 'outlineColor').override, G.NO_OUTLINE);

  // a yellow warning (input without signal, camera offline) strikes the name through
  const problem = presets.input_tally_1.variants[0].feedbacks.find((f) => f.feedbackId === 'input_problem');
  assert.deepEqual(problem.styleOverrides.map((o) => o.elementProperty).sort(), ['color', 'outlineColor', 'styles']);
  assert.deepEqual(problem.styleOverrides.find((o) => o.elementProperty === 'styles').override, ['strikethrough']);
  const offline = presets.ptz_cam_cam1.variants[0].feedbacks.find((f) => f.feedbackId === 'ptz_online');
  assert.ok(offline.styleOverrides.some((o) => o.elementProperty === 'styles'));

  assert.equal(labelOf(presets.logo.variants[0]), undefined, 'logo has no text element');

  const enc = Object.values(presets).find((p) => (p.variants[0].steps[0] || {}).rotate_left);
  assert.ok(enc, 'an encoder preset');
  assert.ok(enc.variants[0].steps[0].rotate_right.length);
  assert.equal(enc.variants[1].options, undefined, 'rotary is detected from the steps, not a flag');
});

test('0.8.1 entrypoint: main.js exports the class for module-base 2 (no runEntrypoint there)', () => {
  const base = require('@companion-module/base');
  assert.equal(base.runEntrypoint, undefined);
  delete require.cache[require.resolve('../src/main.js')];
  const Cls = require('../src/main.js');
  assert.equal(typeof Cls, 'function');
  assert.ok(Cls.prototype instanceof base.InstanceBase);
  assert.ok(Array.isArray(Cls.UpgradeScripts));
});

test('0.7.3 variables publish as an object, not an array', () => {
  const defs = [...L.variableDefinitions(rs6()), ...X.variableDefinitions(sys())];
  const obj = G.variableObject(defs);
  assert.equal(Array.isArray(obj), false);
  assert.equal(obj.last_preset_name.name, defs.find((d) => d.variableId === 'last_preset_name').name);
  assert.equal(typeof obj.atem_program.name, 'string');
  assert.equal(Object.keys(obj).length, new Set(defs.map((d) => d.variableId)).size);
});

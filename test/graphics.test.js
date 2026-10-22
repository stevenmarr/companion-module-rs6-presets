'use strict';
// 0.7.3: published buttons are layered. Text Size is a comfortable percent of the label
// (not 100), Shrink to fit is on, weight is bold, and the outline is actually visible.
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

test('0.7.3 layered text: comfortable size, shrink, bold, a real outline', () => {
  const { structure, presets } = published();
  assert.ok(Object.keys(presets).length > 100);
  const listed = structure.flatMap((s) => s.definitions);
  assert.deepEqual(listed.sort(), Object.keys(presets).sort());
  assert.equal(new Set(structure.map((s) => s.id)).size, structure.length, 'section ids unique');

  for (const [id, p] of Object.entries(presets)) {
    assert.equal(p.type, 'alternatives', id);
    assert.equal(p.variants[0].type, 'layered', id);
    assert.equal(p.variants[1].type, 'simple', id);
    const layer = p.variants[0];
    assert.equal(layer.canvas.decoration, 'none', id);
    assert.equal(layer.elements[0].id, 'bg', id);
    assert.equal(layer.elements[1].id, 'art', id);
    assert.match(layer.elements[1].base64Image, /^data:image\/png;base64,/, id);
    const label = labelOf(layer);
    if (!label) { assert.equal(layer.elements.length, 2, id); continue; }
    assert.ok(label.fontsize >= 24 && label.fontsize <= 46 && label.fontsize !== 100, `${id} fontsize ${label.fontsize}`);
    assert.equal(label.fontsizeAllowShrink, true, id);
    assert.equal(label.weight, 'bold', id);
    assert.equal(label.font, 'companion-sans', id);
    assert.equal(label.fontsize, G.fontSize(label.text), id);
    const a = G.colorAlpha(label.outlineColor);
    assert.ok(a > 0 && a < 1, `${id} outline alpha ${a}`);
    assert.equal(label.x, G.TEXT.x, id);
    for (const f of layer.feedbacks) {
      assert.ok(f.styleOverrides.length, `${id} ${f.feedbackId}`);
      assert.ok(!f.style, `${id} ${f.feedbackId} still has a legacy style`);
      for (const o of f.styleOverrides) assert.ok(['bg', 'art', 'label'].includes(o.elementId), `${id} ${o.elementId}`);
    }
  }
});

test('0.7.3 layered text: line count picks the size, lit feedbacks restyle the same elements', () => {
  const { presets } = published();
  const take = labelOf(presets.take.variants[0]);
  assert.equal(G.linesOf(take.text), 2);
  assert.equal(take.fontsize, G.FONTSIZE[2]);
  const ftb = labelOf(presets.atem_ftb.variants[0]);
  assert.equal(G.linesOf(ftb.text), 1);
  assert.equal(ftb.fontsize, G.FONTSIZE[1]);
  const auto = labelOf(presets.auto_take.variants[0]);
  assert.equal(G.linesOf(auto.text), 3);
  assert.equal(auto.fontsize, G.FONTSIZE[3]);

  const pvw = presets.preset_1.variants[0].feedbacks[0];
  assert.equal(pvw.feedbackId, 'preset_pvw');
  assert.ok(pvw.styleOverrides.some((o) => o.elementId === 'art' && String(o.override).startsWith('data:image/png')));
  assert.ok(pvw.styleOverrides.some((o) => o.elementId === 'bg' && o.elementProperty === 'color'));

  const problem = presets.input_tally_1.variants[0].feedbacks.find((f) => f.feedbackId === 'input_problem');
  assert.deepEqual(problem.styleOverrides.map((o) => o.elementProperty).sort(), ['color', 'outlineColor']);

  const dest = Object.values(presets).find((p) => p.variants[0].name.startsWith('Toggle '));
  const sel = dest.variants[0].feedbacks[0];
  const color = sel.styleOverrides.find((o) => o.elementId === 'label' && o.elementProperty === 'color');
  const outline = sel.styleOverrides.find((o) => o.elementId === 'label' && o.elementProperty === 'outlineColor');
  assert.equal(color.override, L.COLORS.black);
  assert.equal(outline.override, G.OUTLINE_LIGHT);

  assert.equal(labelOf(presets.logo.variants[0]), undefined, 'logo has no text element');

  const enc = Object.values(presets).find((p) => (p.variants[0].steps[0] || {}).rotate_left);
  assert.ok(enc, 'an encoder preset');
  assert.ok(enc.variants[0].steps[0].rotate_right.length);
  assert.equal(enc.variants[1].options, undefined, 'rotary is detected from the steps, not a flag');
});

test('0.7.3 variables publish as an object, not an array', () => {
  const defs = [...L.variableDefinitions(rs6()), ...X.variableDefinitions(sys())];
  const obj = G.variableObject(defs);
  assert.equal(Array.isArray(obj), false);
  assert.equal(obj.last_preset_name.name, defs.find((d) => d.variableId === 'last_preset_name').name);
  assert.equal(typeof obj.atem_program.name, 'string');
  assert.equal(Object.keys(obj).length, new Set(defs.map((d) => d.variableId)).size);
});

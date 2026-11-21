'use strict';
// How presets and variables are published to Companion (module-base 2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic');
const X = require('../src/sys');
const G = require('../src/graphics');
const D = require('../src/ccdeck');

const appState = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-state-0.3.0.json'), 'utf8'));
const sys = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-sys-0.8.0.json'), 'utf8'));

const deck = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-deck-0.32.0.json'), 'utf8'));

test('0.14.0 publish: every Control Center preset is a simple preset in its own section, ids and feedbacks kept', () => {
  const classic = { ...D.presets(deck(), ['plusxl', 'plus']) };
  const { structure, presets } = G.publishPresets(classic);
  assert.ok(Object.keys(presets).length > 100);
  assert.deepEqual(Object.keys(presets).sort(), Object.keys(classic).sort());
  const listed = structure.flatMap((x) => x.definitions);
  assert.deepEqual(listed.sort(), Object.keys(presets).sort());
  assert.equal(new Set(structure.map((x) => x.id)).size, structure.length, 'section ids are unique');
  for (const [id, p] of Object.entries(presets)) {
    assert.equal(p.type, 'simple', id);
    assert.deepEqual(p.feedbacks, classic[id].feedbacks, `${id} keeps its look feedback`);
    assert.equal(p.steps, classic[id].steps);
    assert.equal(p.simpleOnly, undefined, 'internal flag not published');
  }
  const enc = Object.values(presets).find((p) => (p.steps[0] || {}).rotate_left);
  assert.ok(enc && enc.steps[0].rotate_right.length, 'an encoder preset keeps both rotations');
  // a preset without a style is skipped; stepAutoProgress false is carried over
  const odd = G.publishPresets({ a: { name: 'x' }, b: { type: 'button', category: 'Z', name: 'b', style: { text: 'B' }, steps: [{ down: [], up: [] }], options: { stepAutoProgress: false } } });
  assert.deepEqual(Object.keys(odd.presets), ['b']); assert.deepEqual(odd.presets.b.options, { stepAutoProgress: false });
  assert.deepEqual(odd.structure, [{ id: 'z', name: 'Z', definitions: ['b'] }]);
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
  const defs = [...L.variableDefinitions(appState()), ...X.variableDefinitions(sys())];
  const obj = G.variableObject(defs);
  assert.equal(Array.isArray(obj), false);
  assert.equal(obj.last_preset_name.name, defs.find((d) => d.variableId === 'last_preset_name').name);
  assert.equal(typeof obj.atem_program.name, 'string');
  assert.equal(Object.keys(obj).length, new Set(defs.map((d) => d.variableId)).size);
});

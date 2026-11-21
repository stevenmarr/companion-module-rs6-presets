'use strict';
// Publishes the module's presets for Companion's preset API (module-base 2), and the variable definitions object.
// 0.14.0: every preset is a Control Center preset (CC deck pages, CC buttons and pages). Their look comes from an
// advanced feedback (cc_deck_look / cc_button_look), so each one is published as a 'simple' preset, which Companion
// converts with the feedback's affectedProperties. The layered renderer for the pre-0.14.0 per-system sections is gone.

// type 'button' is the old one-argument preset API; the new one calls this 'simple'.
function simpleOf(classic) {
  const preset = { type: 'simple', name: classic.name, style: classic.style, steps: classic.steps, feedbacks: classic.feedbacks || [] };
  if (classic.options && classic.options.stepAutoProgress === false) preset.options = { stepAutoProgress: false };
  return preset;
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'presets';
}

function publishPresets(classic) {
  const presets = {};
  const order = [];
  for (const [id, p] of Object.entries(classic || {})) {
    if (!p || !p.style) continue;
    presets[id] = simpleOf(p);
    order.push([p.category || 'Presets', id]);
  }
  const cats = []; const byCat = new Map();
  for (const [cat, id] of order) {
    if (!byCat.has(cat)) { byCat.set(cat, []); cats.push(cat); }
    byCat.get(cat).push(id);
  }
  const seen = new Set();
  const structure = cats.map((name) => {
    let id = slug(name); let n = 2;
    while (seen.has(id)) id = `${slug(name)}-${n++}`;
    seen.add(id);
    return { id, name, definitions: byCat.get(name) };
  });
  return { structure, presets };
}

// base 2 setVariableDefinitions wants { id: { name } }, and throws on an array.
function variableObject(defs) {
  const out = {};
  for (const d of defs || []) if (d && d.variableId) out[d.variableId] = { name: d.name };
  return out;
}

module.exports = { publishPresets, variableObject, simpleOf };

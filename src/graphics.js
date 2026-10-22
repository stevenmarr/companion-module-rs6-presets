'use strict';
// Turns the classic preset map (type 'button', style.size 'auto') into what Companion 5 draws.
// 'auto' becomes fontsize 100% of the key, which is why labels look oversized and still clip.
// A layered text element can say "start here, then shrink": Text Size is a percent of the
// text element (not 100), Shrink to fit is on, the weight is bold, and an outline keeps the
// glyphs readable on the family art. Hosts that cannot draw layers get the classic style
// as the second alternative. Action and feedback ids are not touched.
//
// Color numbers follow Companion: <= 0xffffff is opaque RGB; above that the top byte is
// inverted alpha (0x000000 is black, 0xff000000 is invisible, 0x40000000 is ~75% black).

const TEXT = { x: 8, y: 12, width: 84, height: 76 };
// Comfortable sizes as a percent of the text element, by how many lines the label has.
// Shrink-to-fit takes over when a variable is longer than the line.
const FONTSIZE = { 1: 46, 2: 34, 3: 28, more: 24 };
const OUTLINE_DARK = 0x40000000; // ~75% black, for light text
const OUTLINE_LIGHT = 0x40ffffff; // ~75% white, for dark text (amber "selected" keys)

function linesOf(text) {
  if (text == null || text === '') return 0;
  // Presets store Companion's line break as the two characters "\n", and a few
  // faces use a real newline. Both draw as separate lines.
  return String(text).split(/\\n|\n/).length;
}

function fontSize(text) {
  const n = linesOf(text);
  if (n <= 1) return FONTSIZE[1];
  if (n === 2) return FONTSIZE[2];
  if (n === 3) return FONTSIZE[3];
  return FONTSIZE.more;
}

function luma(color) {
  const n = Number(color) || 0;
  const r = (n >> 16) & 0xff; const g = (n >> 8) & 0xff; const b = n & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Light glyphs get a dark outline; dark glyphs (black on an amber key) get a light one.
function outlineFor(color) { return luma(color) < 0.45 ? OUTLINE_LIGHT : OUTLINE_DARK; }

// Alpha 0..1. 0xff000000 (the host's "no outline" fallback) is 0 and draws nothing.
function colorAlpha(color) {
  const n = Number(color) >>> 0;
  return n > 0xffffff ? (255 - ((n & 0xff000000) >>> 24)) / 255 : 1;
}

const urlCache = new Map();
function dataUrl(png64) {
  if (!png64) return null;
  const s = String(png64);
  if (s.startsWith('data:')) return s;
  let u = urlCache.get(s);
  if (!u) { u = `data:image/png;base64,${s}`; urlCache.set(s, u); }
  return u;
}

function hasText(style) { return !!(style && String(style.text || '').length); }

function elementsOf(style) {
  const els = [
    { id: 'bg', type: 'box', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: style.bgcolor, cornerRadius: 0 },
    { id: 'art', type: 'image', name: 'Art', x: 0, y: 0, width: 100, height: 100, base64Image: dataUrl(style.png64), fillMode: 'fill', halign: 'center', valign: 'center' },
  ];
  if (!hasText(style)) return els;
  els.push({
    id: 'label', type: 'text', name: 'Label', ...TEXT,
    text: style.text,
    fontsize: fontSize(style.text),
    fontsizeAllowShrink: true,
    font: 'companion-sans',
    weight: 'bold',
    color: style.color,
    outlineColor: outlineFor(style.color),
    halign: 'center',
    valign: 'center',
  });
  return els;
}

function overridesOf(style, labelled) {
  const o = [];
  if (!style) return o;
  if (style.png64) o.push({ elementId: 'art', elementProperty: 'base64Image', override: dataUrl(style.png64) });
  if (style.bgcolor !== undefined) o.push({ elementId: 'bg', elementProperty: 'color', override: style.bgcolor });
  if (labelled && style.color !== undefined) {
    o.push({ elementId: 'label', elementProperty: 'color', override: style.color });
    o.push({ elementId: 'label', elementProperty: 'outlineColor', override: outlineFor(style.color) });
  }
  return o;
}

function stepsOf(steps) {
  return (steps || []).map((s) => {
    const out = { down: s.down || [], up: s.up || [] };
    if (s.rotate_left) out.rotate_left = s.rotate_left;
    if (s.rotate_right) out.rotate_right = s.rotate_right;
    if (s.name) out.name = s.name;
    return out;
  });
}

function layeredOf(classic) {
  const style = classic.style || {};
  const labelled = hasText(style);
  const feedbacks = [];
  for (const f of classic.feedbacks || []) {
    const styleOverrides = overridesOf(f.style, labelled);
    if (!styleOverrides.length) continue;
    const entry = { feedbackId: f.feedbackId, options: f.options || {}, styleOverrides };
    if (f.isInverted) entry.isInverted = true;
    feedbacks.push(entry);
  }
  const preset = {
    type: 'layered',
    name: classic.name,
    elements: elementsOf(style),
    canvas: { decoration: 'none' },
    feedbacks,
    steps: stepsOf(classic.steps),
  };
  if (classic.options && classic.options.stepAutoProgress === false) preset.options = { stepAutoProgress: false };
  return preset;
}

// Fallback for a host that speaks the new preset API but not layered graphics.
// type 'button' is the old one-argument API; the new one calls this 'simple'.
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
    presets[id] = { type: 'alternatives', variants: [layeredOf(p), simpleOf(p)] };
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

module.exports = {
  publishPresets, variableObject, fontSize, outlineFor, colorAlpha, dataUrl, linesOf,
  TEXT, FONTSIZE, OUTLINE_DARK, OUTLINE_LIGHT,
};

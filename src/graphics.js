'use strict';
// Turns the classic preset map (type 'button', style.size 'auto') into what Companion 5 draws.
// 'auto' becomes fontsize 100% of the key, which is why labels look oversized and still clip.
// A layered text element can say "start here, then shrink": Text Size is a percent of the
// text element (not 100), Shrink to fit is on, the weight is bold, and an outline keeps the
// glyphs readable on the family art. Hosts that cannot draw layers get the classic style
// as the second alternative. Action and feedback ids are not touched.
// 0.8.1: one text element per line, styled by what the key does (roleOf / textLayout below).
//
// Color numbers follow Companion: <= 0xffffff is opaque RGB; above that the top byte is
// inverted alpha (0x000000 is black, 0xff000000 is invisible, 0x40000000 is ~75% black).

const BG = require('./styles');

// 0.7.3 geometry (kept for the fallback single label) and sizes by line count.
const TEXT = { x: 8, y: 12, width: 84, height: 76 };
const FONTSIZE = { 1: 46, 2: 34, 3: 28, more: 24 };
const OUTLINE_DARK = 0x40000000; // ~75% black, for light text
const OUTLINE_LIGHT = 0x40ffffff; // ~75% white, for dark text (amber "selected" keys)
const NO_OUTLINE = 0xff000000; // alpha 0: Companion draws no outline

// ---------- 0.8.1 text styling (the fork's text element: font, weight, styles, outline) ----------
// Every line of a label is its own text element, so each line gets its own font, weight and colour. Text Size is a
// percent of the element's height, so a size is given here as a percent of the KEY and converted per element:
// two elements of different heights then draw the same glyph size. One size per line kind, the same on every
// button of a type, so text is the same size across a page. Shrink to fit stays on as a safety net only.
const SIZE = {
  tag: 15, // small mono caption: "PGM", "AUX 1", "IN 3", "KEY 1"
  name: 21, // the thing a source / mode key selects
  verb: 28, // TAKE / CUT / AUTO / FTB / STOP and hold-to-run moves
  detail: 15, // mono line under a verb: the selection, a camera, a value
  lcd: 16, // readouts: every line mono at one size
};
// The art's own accent colour per family (the light tab at the top of each key), used for the small captions.
const ACCENT = {
  preset: 0x8ec2ff, master: 0xc3a6ff, dest: 0x7fe9dc, take: 0xffd0d0, cut: 0xffc4c4, auto: 0xffcf5a,
  tally: 0xd4dbe4, freeze: 0xa8f0ff, backup: 0xffb060, audio: 0xff8ae8, status: 0xc8c8c8, utility: 0xe0e0e0,
  e2: 0xc4f56a, pixelhue: 0xff8fb6, atem: 0xffdc5c, ptz: 0xaab6ff,
};
const WARN = 0xffc800; // the yellow the presets use for offline / no signal
const FAMILY = new Map(Object.entries(BG).map(([k, v]) => [v, k]));

function rgbOf(color) { return (Number(color) || 0) & 0xffffff; }
// Companion colour with alpha 0..1 (above 0xffffff the top byte is inverted alpha)
function withAlpha(color, a) { return ((Math.round((1 - a) * 255) << 24) >>> 0) + rgbOf(color); }

function linesOf(text) {
  if (text == null || text === '') return 0;
  // Presets store Companion's line break as the two characters "\n", and a few
  // faces use a real newline. Both draw as separate lines.
  return String(text).split(/\\n|\n/).length;
}
function splitLines(text) { return String(text == null ? '' : text).split(/\\n|\n/); }
function joinLines(lines) { return lines.join('\\n'); }

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
// 0.8.1: dark glyphs (black on an amber key) get no outline. The light stroke spiked at sharp joins and the
// amber already gives the contrast. OUTLINE_LIGHT stays exported for older callers.
function outlineFor(color) { return luma(color) < 0.45 ? NO_OUTLINE : OUTLINE_DARK; }

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
function familyOf(style) { return (style && FAMILY.get(style.png64)) || null; }

const VERBS = /^(TAKE|CUT|AUTO|FTB|STOP)$/;
const ARROW = /^[▲▼◀▶◤◥◣◢]$/;
const SOURCE_CATEGORY = /preset tiles|destinations|cues|camera select| presets$|Program bus|Preview bus|^ATEM: Aux|^ATEM: Router|^ATEM: macros|^ATEM: SuperSource/;

// What the key does decides its typography:
//   source - selects / recalls a named thing (tiles, memories, bus and router crosspoints, cameras, cues)
//   take   - commits a transition (TAKE, CUT, AUTO, FTB, STOP)
//   motion - runs while held: the key has a release action (pan / tilt, zoom, focus)
//   step   - nudges a value one step and shows it (audio +1 dB, iris +, gain -)
//   mode   - toggles or picks a setting (keys, styles, mute, freeze, auto take, white balance, menu ...)
//   lcd    - shows values (status, readouts, Stream Deck + strips and knobs, backups)
function roleOf(id, classic) {
  const style = classic.style || {};
  const fam = familyOf(style);
  const cat = String(classic.category || '');
  const lines = splitLines(style.text);
  if (fam === 'status' || fam === 'backup' || /knobs/.test(cat)) return 'lcd';
  if (fam === 'take' || fam === 'cut' || id === 'atem_ftb') return 'take';
  const held = (classic.steps || []).some((s) => (s.up || []).length > 0);
  if (held) return 'motion';
  if (lines.length >= 2 && /_(up|down)$/.test(id) && lines[lines.length - 1].includes('$(')) return 'step';
  if (fam === 'preset' || fam === 'master' || fam === 'dest' || fam === 'tally') return 'source';
  if (SOURCE_CATEGORY.test(cat) && !/_on$|_stop$/.test(id)) return 'source';
  return 'mode';
}

// One text element. size is a percent of the key; Text Size is that as a percent of this element.
function textEl(id, name, text, box, size, o) {
  return {
    id, type: 'text', name, x: box.x, y: box.y, width: box.w, height: box.h,
    text,
    fontsize: Math.min(100, Math.round((size / box.h) * 1000) / 10),
    fontsizeAllowShrink: true,
    font: o.font || 'companion-sans',
    weight: o.weight || 'normal',
    styles: o.styles || [],
    color: o.color,
    outlineColor: o.outline === undefined ? outlineFor(o.color) : o.outline,
    halign: o.halign || 'center',
    valign: o.valign || 'center',
  };
}

// The text elements for a key (and the role, for the feedbacks). Element ids: tag (caption above), label (the
// main line - the 0.7.3 id, so feedbacks keep their target), detail (caption below), rule (a hairline).
function textLayout(role, style, fam) {
  const lines = splitLines(style.text).map((l) => l.trim()).filter((l, i, a) => l.length || a.length === 1);
  const main = style.color === undefined ? 0xffffff : style.color;
  const accent = ACCENT[fam] === undefined ? main : ACCENT[fam];
  const capColor = luma(main) < 0.45 ? main : accent; // dark text on a light key keeps its own colour
  const els = [];
  const mono = 'companion-mono';
  const ascii = (t) => /^[\x20-\x7e$():_\-+%.]*$/.test(t);

  if (role === 'lcd') {
    // a readout: mono throughout, left aligned, the first line bold and underlined as its header
    const [head, ...rest] = lines;
    els.push(textEl('tag', 'Header', head, { x: 9, y: 10, w: 82, h: 20 }, SIZE.lcd, { font: mono, weight: 'bold', styles: ['underline'], color: main, halign: 'left', valign: 'top' }));
    if (rest.length) els.push(textEl('label', 'Readout', joinLines(rest), { x: 9, y: 31, w: 82, h: 59 }, SIZE.lcd, { font: mono, color: main, halign: 'left', valign: 'top' }));
    return els;
  }

  if (role === 'take' || role === 'motion') {
    let at = lines.findIndex((l) => (role === 'take' ? VERBS.test(l) : ARROW.test(l)));
    if (at < 0) at = role === 'motion' && lines.length > 1 && !lines[1].includes('$(') ? 1 : 0;
    const before = lines.slice(0, at); const after = lines.slice(at + 1);
    const top = before.length ? 27 : 12; const bottom = after.length ? 68 : 88;
    if (before.length) els.push(textEl('tag', 'Caption', joinLines(before), { x: 8, y: 9, w: 84, h: 17 }, SIZE.tag, { font: mono, weight: 'bold', color: capColor, outline: NO_OUTLINE }));
    // a held move is a verb in mono (machine-like) unless it is an arrow, which the sans fallback fonts draw
    const verbFont = role === 'motion' && ascii(lines[at]) ? mono : 'companion-sans';
    els.push(textEl('label', role === 'take' ? 'Verb' : 'Move', lines[at], { x: 5, y: top, w: 90, h: bottom - top }, SIZE.verb, { font: verbFont, weight: 'bold', color: main }));
    if (after.length) els.push(textEl('detail', 'Detail', joinLines(after), { x: 7, y: 70, w: 86, h: 19 }, SIZE.detail, { font: mono, color: capColor, outline: NO_OUTLINE }));
    return els;
  }

  if (role === 'step') {
    // caption, the step itself, and the live value in mono under it
    const value = lines[lines.length - 1]; const head = lines.slice(0, -1);
    const [cap, stepTxt] = head.length > 1 ? [head.slice(0, -1).join(' '), head[head.length - 1]] : [null, head[0]];
    if (cap) els.push(textEl('tag', 'Caption', cap, { x: 7, y: 10, w: 86, h: 17 }, SIZE.tag, { font: mono, weight: 'bold', color: capColor, outline: NO_OUTLINE }));
    els.push(textEl('label', 'Step', stepTxt, { x: 6, y: cap ? 28 : 14, w: 88, h: cap ? 40 : 54 }, SIZE.name, { weight: 'bold', color: main }));
    els.push(textEl('detail', 'Value', value, { x: 7, y: 70, w: 86, h: 19 }, SIZE.detail, { font: mono, color: capColor, outline: NO_OUTLINE }));
    return els;
  }

  if (lines.length === 1) {
    els.push(textEl('label', 'Label', lines[0], { x: 6, y: 12, w: 88, h: 76 }, SIZE.name, { weight: 'bold', color: main }));
    return els;
  }

  if (role === 'source') {
    // caption top left, the name large below it: reads like a router / switcher crosspoint
    els.push(textEl('tag', 'Caption', lines[0], { x: 9, y: 9, w: 82, h: 17 }, SIZE.tag, { font: mono, weight: 'bold', color: capColor, halign: 'left', outline: NO_OUTLINE }));
    els.push(textEl('label', 'Name', joinLines(lines.slice(1)), { x: 6, y: 28, w: 88, h: 62 }, SIZE.name, { weight: 'bold', color: main }));
    return els;
  }

  // mode: centred caption over a hairline, the state / value below it
  const last = lines[lines.length - 1];
  els.push(textEl('tag', 'Caption', lines.slice(0, -1).join(' '), { x: 7, y: 10, w: 86, h: 17 }, SIZE.tag, { font: mono, weight: 'bold', color: capColor, outline: NO_OUTLINE }));
  els.push({ id: 'rule', type: 'line', name: 'Rule', fromX: 22, fromY: 30, toX: 78, toY: 30, borderWidth: 1.5, borderColor: withAlpha(capColor, 0.55), borderPosition: 'center' });
  els.push(textEl('label', 'State', last, { x: 6, y: 33, w: 88, h: 55 }, SIZE.name, { weight: 'bold', color: main }));
  return els;
}

function elementsOf(style, role) {
  const els = [
    { id: 'bg', type: 'box', name: 'Background', x: 0, y: 0, width: 100, height: 100, color: style.bgcolor, cornerRadius: 0 },
    { id: 'art', type: 'image', name: 'Art', x: 0, y: 0, width: 100, height: 100, base64Image: dataUrl(style.png64), fillMode: 'fill', halign: 'center', valign: 'center' },
  ];
  if (!hasText(style)) return els;
  return els.concat(textLayout(role || 'mode', style, familyOf(style)));
}

// Feedback restyles: the lit art and background, then every text element of the key in the lit text colour.
// Captions follow at 85% so they stay a step quieter than the name. A colour-only feedback (offline, no signal,
// connected) recolours the main text; the yellow warning also strikes it through.
function overridesOf(style, els, role) {
  const o = [];
  if (!style) return o;
  if (style.png64) o.push({ elementId: 'art', elementProperty: 'base64Image', override: dataUrl(style.png64) });
  if (style.bgcolor !== undefined) o.push({ elementId: 'bg', elementProperty: 'color', override: style.bgcolor });
  if (style.color === undefined) return o;
  const lit = !!(style.png64 || style.bgcolor !== undefined);
  const dark = luma(style.color) < 0.45;
  const caption = dark ? style.color : withAlpha(style.color, 0.85);
  const warn = !lit && rgbOf(style.color) === WARN;
  for (const e of els) {
    if (e.type === 'line' && lit) o.push({ elementId: e.id, elementProperty: 'borderColor', override: withAlpha(rgbOf(caption), 0.55) });
    if (e.type !== 'text') continue;
    const isMain = e.id === 'label' || (role === 'lcd' && e.id === 'tag');
    if (!isMain && !lit) continue;
    o.push({ elementId: e.id, elementProperty: 'color', override: isMain ? style.color : caption });
    if (e.outlineColor !== NO_OUTLINE) o.push({ elementId: e.id, elementProperty: 'outlineColor', override: outlineFor(style.color) });
    if (warn && isMain) o.push({ elementId: e.id, elementProperty: 'styles', override: [...new Set([...(e.styles || []), 'strikethrough'])] });
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

function layeredOf(classic, id) {
  const style = classic.style || {};
  const role = roleOf(id || '', classic);
  const elements = elementsOf(style, role);
  const feedbacks = [];
  for (const f of classic.feedbacks || []) {
    const styleOverrides = overridesOf(f.style, elements, role);
    if (!styleOverrides.length) continue;
    const entry = { feedbackId: f.feedbackId, options: f.options || {}, styleOverrides };
    if (f.isInverted) entry.isInverted = true;
    feedbacks.push(entry);
  }
  const preset = {
    type: 'layered',
    name: classic.name,
    elements,
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
    presets[id] = { type: 'alternatives', variants: [layeredOf(p, id), simpleOf(p)] };
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
  publishPresets, variableObject, fontSize, outlineFor, colorAlpha, dataUrl, linesOf, roleOf, layeredOf, withAlpha,
  TEXT, FONTSIZE, OUTLINE_DARK, OUTLINE_LIGHT, NO_OUTLINE, SIZE, ACCENT, WARN,
};

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
  if (classic && classic.role) return classic.role;
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
  const el = {
    id, type: 'text', name, x: box.x, y: box.y, width: box.w, height: box.h,
    text,
    fontsize: Math.min(100, Math.round((size / box.h) * 1000) / 10),
    fontsizeAllowShrink: true,
    font: o.font || 'companion-sans',
    weight: o.weight || 'bold',
    styles: o.styles || [],
    color: o.color,
    outlineColor: o.outline === undefined ? outlineFor(o.color) : o.outline,
    halign: o.halign || 'center',
    valign: o.valign || 'center',
    letterSpacing: o.letterSpacing === undefined ? 0 : o.letterSpacing,
    lineHeight: o.lineHeight === undefined ? 100 : o.lineHeight,
    textTransform: o.textTransform || 'none',
  };
  return el;
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


// ---------- Dark theme brand keys (PVLLC T-Bar / style guide) ----------
// Tokens from 08-display-themes.md + Performance Video software style guide (Dark first).
// Red fill = PGM/LIVE only. Feature ON = outline + ON tag (not red fill). ALL STOP = danger outline + HOLD.
// Fonts (fork feat/lcars-gui): companion-sans Bold labels, companion-mono Bold values,
// companion-brand (Space Grotesk Bold) HOME/section headers, companion-condensed when Arimo overflows.
// HOME mark: flat --text T-Bar (c-t-bar/icon_mark_*), never marketing red live slot.
const THEME = {
  bg: 0x101012,       // --bg
  panel: 0x18181b,    // --panel
  panel2: 0x222226,   // --panel2 (idle chip)
  line: 0x34343a,     // --line
  text: 0xe6e6e8,     // --text (not pure white on Dark)
  dim: 0x9a9aa2,      // --dim
  pgm: 0xc42020,      // --pgm
  onPgm: 0xffffff,    // --on-pgm
  pvw: 0x137a3a,      // --pvw
  onPvw: 0xffffff,
  armed: 0xe0a000,    // --armed
  onArmed: 0x101012,  // --on-armed
  focus: 0x7fb2ff,    // --focus
  danger: 0xc42020,   // --danger-outline
};
// Back-compat aliases used elsewhere in this file / deck.js via exports
const BRAND_BG = THEME.bg;
const BRAND_PANEL = THEME.panel2;
const BRAND_LINE = THEME.line;
const BRAND_TEXT = THEME.text;
const BRAND_DIM = THEME.dim;
const BRAND_RED = THEME.pgm;
const BRAND_PVW = THEME.pvw;
const BRAND_ARMED = THEME.armed;
const CLEAR = 0xff000000;
const CHIP_RADIUS = 18;
const CHIP = { x: 4, y: 4, w: 92, h: 92 };
const HOME_MARK_PNG64 = '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';
const FONT_SANS = 'companion-sans';
const FONT_MONO = 'companion-mono';
const FONT_BRAND = 'companion-brand';

function brandElements(b, style) {
  const kind = b.kind || 'value';
  // PGM/LIVE may set b.bg = THEME.pgm. Feature ON and ALL STOP must NOT use solid red fill.
  const lit = b.bg !== undefined ? b.bg : undefined;
  const isPgm = lit === THEME.pgm || lit === 0xc42020;
  const isPvw = lit === THEME.pvw || lit === 0x137a3a;
  const isArmed = lit === THEME.armed || lit === 0xe0a000;
  const chipFill = lit !== undefined ? lit : THEME.panel2;
  const voidFill = THEME.bg;
  let main = THEME.text;
  let cap = THEME.dim;
  if (isPgm) { main = THEME.onPgm; cap = withAlpha(THEME.onPgm, 0.85); }
  else if (isPvw) { main = THEME.onPvw; cap = withAlpha(THEME.onPvw, 0.85); }
  else if (isArmed) { main = THEME.onArmed; cap = withAlpha(THEME.onArmed, 0.85); }

  const danger = !!b.danger; // ALL STOP / destructive hold
  const featureOn = !!b.featureOn; // idle chrome for a key that can show ON via feedback
  const els = [
    { id: 'bg', type: 'box', name: 'Void', x: 0, y: 0, width: 100, height: 100, color: voidFill, cornerRadius: 0 },
    { id: 'chip', type: 'box', name: 'Chip', x: CHIP.x, y: CHIP.y, width: CHIP.w, height: CHIP.h, color: chipFill, cornerRadius: CHIP_RADIUS,
      borderWidth: danger ? 4.5 : 1.2,
      borderColor: danger ? THEME.danger : (lit !== undefined ? withAlpha(main, 0.18) : THEME.line),
      borderPosition: 'inside' },
    // Selected = thick white ring (feedback sets frame). Idle frame is clear.
    { id: 'frame', type: 'box', name: 'Frame', x: CHIP.x, y: CHIP.y, width: CHIP.w, height: CHIP.h, color: CLEAR, cornerRadius: CHIP_RADIUS, borderWidth: 6, borderColor: CLEAR, borderPosition: 'inside' },
  ];
  const o = { outline: NO_OUTLINE };
  const capEl = (txt, y = 8) => textEl('tag', 'Caption', txt, { x: 10, y, w: 80, h: 16 }, SIZE.tag, { ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: 2 });
  const valEl = (txt) => textEl('detail', 'Value', txt, { x: 10, y: 72, w: 80, h: 18 }, SIZE.detail, { ...o, font: FONT_MONO, weight: 'bold', color: withAlpha(main, 0.9), halign: 'left', letterSpacing: 1 });
  const nameEl = (txt, box, size) => textEl('label', 'Name', txt, box, size, { ...o, font: FONT_SANS, weight: 'bold', color: main, letterSpacing: 0 });

  if (kind === 'home') {
    // T-Bar mark (flat --text) + HOME in companion-brand Bold
    els.push({
      id: 'mark', type: 'image', name: 'T-Bar', x: 22, y: 10, width: 56, height: 48,
      base64Image: dataUrl(HOME_MARK_PNG64), fillMode: 'fit', halign: 'center', valign: 'center',
    });
    els.push(textEl('label', 'Home', b.main || 'HOME', { x: 8, y: 60, w: 84, h: 26 }, SIZE.tag + 2, {
      ...o, font: FONT_BRAND, weight: 'bold', color: main, letterSpacing: -1, textTransform: 'uppercase',
    }));
    return els;
  }

  switch (kind) {
    case 'lcd': {
      els.push(textEl('tag', 'Header', b.cap || '', { x: 10, y: 10, w: 80, h: 16 }, SIZE.lcd, { ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: 2 }));
      els.push(textEl('label', 'Readout', b.main || '', { x: 10, y: 30, w: 80, h: 34 }, SIZE.name, { ...o, font: FONT_MONO, weight: 'bold', color: main, halign: 'left', valign: 'top', letterSpacing: 1 }));
      if (b.value) els.push(textEl('detail', 'Mode', b.value, { x: 10, y: 70, w: 80, h: 18 }, SIZE.detail, { ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top' }));
      return els;
    }
    case 'step': case 'move': {
      if (b.cap) els.push(capEl(b.cap));
      els.push(textEl('label', kind === 'step' ? 'Step' : 'Move', b.main, { x: 8, y: b.cap ? 26 : 12, w: 84, h: b.value ? (b.cap ? 42 : 56) : 72 }, SIZE.verb, { ...o, font: FONT_SANS, weight: 'bold', color: main }));
      if (b.value) els.push(valEl(b.value));
      return els;
    }
    case 'take': {
      // ALL STOP / destructive: idle chip + danger outline (already on chip) + HOLD tag
      els.push(textEl('label', 'Verb', b.main, { x: 8, y: danger ? 22 : 14, w: 84, h: danger ? 44 : 72 }, SIZE.name, { ...o, font: FONT_SANS, weight: 'bold', color: main, letterSpacing: 1, textTransform: 'uppercase' }));
      if (danger) els.push(textEl('tag', 'Hold', 'HOLD', { x: 10, y: 68, w: 80, h: 16 }, SIZE.tag, { ...o, font: FONT_MONO, weight: 'bold', color: THEME.danger, letterSpacing: 3, textTransform: 'uppercase' }));
      return els;
    }
    case 'value': case 'exec': {
      if (b.cap) els.push(capEl(b.cap));
      els.push(nameEl(b.main, { x: 8, y: b.cap ? 28 : 12, w: 84, h: b.value ? 38 : (b.cap ? 56 : 72) }, SIZE.name));
      if (b.value) els.push(valEl(b.value));
      // ON tag slot for feature toggles (feedback sets text/color; never red fill)
      els.push(textEl('on', 'OnTag', '', { x: 62, y: 8, w: 26, h: 12 }, 12, { ...o, font: FONT_MONO, weight: 'bold', color: CLEAR, letterSpacing: 1, textTransform: 'uppercase' }));
      return els;
    }
    default: { // cam, preset, nav
      if (b.cap) els.push(textEl('tag', 'Caption', b.cap, { x: 10, y: 8, w: 80, h: 16 }, SIZE.tag, { ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: 2 }));
      els.push(textEl('label', 'Name', b.main, { x: 8, y: 26, w: 84, h: 42 }, SIZE.name, { ...o, font: FONT_SANS, weight: 'bold', color: main, halign: 'left' }));
      if (b.value) els.push(valEl(b.value));
      // Corner tally tags (empty until feedback / lit fill); redundant coding with fill + ring
      const pgmTxt = (isPgm || b.tag === 'PGM') ? 'PGM' : '';
      const pvwTxt = (isPvw || b.tag === 'PVW') ? 'PVW' : '';
      els.push(textEl('pgm', 'PgmTag', pgmTxt, { x: 58, y: 8, w: 30, h: 14 }, 12, { ...o, font: FONT_MONO, weight: 'bold', color: pgmTxt ? THEME.onPgm : CLEAR, letterSpacing: 1, textTransform: 'uppercase' }));
      els.push(textEl('pvw', 'PvwTag', pvwTxt, { x: 58, y: 8, w: 30, h: 14 }, 12, { ...o, font: FONT_MONO, weight: 'bold', color: pvwTxt ? THEME.onPvw : CLEAR, letterSpacing: 1, textTransform: 'uppercase' }));
      return els;
    }
  }
}
// feedback style keys: bgcolor (fills the chip), color (text), frame (selected ring), strike, onTag
function brandOverrides(style, els) {
  const o = [];
  if (!style) return o;
  if (style.bgcolor !== undefined) {
    o.push({ elementId: 'chip', elementProperty: 'color', override: style.bgcolor });
    const isPgm = style.bgcolor === THEME.pgm || style.bgcolor === 0xc42020;
    const isArmed = style.bgcolor === THEME.armed || style.bgcolor === 0xe0a000;
    const isPvw = style.bgcolor === THEME.pvw || style.bgcolor === 0x137a3a;
    o.push({ elementId: 'chip', elementProperty: 'borderColor', override: isPgm || isPvw || isArmed ? withAlpha(0xffffff, 0.18) : THEME.line });
    if (isPgm) {
      const has = els.some((e) => e.id === 'pgm');
      if (has) o.push({ elementId: 'pgm', elementProperty: 'text', override: 'PGM' }, { elementId: 'pgm', elementProperty: 'color', override: THEME.onPgm });
    }
  }
  // Feature ON: keep panel2 fill; show ON tag + focus/outline — never red fill
  if (style.featureOn) {
    o.push({ elementId: 'chip', elementProperty: 'borderColor', override: THEME.focus });
    o.push({ elementId: 'chip', elementProperty: 'borderWidth', override: 2.5 });
    if (els.some((e) => e.id === 'on')) {
      o.push({ elementId: 'on', elementProperty: 'text', override: 'ON' });
      o.push({ elementId: 'on', elementProperty: 'color', override: THEME.text });
    }
  }
  if (style.frame !== undefined) o.push({ elementId: 'frame', elementProperty: 'borderColor', override: style.frame });
  for (const e of els) {
    if (e.type !== 'text') continue;
    const isMain = e.id === 'label';
    if (style.color !== undefined) o.push({ elementId: e.id, elementProperty: 'color', override: isMain ? style.color : withAlpha(rgbOf(style.color), 0.85) });
    if (style.strike && isMain) o.push({ elementId: e.id, elementProperty: 'styles', override: [...new Set([...(e.styles || []), 'strikethrough'])] });
  }
  return o;
}
function brandLayered(classic) {
  const elements = brandElements(classic.brand, classic.style);
  const feedbacks = [];
  for (const f of classic.feedbacks || []) {
    const styleOverrides = brandOverrides(f.style, elements);
    if (!styleOverrides.length) continue;
    feedbacks.push({ feedbackId: f.feedbackId, options: f.options, isInverted: f.isInverted, styleOverrides });
  }
  return { type: 'layered', name: classic.name, canvas: { decoration: false, showStatusIcons: false }, elements, feedbacks };
}
// the classic fallback cannot draw a frame or strike: it keeps the colours only
function classicFeedbacks(list) {
  return (list || []).map((f) => { const { frame, strike, ...st } = f.style || {}; return { ...f, style: frame !== undefined && !Object.keys(st).length ? { color: frame } : st }; });
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
  if (classic.brand) return brandLayered(classic);
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
  const preset = { type: 'simple', name: classic.name, style: classic.style, steps: classic.steps, feedbacks: classic.brand ? classicFeedbacks(classic.feedbacks) : (classic.feedbacks || []) };
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
  publishPresets, variableObject, THEME, BRAND_BG, BRAND_PANEL, BRAND_LINE, BRAND_TEXT, BRAND_DIM, BRAND_RED, BRAND_PVW, BRAND_ARMED, brandElements, brandLayered, fontSize, outlineFor, colorAlpha, dataUrl, linesOf, roleOf, layeredOf, withAlpha,
  TEXT, FONTSIZE, OUTLINE_DARK, OUTLINE_LIGHT, NO_OUTLINE, SIZE, ACCENT, WARN,
};

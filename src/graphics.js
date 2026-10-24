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


// ---------- Control-app brand keys (Performance Video Control UI → Stream Deck) ----------
// Source of truth: rs6-presets/public/style.css (.ctl-t, .mode, .pcard, .rcp-read, .rcp-allstop)
// + Brand Dark tokens (08-display-themes). Companion is host only — no stock topbar / LCARS chrome.
//
// App → key mapping (Dark):
//   .ctl-t / .mode.ctl-t  → full-bleed --panel2 tile, caption+value LEFT stack (not centered blob)
//   .mode.active / .ptab.on → accent fill #3B8CFF (feature ON); red reserved for PGM/LIVE only
//   .rcp-allstop          → #3A0D10 fill + --pgm border + soft red text
//   .cam-strip .cam       → caption / name / state; selected = white ring; tally = --pgm fill
//   .rcp-read .rd         → lcd: wide-track caption + mono value
// Geometry: cornerRadius % of shorter side. App .mode radius 8px on ~70–86px ≈ 10–12% → 12.
// letterSpacing is % of font size (Skia); app captions use .14em → 14.
const THEME = {
  bg: 0x101012,       // --bg
  panel: 0x18181b,    // --panel
  panel2: 0x222226,   // --panel2 / idle .ctl-t / .mode
  line: 0x34343a,     // --line
  text: 0xe6e6e8,     // --text
  dim: 0x9a9aa2,      // --dim
  pgm: 0xc42020,      // --pgm — true program / live tally only
  onPgm: 0xffffff,
  pvw: 0x137a3a,
  onPvw: 0xffffff,
  armed: 0xe0a000,
  onArmed: 0x101012,
  focus: 0x7fb2ff,    // --focus
  accent: 0x3b8cff,   // app --accent (.mode.active fill)
  danger: 0xc42020,
  allstopBg: 0x3a0d10, // .rcp-allstop
  allstopText: 0xffb3b6,
  onAccent: 0xffffff,
};
const BRAND_BG = THEME.bg;
const BRAND_PANEL = THEME.panel2;
const BRAND_LINE = THEME.line;
const BRAND_TEXT = THEME.text;
const BRAND_DIM = THEME.dim;
const BRAND_RED = THEME.pgm;
const BRAND_PVW = THEME.pvw;
const BRAND_ARMED = THEME.armed;
const CLEAR = 0xff000000;
const CHIP_RADIUS = 12;
const CHIP = { x: 0, y: 0, w: 100, h: 100 };
const BORDER_IDLE = 1.5;
const BORDER_ACTIVE = 2.5;
const BORDER_DANGER = 3.5;
const BORDER_SEL = 5;
const TRACK_CAP = 14;
const TRACK_MODE = 8;
const HOME_MARK_PNG64 = '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';
const FONT_SANS = 'companion-sans';
const FONT_MONO = 'companion-mono';
const FONT_BRAND = 'companion-brand';

function brandElements(b, style) {
  const kind = b.kind || 'value';
  const lit = b.bg !== undefined ? b.bg : undefined;
  const isPgm = lit === THEME.pgm || lit === 0xc42020;
  const isPvw = lit === THEME.pvw || lit === 0x137a3a;
  const isArmed = lit === THEME.armed || lit === 0xe0a000;
  const isAccent = lit === THEME.accent || lit === 0x3b8cff;
  const danger = !!b.danger;
  let chipFill = THEME.panel2;
  let borderCol = THEME.line;
  let borderW = BORDER_IDLE;
  let main = THEME.text;
  let cap = THEME.dim;
  if (danger) {
    chipFill = THEME.allstopBg;
    borderCol = THEME.danger;
    borderW = BORDER_DANGER;
    main = THEME.allstopText;
    cap = withAlpha(THEME.allstopText, 0.85);
  } else if (lit !== undefined) {
    chipFill = lit;
    if (isPgm) { main = THEME.onPgm; cap = withAlpha(THEME.onPgm, 0.85); borderCol = withAlpha(0xffffff, 0.22); }
    else if (isPvw) { main = THEME.onPvw; cap = withAlpha(THEME.onPvw, 0.85); borderCol = withAlpha(0xffffff, 0.22); }
    else if (isArmed) { main = THEME.onArmed; cap = withAlpha(THEME.onArmed, 0.85); borderCol = withAlpha(0x000000, 0.25); }
    else if (isAccent) { main = THEME.onAccent; cap = withAlpha(THEME.onAccent, 0.85); borderCol = THEME.accent; }
    else { borderCol = withAlpha(main, 0.2); }
  }

  const els = [
    { id: 'bg', type: 'box', name: 'Void', x: 0, y: 0, width: 100, height: 100, color: THEME.bg, cornerRadius: 0 },
    {
      id: 'chip', type: 'box', name: 'Control', x: CHIP.x, y: CHIP.y, width: CHIP.w, height: CHIP.h,
      color: chipFill, cornerRadius: CHIP_RADIUS,
      borderWidth: borderW, borderColor: borderCol, borderPosition: 'inside',
    },
    {
      id: 'frame', type: 'box', name: 'Selected', x: CHIP.x, y: CHIP.y, width: CHIP.w, height: CHIP.h,
      color: CLEAR, cornerRadius: CHIP_RADIUS, borderWidth: BORDER_SEL, borderColor: CLEAR, borderPosition: 'inside',
    },
  ];
  const o = { outline: NO_OUTLINE };
  const capEl = (txt, y = 10) => textEl('tag', 'Caption', txt, { x: 8, y, w: 70, h: 16 }, SIZE.tag, {
    ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top',
    letterSpacing: TRACK_CAP, textTransform: 'uppercase',
  });
  const valEl = (txt) => textEl('detail', 'Value', txt, { x: 8, y: 74, w: 84, h: 18 }, SIZE.detail, {
    ...o, font: FONT_MONO, weight: 'bold', color: withAlpha(main, 0.92), halign: 'left', valign: 'center',
    letterSpacing: 2,
  });
  const mainEl = (txt, box, size, extra = {}) => textEl('label', 'Name', txt, box, size, {
    ...o, font: FONT_SANS, weight: 'bold', color: main, halign: 'left', valign: 'center',
    letterSpacing: TRACK_MODE, ...extra,
  });

  if (kind === 'home') {
    els.push({
      id: 'mark', type: 'image', name: 'M4 Viewport', x: 22, y: 12, width: 56, height: 46,
      base64Image: HOME_MARK_PNG64, fillMode: 'fit', halign: 'center', valign: 'center',
    });
    els.push(textEl('label', 'Home', b.main || 'HOME', { x: 8, y: 62, w: 84, h: 26 }, SIZE.tag + 2, {
      ...o, font: FONT_BRAND, weight: 'bold', color: main, letterSpacing: 6, textTransform: 'uppercase',
    }));
    return els;
  }

  switch (kind) {
    case 'lcd': {
      els.push(textEl('tag', 'Header', b.cap || '', { x: 8, y: 10, w: 84, h: 16 }, SIZE.lcd, {
        ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: TRACK_CAP, textTransform: 'uppercase',
      }));
      els.push(textEl('label', 'Readout', b.main || '', { x: 8, y: 30, w: 84, h: 36 }, SIZE.name, {
        ...o, font: FONT_MONO, weight: 'bold', color: main, halign: 'left', valign: 'top', letterSpacing: 1,
      }));
      if (b.value) {
        els.push(textEl('detail', 'Mode', b.value, { x: 8, y: 72, w: 84, h: 18 }, SIZE.detail, {
          ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: 2,
        }));
      }
      return els;
    }
    case 'step': case 'move': {
      if (b.cap) els.push(capEl(b.cap));
      const top = b.cap ? 28 : 14;
      const h = b.value ? (b.cap ? 40 : 52) : (b.cap ? 56 : 72);
      els.push(textEl('label', kind === 'step' ? 'Step' : 'Move', b.main, { x: 6, y: top, w: 88, h }, SIZE.verb, {
        ...o, font: FONT_SANS, weight: 'bold', color: main, halign: 'center', letterSpacing: 0,
      }));
      if (b.value) els.push(valEl(b.value));
      return els;
    }
    case 'take': {
      els.push(textEl('label', 'Verb', b.main, { x: 8, y: danger ? 18 : 14, w: 84, h: danger ? 42 : 72 }, SIZE.name, {
        ...o, font: FONT_SANS, weight: 'bold', color: main, letterSpacing: TRACK_MODE, textTransform: 'uppercase', halign: 'left',
      }));
      if (danger) {
        els.push(textEl('tag', 'Hold', 'HOLD', { x: 8, y: 68, w: 84, h: 18 }, SIZE.tag, {
          ...o, font: FONT_MONO, weight: 'bold', color: THEME.danger, letterSpacing: TRACK_CAP, textTransform: 'uppercase', halign: 'left',
        }));
      }
      return els;
    }
    case 'value': case 'exec': {
      if (b.cap) els.push(capEl(b.cap));
      const top = b.cap ? 30 : 14;
      const h = b.value ? 36 : (b.cap ? 50 : 72);
      els.push(mainEl(b.main, { x: 8, y: top, w: 84, h }, SIZE.name, { textTransform: kind === 'exec' ? 'uppercase' : 'none' }));
      if (b.value) els.push(valEl(b.value));
      els.push(textEl('on', 'OnTag', '', { x: 64, y: 10, w: 28, h: 14 }, 11, {
        ...o, font: FONT_MONO, weight: 'bold', color: CLEAR, letterSpacing: 2, textTransform: 'uppercase', halign: 'right',
      }));
      return els;
    }
    default: {
      if (b.cap) {
        els.push(textEl('tag', 'Caption', b.cap, { x: 8, y: 10, w: 56, h: 16 }, SIZE.tag, {
          ...o, font: FONT_MONO, weight: 'bold', color: cap, halign: 'left', valign: 'top', letterSpacing: TRACK_CAP, textTransform: 'uppercase',
        }));
      }
      els.push(textEl('label', 'Name', b.main, { x: 8, y: 28, w: 84, h: 40 }, SIZE.name, {
        ...o, font: FONT_SANS, weight: 'bold', color: main, halign: 'left', letterSpacing: 0,
      }));
      if (b.value) els.push(valEl(b.value));
      const pgmTxt = (isPgm || b.tag === 'PGM') ? 'PGM' : '';
      const pvwTxt = (isPvw || b.tag === 'PVW') ? 'PVW' : '';
      els.push(textEl('pgm', 'PgmTag', pgmTxt, { x: 58, y: 10, w: 34, h: 14 }, 11, {
        ...o, font: FONT_MONO, weight: 'bold', color: pgmTxt ? THEME.onPgm : CLEAR, letterSpacing: 2, textTransform: 'uppercase', halign: 'right',
      }));
      els.push(textEl('pvw', 'PvwTag', pvwTxt, { x: 58, y: 10, w: 34, h: 14 }, 11, {
        ...o, font: FONT_MONO, weight: 'bold', color: pvwTxt ? THEME.onPvw : CLEAR, letterSpacing: 2, textTransform: 'uppercase', halign: 'right',
      }));
      return els;
    }
  }
}

function brandOverrides(style, els) {
  const o = [];
  if (!style) return o;
  if (style.bgcolor !== undefined) {
    o.push({ elementId: 'chip', elementProperty: 'color', override: style.bgcolor });
    const isPgm = style.bgcolor === THEME.pgm || style.bgcolor === 0xc42020;
    const isArmed = style.bgcolor === THEME.armed || style.bgcolor === 0xe0a000;
    const isPvw = style.bgcolor === THEME.pvw || style.bgcolor === 0x137a3a;
    const isAccent = style.bgcolor === THEME.accent || style.bgcolor === 0x3b8cff;
    let edge = THEME.line;
    if (isPgm || isPvw) edge = withAlpha(0xffffff, 0.22);
    else if (isArmed) edge = withAlpha(0x000000, 0.25);
    else if (isAccent) edge = THEME.accent;
    o.push({ elementId: 'chip', elementProperty: 'borderColor', override: edge });
    if (isPgm && els.some((e) => e.id === 'pgm')) {
      o.push({ elementId: 'pgm', elementProperty: 'text', override: 'PGM' }, { elementId: 'pgm', elementProperty: 'color', override: THEME.onPgm });
    }
  }
  // Feature ON → app .mode.active (accent fill + white text). Never PGM red.
  if (style.featureOn) {
    o.push({ elementId: 'chip', elementProperty: 'color', override: THEME.accent });
    o.push({ elementId: 'chip', elementProperty: 'borderColor', override: THEME.accent });
    o.push({ elementId: 'chip', elementProperty: 'borderWidth', override: BORDER_ACTIVE });
    for (const e of els) {
      if (e.type !== 'text') continue;
      if (e.id === 'on') {
        o.push({ elementId: 'on', elementProperty: 'text', override: 'ON' });
        o.push({ elementId: 'on', elementProperty: 'color', override: THEME.onAccent });
      } else if (e.id === 'label') {
        o.push({ elementId: e.id, elementProperty: 'color', override: THEME.onAccent });
      } else if (e.id === 'tag' || e.id === 'detail') {
        o.push({ elementId: e.id, elementProperty: 'color', override: withAlpha(THEME.onAccent, 0.85) });
      }
    }
  }
  if (style.frame !== undefined) o.push({ elementId: 'frame', elementProperty: 'borderColor', override: style.frame });
  for (const e of els) {
    if (e.type !== 'text') continue;
    if (style.featureOn) continue;
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
    const entry = { feedbackId: f.feedbackId, options: f.options || {}, styleOverrides };
    if (f.isInverted) entry.isInverted = true;
    feedbacks.push(entry);
  }
  const preset = {
    type: 'layered',
    name: classic.name,
    // Enum strings required — boolean false leaves global TopBar (Companion stock chrome).
    canvas: { decoration: 'none', showStatusIcons: 'none' },
    elements,
    feedbacks,
    steps: stepsOf(classic.steps),
  };
  if (classic.options && classic.options.stepAutoProgress === false) preset.options = { stepAutoProgress: false };
  if (classic.options && classic.options.rotaryActions) {
    preset.options = { ...(preset.options || {}), rotaryActions: true };
  }
  return preset;
}
// the classic fallback cannot draw a frame or strike: it keeps the colours only
function classicFeedbacks(list) {
  return (list || []).map((f) => {
    const { frame, strike, featureOn, ...st } = f.style || {};
    return { ...f, style: frame !== undefined && !Object.keys(st).length ? { color: frame } : st };
  });
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

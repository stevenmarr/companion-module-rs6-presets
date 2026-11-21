'use strict';
// 0.12.0: Control Center DECK PAGES in Companion. The pages Control Center draws on a USB Stream Deck (HOME, the
// PTZ paint / preset / lens pages with their knobs, the ATEM switcher page, CONSOLE) are not in the BUTTONS / PAGES
// library, so 0.10 / 0.11 could not show them. Control Center 0.32.0 serves them on GET /api/companion/deck (feature
// "companionDeck"): one virtual deck per surface size, what it shows now ("live") and every system page ("pages"),
// with a touch-strip readout and a knob per dial (R / B gain, iris, detail ...). This file turns that into presets,
// two actions (cc_deck_key, cc_deck_dial), standalone dial knobs (cc_dial_widget), two look feedbacks
// (cc_deck_look, cc_dial_look) and readout variables. Pure functions only.
//
// Companion has no separate encoder display: on a Stream Deck + / + XL the touch strip is a row of buttons under the
// keys (each strip cell is drawn from the button in that cell) and the knobs are the row under that. So a "strip
// display" is a button in the strip row whose look follows the knob's label and live value.

const FEATURE = 'companionDeck'; // GET /api/version from Control Center 0.32.0
const SURFACES = [
  { id: 'plusxl', label: 'Stream Deck + XL' },
  { id: 'plus', label: 'Stream Deck +' },
  { id: 'xl', label: 'Stream Deck XL' },
  { id: 'mk2', label: 'Stream Deck MK.2' },
];
const DEFAULT_SURFACES = ['plusxl'];
const PARTS = [{ id: 'key', label: 'Key' }, { id: 'strip', label: 'Touch-strip cell (readout above a knob)' }, { id: 'knob', label: 'Knob (encoder)' }];
const KEY_EVENTS = [{ id: 'press', label: 'Press' }, { id: 'release', label: 'Release' }];
const DIAL_EVENTS = [
  { id: 'rotate', label: 'Turn (use delta)' },
  { id: 'down', label: 'Knob pushed down (long push resets)' },
  { id: 'up', label: 'Knob released' },
  { id: 'push', label: 'Push (toggle, e.g. R ↔ B gain)' },
  { id: 'tap', label: 'Touch the strip cell' },
];
const WIDGET_EVENTS = DIAL_EVENTS.concat([{ id: 'reset', label: 'Reset the value' }]);
const STRIP_BG = 0x101012;
const KNOB_FG = 0xe6e6e8;

const hex = (h, fallback) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); return m ? parseInt(m[1], 16) : fallback; };
const surfacesOf = (m) => (m && Array.isArray(m.surfaces) ? m.surfaces : []);
const safe = (s) => String(s).replace(/[^\w]/g, '_');
const deltaOf = (v) => { const n = Number(String(v == null ? '' : v).trim()); return Number.isFinite(n) ? Math.trunc(n) : 0; };
const joinText = (lines) => (lines || []).map((l) => String(l)).filter((l) => l.trim()).join('\\n');
const oneLine = (lines) => (lines || []).map((l) => String(l).replace(/^>/, '').trim()).filter(Boolean).join(' / ');

function surfaceIds(config) {
  const raw = config && config.deck_surfaces;
  const list = (Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : DEFAULT_SURFACES).map((s) => String(s).trim());
  const ok = list.filter((id) => SURFACES.some((s) => s.id === id));
  return ok.length ? ok : DEFAULT_SURFACES.slice();
}

function faceOf(model, surface, pin) {
  const s = surfacesOf(model).find((x) => x.id === surface);
  if (!s) return null;
  if (!pin) return s.live || null;
  return (s.pages || []).find((p) => p.id === pin) || null;
}

// 0.15.0: with Control Center 0.35.0 a slot also has "img", the id of the picture Control Center draws there (see
// ccart.js). art.get(id) is that picture as base64 PNG once fetched: the button then shows exactly Control Center's
// key (no text of ours on top). Until it arrives, or with an older Control Center, the text look below is used.
function pictured(look, id, art) {
  const png = id && art && typeof art.get === 'function' ? art.get(id) : null;
  return png ? { text: '', png64: png, pngalignment: 'center:center', color: look.color, bgcolor: STRIP_BG } : look;
}

// The look of one slot: { text, color, bgcolor } (Companion style values), or with a picture { png64, text: '' },
// or null when the slot is unknown.
function slotLook(model, o, art) {
  const face = faceOf(model, o.surface, String(o.pin || ''));
  if (!face) return null;
  const blank = model && model.art && model.art.blank;
  if (o.part === 'key') {
    const k = (face.keys || []).find((x) => x.row === Number(o.row) && x.col === Number(o.col));
    if (!k) return pictured({ text: '', color: KNOB_FG, bgcolor: 0x222226 }, blank, art);
    return pictured({ text: joinText(k.lines), color: hex(k.color, 0xffffff), bgcolor: hex(k.bgcolor, 0x000000) }, k.img, art);
  }
  const d = (face.dials || []).find((x) => x.index === Number(o.index));
  if (!d) return { text: '', color: KNOB_FG, bgcolor: STRIP_BG };
  if (o.part === 'knob') return pictured({ text: joinText(d.knob), color: KNOB_FG, bgcolor: STRIP_BG }, d.knobImg, art);
  return pictured({ text: joinText(d.lines), color: hex(d.color, 0xffffff), bgcolor: hex(d.bgcolor, STRIP_BG) }, d.img, art);
}

function widgetLook(model, widget, part, art) {
  const w = model && model.widgets && model.widgets[widget];
  if (!w) return null;
  if (part === 'knob') return pictured({ text: joinText(w.knob), color: KNOB_FG, bgcolor: STRIP_BG }, w.knobImg, art);
  return pictured({ text: joinText(w.lines), color: hex(w.color, 0xffffff), bgcolor: hex(w.bgcolor, STRIP_BG) }, w.img, art);
}

// A preset's own style: the current look (picture if held), no top bar, so the picture fills the button.
const styleOf = (st) => {
  const out = { text: st.text, size: 'auto', color: st.color, bgcolor: st.bgcolor, show_topbar: false };
  if (st.png64) { out.png64 = st.png64; out.pngalignment = 'center:center'; }
  return out;
};

// ---------- presets ----------
const look = (part, o) => ({ feedbackId: 'cc_deck_look', options: { surface: o.surface, part, pin: o.pin || '', row: o.row || 0, col: o.col || 0, index: o.index || 0 } });
const keyAct = (o, event) => ({ actionId: 'cc_deck_key', options: { surface: o.surface, row: o.row, col: o.col, event, pin: o.pin || '' } });
const dialAct = (o, event, delta = '') => ({ actionId: 'cc_deck_dial', options: { surface: o.surface, index: o.index, event, delta, pin: o.pin || '' } });

// simpleOnly: published as a 'simple' preset only, so Companion keeps the advanced look feedback (a 'layered'
// variant would drop it, and these buttons change with every page and every value).
function keyPreset(category, name, k, o, model, art) {
  const st = slotLook(model, { ...o, part: 'key' }, art) || { text: '', color: 0xffffff, bgcolor: 0 };
  return {
    type: 'button', category, name, simpleOnly: true,
    style: styleOf(st),
    steps: [{ down: [keyAct(o, 'press')], up: [keyAct(o, 'release')] }],
    feedbacks: [look('key', o)],
  };
}

function stripPreset(category, name, o, model, art) {
  const st = slotLook(model, { ...o, part: 'strip' }, art) || { text: '', color: 0xffffff, bgcolor: STRIP_BG };
  return {
    type: 'button', category, name, simpleOnly: true,
    style: styleOf(st),
    steps: [{ down: [dialAct(o, 'tap')], up: [] }],
    feedbacks: [look('strip', o)],
  };
}

function knobPreset(category, name, o, model, art) {
  const st = slotLook(model, { ...o, part: 'knob' }, art) || { text: '', color: KNOB_FG, bgcolor: STRIP_BG };
  return {
    type: 'button', category, name, simpleOnly: true,
    options: { rotaryActions: true },
    style: styleOf(st),
    steps: [{ down: [dialAct(o, 'down')], up: [dialAct(o, 'up')], rotate_left: [dialAct(o, 'rotate', '-1')], rotate_right: [dialAct(o, 'rotate', '1')] }],
    feedbacks: [look('knob', o)],
  };
}

function widgetPresets(model, out, art) {
  const cat = 'CC deck: touch-strip displays and knobs (PTZ, selected camera)';
  for (const w of (model && model.widgetList) || []) {
    if (!model.widgets || !model.widgets[w.id]) continue;
    const id = safe(w.id);
    const st = widgetLook(model, w.id, 'strip', art);
    out[`ccw_${id}_strip`] = {
      type: 'button', category: cat, name: `${w.name}: touch-strip display${w.tap ? ` (touch: ${w.tap})` : ''}`, simpleOnly: true,
      style: styleOf(st),
      steps: [{ down: [{ actionId: 'cc_dial_widget', options: { widget: w.id, event: 'tap', delta: '' } }], up: [] }],
      feedbacks: [{ feedbackId: 'cc_dial_look', options: { widget: w.id, part: 'strip' } }],
    };
    const kn = widgetLook(model, w.id, 'knob', art);
    const act = (event, delta = '') => ({ actionId: 'cc_dial_widget', options: { widget: w.id, event, delta } });
    out[`ccw_${id}_knob`] = {
      type: 'button', category: cat, name: `${w.name}: knob${w.pair ? ' (push: switch side)' : ''}`, simpleOnly: true,
      options: { rotaryActions: true },
      style: styleOf(kn),
      steps: [{ down: [act('down')], up: [act('up')], rotate_left: [act('rotate', '-1')], rotate_right: [act('rotate', '1')] }],
      feedbacks: [{ feedbackId: 'cc_dial_look', options: { widget: w.id, part: 'knob' } }],
    };
  }
}

// "CC deck: <surface> (whole deck, follows HOME)": every key, strip cell and knob of one virtual deck.
// "CC deck: <surface> · <page>": one page, pinned. Keys first, then the strip, then the knobs.
function presets(model, surfaces, art) {
  const out = {};
  if (!model) return out;
  const want = new Set(surfaces && surfaces.length ? surfaces : DEFAULT_SURFACES);
  for (const s of surfacesOf(model)) {
    if (!want.has(s.id)) continue;
    const knobCols = s.knobCols || [];
    const cat = `CC deck: ${s.label} (whole deck, follows HOME and page keys)`;
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) out[`ccd_${s.id}_k${row}_${col}`] = keyPreset(cat, `Row ${row + 1} col ${col + 1}`, null, { surface: s.id, row, col, pin: '' }, model, art);
    }
    knobCols.forEach((col, index) => { out[`ccd_${s.id}_s${index}`] = stripPreset(cat, `Strip col ${col + 1} (knob ${index + 1} readout)`, { surface: s.id, index, pin: '' }, model, art); });
    knobCols.forEach((col, index) => { out[`ccd_${s.id}_e${index}`] = knobPreset(cat, `Knob ${index + 1} (col ${col + 1})`, { surface: s.id, index, pin: '' }, model, art); });
    for (const p of s.pages || []) {
      const pc = `CC deck: ${s.label} · ${p.title} [${p.id}]`;
      const base = `ccd_${s.id}_${safe(p.id)}`;
      const keys = (p.keys || []).filter((k) => k.pressable || (k.lines || []).length).slice().sort((a, b) => a.row - b.row || a.col - b.col);
      for (const k of keys) out[`${base}_k${k.row}_${k.col}`] = keyPreset(pc, `Row ${k.row + 1} col ${k.col + 1}: ${oneLine(k.lines) || 'blank'}`, k, { surface: s.id, row: k.row, col: k.col, pin: p.id }, model, art);
      for (const d of (p.dials || []).slice().sort((a, b) => a.index - b.index)) {
        const o = { surface: s.id, index: d.index, pin: p.id };
        out[`${base}_s${d.index}`] = stripPreset(pc, `Strip col ${d.col + 1}: ${oneLine(d.lines) || d.label}`, o, model, art);
        out[`${base}_e${d.index}`] = knobPreset(pc, `Knob col ${d.col + 1}: ${d.label || oneLine(d.knob)}`, o, model, art);
      }
    }
  }
  widgetPresets(model, out, art);
  return out;
}

// ---------- variables ----------
function variableDefinitions(model, surfaces) {
  const defs = [{ variableId: 'cc_deck_rev', name: 'Control Center deck pages: revision' }];
  const want = new Set(surfaces && surfaces.length ? surfaces : DEFAULT_SURFACES);
  for (const s of surfacesOf(model)) {
    if (!want.has(s.id)) continue;
    defs.push({ variableId: `cc_deck_${s.id}_page`, name: `Control Center deck (${s.label}): page shown now (system.page)` });
    (s.knobCols || []).forEach((col, i) => defs.push({ variableId: `cc_strip_${s.id}_${i + 1}`, name: `Control Center deck (${s.label}): knob ${i + 1} readout` }));
  }
  for (const w of (model && model.widgetList) || []) defs.push({ variableId: `cc_dial_${safe(w.id)}`, name: `Control Center PTZ dial ${w.name}: readout (selected camera)` });
  return defs;
}

function variableValues(model, surfaces) {
  const v = { cc_deck_rev: model && model.rev ? String(model.rev) : '' };
  const want = new Set(surfaces && surfaces.length ? surfaces : DEFAULT_SURFACES);
  for (const s of surfacesOf(model)) {
    if (!want.has(s.id)) continue;
    v[`cc_deck_${s.id}_page`] = s.at ? `${s.at.system}.${s.at.page}` : '';
    (s.knobCols || []).forEach((col, i) => {
      const d = ((s.live && s.live.dials) || []).find((x) => x.index === i);
      v[`cc_strip_${s.id}_${i + 1}`] = d ? oneLine(d.lines) : '';
    });
  }
  for (const [id, w] of Object.entries((model && model.widgets) || {})) v[`cc_dial_${safe(id)}`] = oneLine((w.lines || []).slice(0, 2));
  return v;
}

// ---------- actions / feedbacks ----------
const surfaceChoices = () => SURFACES.map((s) => ({ id: s.id, label: s.label }));
function widgetChoices(model) {
  const list = ((model && model.widgetList) || []).map((w) => ({ id: w.id, label: w.name }));
  return list.length ? list : [{ id: 'gainRb', label: 'R GAIN / B GAIN' }];
}
const pinOpt = { type: 'textinput', id: 'pin', label: 'Page (system.page, e.g. ptz.0; empty = follow the deck)', default: '' };

// inst: { deck (the model), api (AppApi), log, run(label, fn), deckChanged() }
function actions(inst) {
  const done = (r) => { if (inst.deckChanged) inst.deckChanged(); return r; };
  return {
    cc_deck_key: {
      name: 'Control Center deck: key',
      description: 'Presses or releases a key of a Control Center Stream Deck page (HOME, PTZ, ATEM, CONSOLE), the same as on a USB deck.',
      options: [
        { type: 'dropdown', id: 'surface', label: 'Deck size', default: 'plusxl', choices: surfaceChoices() },
        { type: 'number', id: 'row', label: 'Row (from 0)', default: 0, min: 0, max: 7 },
        { type: 'number', id: 'col', label: 'Column (from 0)', default: 0, min: 0, max: 15 },
        { type: 'dropdown', id: 'event', label: 'Event', default: 'press', choices: KEY_EVENTS },
        pinOpt,
      ],
      callback: (a) => inst.run(`CC deck key ${a.options.surface} ${a.options.row}/${a.options.col}`, () => inst.api.ccDeckKey(a.options.surface, { row: Number(a.options.row), col: Number(a.options.col), event: a.options.event || 'press', pin: a.options.pin || '' }).then(done)),
    },
    cc_deck_dial: {
      name: 'Control Center deck: knob / touch strip',
      description: 'Turns, pushes or touches a knob of a Control Center Stream Deck page (PTZ paint knobs, ATEM knobs).',
      options: [
        { type: 'dropdown', id: 'surface', label: 'Deck size', default: 'plusxl', choices: surfaceChoices() },
        { type: 'number', id: 'index', label: 'Knob (from 0, left to right)', default: 0, min: 0, max: 5 },
        { type: 'dropdown', id: 'event', label: 'Event', default: 'rotate', choices: DIAL_EVENTS },
        { type: 'textinput', id: 'delta', label: 'Turn (detents, signed; $(this:delta) on a knob)', default: '', useVariables: true },
        pinOpt,
      ],
      callback: async (a, ctx) => {
        let d = a.options.delta;
        if (typeof d === 'string' && d.includes('$(') && ctx && typeof ctx.parseVariablesInString === 'function') { try { d = await ctx.parseVariablesInString(d); } catch (e) { d = ''; } }
        const event = a.options.event || 'rotate';
        const body = { index: Number(a.options.index), event, pin: a.options.pin || '' };
        if (event === 'rotate') body.ticks = deltaOf(d) || 1;
        return inst.run(`CC deck knob ${a.options.surface} ${a.options.index}`, () => inst.api.ccDeckDial(a.options.surface, body).then(done));
      },
    },
    cc_dial_widget: {
      name: 'Control Center PTZ dial (standalone knob)',
      description: 'Turns a PTZ paint / lens dial on the selected camera without a page: R / B gain, R / B pedestal, iris, master pedestal, detail, gamma, chroma, knee, zoom, focus, speeds.',
      options: [
        { type: 'dropdown', id: 'widget', label: 'Dial', default: widgetChoices(inst.deck)[0].id, choices: widgetChoices(inst.deck), allowCustom: true },
        { type: 'dropdown', id: 'event', label: 'Event', default: 'rotate', choices: WIDGET_EVENTS },
        { type: 'textinput', id: 'delta', label: 'Turn (detents, signed; $(this:delta) on a knob)', default: '', useVariables: true },
      ],
      callback: async (a, ctx) => {
        let d = a.options.delta;
        if (typeof d === 'string' && d.includes('$(') && ctx && typeof ctx.parseVariablesInString === 'function') { try { d = await ctx.parseVariablesInString(d); } catch (e) { d = ''; } }
        const event = a.options.event || 'rotate';
        const body = { event };
        if (event === 'rotate') body.ticks = deltaOf(d) || 1;
        return inst.run(`CC dial ${a.options.widget}`, () => inst.api.ccDialWidget(a.options.widget, body).then(done));
      },
    },
  };
}

function feedbacks(inst) {
  return {
    cc_deck_look: {
      type: 'advanced',
      name: 'Control Center deck: look of a key, strip cell or knob',
      description: 'The picture Control Center draws for one slot of its Stream Deck page (Control Center 0.35.0+; text and colors before), live: page changes, camera values, tally. On a strip cell it is the knob\'s label and value (e.g. R GAIN +12).',
      affectedProperties: ['text', 'color', 'bgcolor', 'png64', 'pngalignment'],
      options: [
        { type: 'dropdown', id: 'surface', label: 'Deck size', default: 'plusxl', choices: surfaceChoices() },
        { type: 'dropdown', id: 'part', label: 'Slot', default: 'key', choices: PARTS },
        { type: 'number', id: 'row', label: 'Key row (from 0)', default: 0, min: 0, max: 7 },
        { type: 'number', id: 'col', label: 'Key column (from 0)', default: 0, min: 0, max: 15 },
        { type: 'number', id: 'index', label: 'Knob (from 0)', default: 0, min: 0, max: 5 },
        pinOpt,
      ],
      callback: (f) => slotLook(inst.deck, f.options, inst.art) || {},
    },
    cc_dial_look: {
      type: 'advanced',
      name: 'Control Center PTZ dial: touch-strip display',
      description: 'Label and live value of one PTZ dial on the selected camera (R GAIN / B GAIN with the active side marked, iris, detail ...).',
      affectedProperties: ['text', 'color', 'bgcolor', 'png64', 'pngalignment'],
      options: [
        { type: 'dropdown', id: 'widget', label: 'Dial', default: widgetChoices(inst.deck)[0].id, choices: widgetChoices(inst.deck), allowCustom: true },
        { type: 'dropdown', id: 'part', label: 'Show', default: 'strip', choices: [{ id: 'strip', label: 'Readout (strip cell)' }, { id: 'knob', label: 'Knob label' }] },
      ],
      callback: (f) => widgetLook(inst.deck, f.options.widget, f.options.part, inst.art) || {},
    },
  };
}

// Only what changes the preset list (not a new value): Control Center sends layoutRev for that.
function layoutKey(model, surfaces) {
  return model ? `${model.layoutRev || model.rev}|${(surfaces || []).join(',')}` : '';
}

module.exports = { FEATURE, SURFACES, DEFAULT_SURFACES, presets, actions, feedbacks, variableDefinitions, variableValues, slotLook, widgetLook, surfaceIds, layoutKey, deltaOf };

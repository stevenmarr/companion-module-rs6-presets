'use strict';
// 0.10.0: Control Center BUTTONS and PAGES in Companion. Control Center defines the buttons and pages; Companion
// (and Steven's fork, with its page designs and page templates) puts them on Stream Decks. The app serves them on
// GET /api/companion/buttons (app 0.31.0+, feature "companionBridge"); this file turns that into presets, one
// action (cc_button_run), one look feedback (cc_button_look) and a few variables. Pure functions only.

const ELEMENT = { button: 'Key', encoder: 'Encoder', 'touch-segment': 'Touch' };
const EVENTS = [
  { id: 'press', label: 'Press (key)' },
  { id: 'release', label: 'Release (key)' },
  { id: 'hold', label: 'Hold (key)' },
  { id: 'turn', label: 'Turn (encoder, use delta)' },
  { id: 'push', label: 'Push (encoder)' },
  { id: 'touch', label: 'Touch (strip segment)' },
];

const hex = (h, fallback) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); return m ? parseInt(m[1], 16) : fallback; };
// CC text may hold CC variables such as $(atem:name); in Companion that would point at a connection called "atem",
// so a preset shows the text with those tokens taken out (the look feedback carries the CC text as written).
const plain = (t) => String(t || '').replace(/\$\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
const buttonsOf = (m) => (m && Array.isArray(m.buttons) ? m.buttons : []);
const pagesOf = (m) => (m && Array.isArray(m.pages) ? m.pages : []);

function byId(model) { return new Map(buttonsOf(model).map((b) => [b.id, b])); }

function choices(model) {
  const list = buttonsOf(model).map((b) => ({ id: b.id, label: `${b.name} (${ELEMENT[b.element] || b.element})` }));
  return list.length ? list : [{ id: '', label: '(no Control Center buttons yet)' }];
}

function defaultEvent(b) { return b && b.element === 'encoder' ? 'turn' : b && b.element === 'touch-segment' ? 'touch' : 'press'; }

// One signed turn from the delta option ('', '-1', '1', or a parsed $(this:delta)); 0 when empty.
function deltaOf(v) { const n = Number(String(v == null ? '' : v).trim()); return Number.isFinite(n) ? Math.trunc(n) : 0; }

function look(b) {
  const text = plain(b.text) || plain(b.title) || b.name;
  return { text, size: 'auto', color: hex(b.look && b.look.color, 0xffffff), bgcolor: hex(b.look && b.look.bgcolor, 0x000000) };
}

function stepsFor(b) {
  const id = b.id;
  const act = (event, delta = '') => ({ actionId: 'cc_button_run', options: { button: id, event, delta } });
  if (b.element === 'encoder') {
    const down = (b.events || []).includes('push') ? [act('push')] : [];
    return { options: { rotaryActions: true }, steps: [{ down, up: [], rotate_left: [act('turn', '-1')], rotate_right: [act('turn', '1')] }] };
  }
  if (b.element === 'touch-segment') return { steps: [{ down: [act('touch')], up: [] }] };
  const up = (b.events || []).includes('release') ? [act('release')] : [];
  return { steps: [{ down: [act('press')], up }] };
}

function presetFor(b, category, name) {
  const s = stepsFor(b);
  const p = {
    type: 'button', category, name,
    style: look(b),
    steps: s.steps,
    feedbacks: [{ feedbackId: 'cc_button_look', options: { button: b.id } }],
  };
  if (s.options) p.options = s.options;
  return p;
}

// "CC buttons": one per library button. "CC page: <name>": one per placed slot, keys first, then the touch strip,
// then the encoders (the order they sit in on a + / + XL, top to bottom).
function presets(model) {
  const out = {};
  const map = byId(model);
  for (const b of buttonsOf(model)) out[`cc_btn_${b.id}`] = presetFor(b, 'CC buttons', `${b.name}`);
  for (const p of pagesOf(model)) {
    const cat = `CC page: ${p.name}${p.layout && p.layout.label ? ` (${p.layout.label})` : ''}`;
    const keys = (p.keys || []).slice().sort((a, b) => a.row - b.row || a.col - b.col);
    for (const s of keys) { const b = map.get(s.buttonId); if (b) out[`cc_pg_${p.id}_k${s.row}_${s.col}`] = presetFor(b, cat, `Row ${s.row + 1} col ${s.col + 1}: ${b.name}`); }
    for (const s of (p.touch || []).slice().sort((a, b) => a.col - b.col)) { const b = map.get(s.buttonId); if (b) out[`cc_pg_${p.id}_t${s.col}`] = presetFor(b, cat, `Strip col ${s.col + 1}: ${b.name}`); }
    for (const s of (p.encoders || []).slice().sort((a, b) => a.col - b.col)) { const b = map.get(s.buttonId); if (b) out[`cc_pg_${p.id}_e${s.col}`] = presetFor(b, cat, `Knob col ${s.col + 1}: ${b.name}`); }
  }
  return out;
}

function variableDefinitions() {
  return [
    { variableId: 'cc_buttons_rev', name: 'Control Center buttons: revision' },
    { variableId: 'cc_button_count', name: 'Control Center buttons: number of buttons' },
    { variableId: 'cc_page_count', name: 'Control Center buttons: number of pages' },
  ];
}

function variableValues(model) {
  return {
    cc_buttons_rev: model && model.rev ? String(model.rev) : '',
    cc_button_count: String(buttonsOf(model).length),
    cc_page_count: String(pagesOf(model).length),
  };
}

// inst: { cc (the model), api (AppApi), log, run(label, fn) }
function actions(inst) {
  return {
    cc_button_run: {
      name: 'Control Center: run a CC button',
      description: 'Runs a button from the Control Center BUTTONS tab, the same way a Stream Deck press in the app does.',
      options: [
        { type: 'dropdown', id: 'button', label: 'Button', default: choices(inst.cc)[0].id, choices: choices(inst.cc), allowCustom: true },
        { type: 'dropdown', id: 'event', label: 'Event', default: 'press', choices: EVENTS },
        { type: 'textinput', id: 'delta', label: 'Turn (detents, signed; $(this:delta) on a knob)', default: '', useVariables: true },
      ],
      callback: async (a, ctx) => {
        let d = a.options.delta;
        if (typeof d === 'string' && d.includes('$(') && ctx && typeof ctx.parseVariablesInString === 'function') {
          try { d = await ctx.parseVariablesInString(d); } catch (e) { d = ''; }
        }
        const b = byId(inst.cc).get(a.options.button);
        const event = a.options.event || defaultEvent(b);
        const body = { event };
        const delta = deltaOf(d);
        if (event === 'turn') body.delta = delta || 1;
        return inst.run(`CC button ${b ? b.name : a.options.button}`, async () => {
          const r = await inst.api.ccRun(a.options.button, body);
          if (r && r.ran) for (const x of r.ran) if (!x.ok) inst.log('warn', `CC button ${a.options.button} ${event}: ${x.action} ${x.skipped || x.error || 'not run'}`);
          return r;
        });
      },
    },
  };
}

function feedbacks(inst) {
  return {
    cc_button_look: {
      type: 'advanced',
      name: 'Control Center: look of a CC button',
      // Companion 5 warns at load when an advanced feedback has no affectedProperties array.
      affectedProperties: ['text', 'color', 'bgcolor'],
      description: 'The text and colors of a button from the Control Center BUTTONS tab. Follows edits in the app.',
      options: [{ type: 'dropdown', id: 'button', label: 'Button', default: choices(inst.cc)[0].id, choices: choices(inst.cc), allowCustom: true }],
      callback: (f) => {
        const b = byId(inst.cc).get(f.options.button);
        if (!b) return {};
        const l = look(b);
        return { text: l.text, color: l.color, bgcolor: l.bgcolor };
      },
    },
  };
}

const FEATURE = 'companionButtons'; // listed by GET /api/version from Control Center 0.31.0
module.exports = { presets, actions, feedbacks, variableDefinitions, variableValues, choices, look, deltaOf, plain, EVENTS, FEATURE };

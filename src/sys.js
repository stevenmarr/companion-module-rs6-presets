'use strict';
// 0.6.0 PV Control Center: E2, PixelHue, ATEM and Panasonic PTZ, all through the Control Center app's HTTP API
// (never the devices themselves). Pure helpers, no Companion imports, so they can be unit tested.
// The state is the app's multi-system long-poll: GET /api/sys?since=<rev>&timeout=<ms>&views=all
//   { rev, active, systems: {key: {status, capabilities, configured, ...}}, views: {e2, pixelhue, atem, ptz} }
const L = require('./logic');
const OPS = require('./ptz-ops');

const { COLORS, look, lit } = L;
const PRESET_SYS = { e2: 'E2', pixelhue: 'PixelHue' };
const SYS_NAMES = { rs6: 'RS6', e2: 'E2', pixelhue: 'PixelHue', atem: 'ATEM', ptz: 'PTZ' };
const OP_BY_ID = new Map(OPS.map((o) => [o.id, o]));
const PTZ_PRESET_BUTTONS = 16; // per camera, in the button presets (any 1..100 works in the actions)
const MAX_TILES = 96;

const view = (S, sys) => (S && S.views && S.views[sys]) || null;
const connected = (S, sys) => { const v = view(S, sys); return !!(v && v.status && v.status.connected); };
const configured = (S, sys) => !!(S && S.systems && S.systems[sys] && S.systems[sys].configured) || !!view(S, sys);
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_');
const one = (list, fallback) => (list.length ? list : [fallback]);

// ---------- E2 / PixelHue (preset systems: tiles, destinations, take/cut) ----------
const xPresets = (S, sys) => ((view(S, sys) && view(S, sys).presets) || []).filter((p) => p.tile >= 1 && p.tile <= MAX_TILES).sort((a, b) => a.tile - b.tile);
const xFind = (S, sys, tile) => ((view(S, sys) && view(S, sys).presets) || []).find((p) => String(p.tile) === String(tile) || p.key === String(tile));
const xDests = (S, sys) => (view(S, sys) && view(S, sys).destinations) || [];
const xPresetChoices = (S, sys) => one(xPresets(S, sys).map((p) => ({ id: p.tile, label: `${p.tile} ${p.name}` })), { id: 1, label: '1' });
const xDestChoices = (S, sys) => one(xDests(S, sys).map((d) => ({ id: d.key, label: `${d.key} ${d.label}` })), { id: 'S1', label: 'S1' });
const xCueChoices = (S) => one(((view(S, 'e2') && view(S, 'e2').cues) || []).map((c) => ({ id: c.id, label: `${c.number} ${c.name}` })), { id: 0, label: 'Cue 1' });
function xTally(S, sys, tile, which, partial = false) {
  const p = xFind(S, sys, tile); if (!p || !p.tally) return false;
  const v = p.tally[which]; return v === 'full' || (partial && v === 'partial');
}
function xDestSelected(S, sys, key) {
  const v = view(S, sys); if (!v) return false; const k = String(key).toUpperCase();
  return (v.selection || []).map((x) => String(x).toUpperCase()).includes(k) || !!(xDests(S, sys).find((d) => d.key === k) || {}).selected;
}

// ---------- ATEM ----------
const atem = (S) => view(S, 'atem');
const atemName = (S, id) => { const a = atem(S); const i = a && (a.inputs || []).find((x) => x.id === Number(id)); return i ? i.short || i.long || String(id) : id === undefined || id === null ? '' : String(id); };
const atemLong = (S, id) => { const a = atem(S); const i = a && (a.inputs || []).find((x) => x.id === Number(id)); return i ? i.long || i.short || String(id) : ''; };
const atemBusChoices = (S) => one(((atem(S) && atem(S).bus) || []).map((i) => ({ id: i.id, label: `${i.id} ${i.long || i.short}` })), { id: 1, label: '1 Input 1' });
const atemAuxSourceChoices = (S) => one(((atem(S) && atem(S).auxSources) || []).map((i) => ({ id: i.id, label: `${i.id} ${i.long || i.short}` })), { id: 1, label: '1 Input 1' });
const atemKeyChoices = (S) => one(((atem(S) && atem(S).keyers) || []).map((k) => ({ id: k.index, label: `Key ${k.index + 1}` })), { id: 0, label: 'Key 1' });
const atemDskChoices = (S) => one(((atem(S) && atem(S).dsk) || []).map((k) => ({ id: k.index, label: `DSK ${k.index + 1}` })), { id: 0, label: 'DSK 1' });
const atemAuxChoices = (S) => one(((atem(S) && atem(S).aux) || []).map((k) => ({ id: k.index, label: `Aux ${k.index + 1}` })), { id: 0, label: 'Aux 1' });
const atemMacroChoices = (S) => one(((atem(S) && atem(S).macros) || []).map((m) => ({ id: m.index, label: `${m.index + 1} ${m.name || ''}`.trim() })), { id: 0, label: 'Macro 1' });
const ATEM_STYLES = ['MIX', 'DIP', 'WIPE', 'DVE', 'STING'];
function atemFeedback(S, kind, o = {}) {
  const a = atem(S); if (!a) return false;
  switch (kind) {
    case 'program': return a.program === Number(o.source);
    case 'preview': return a.preview === Number(o.source);
    case 'usk': { const k = (a.keyers || []).find((x) => x.index === Number(o.key)); return !!(k && (o.what === 'tie' ? k.tie : k.onAir)); }
    case 'dsk': { const k = (a.dsk || []).find((x) => x.index === Number(o.key)); return !!(k && (o.what === 'tie' ? k.tie : o.what === 'transition' ? k.inTransition : k.onAir)); }
    case 'aux': { const k = (a.aux || []).find((x) => x.index === Number(o.aux)); return !!(k && k.source === Number(o.source)); }
    case 'macro': { const r = a.macroRun || {}; return !!r.isRunning && (o.macro === 'any' || r.macroIndex === Number(o.macro)); }
    case 'ftb': return !!(a.ftb && (a.ftb.black || a.ftb.inTransition));
    case 'transition': return !!a.inTransition;
    case 'style': return String(a.nextStyle || a.style).toUpperCase() === String(o.style).toUpperCase();
    default: return false;
  }
}

// ---------- PTZ ----------
const ptz = (S) => view(S, 'ptz');
const cams = (S) => (ptz(S) && ptz(S).cameras) || [];
const selectedCam = (S) => (ptz(S) && ptz(S).selected) || (cams(S)[0] && cams(S)[0].id) || null;
// 'selected' = the camera selected in the app (and by ptz_select_camera), resolved at the moment of the press
const camId = (S, cam) => (!cam || cam === 'selected' ? selectedCam(S) : String(cam));
const camOf = (S, cam) => cams(S).find((c) => c.id === camId(S, cam)) || null;
const camChoices = (S, withSelected = true) => [...(withSelected ? [{ id: 'selected', label: 'Selected camera' }] : []), ...cams(S).map((c) => ({ id: c.id, label: `${c.name} (${c.model || c.series || 'PTZ'})` }))];
const opsOfType = (types) => OPS.filter((o) => types.includes(o.type));
const opChoices = (types) => opsOfType(types).map((o) => ({ id: o.id, label: `${o.label}${o.series === 'all' ? '' : ` [${o.series.length === 1 ? o.series[0] : o.series.length + ' series'}]`}` }));
// the camera's own catalog (fetched from the app) wins over the merged table
function opFor(cats, S, cam, id) {
  const c = camOf(S, cam); const cat = c && cats && cats[c.id];
  const o = cat && (cat.ops || []).find((x) => x.id === id);
  return o || OP_BY_ID.get(id) || null;
}
function fmtValue(o, v) {
  if (v === undefined || v === null || v === '') return '';
  if (!o) return String(v);
  if (o.type === 'toggle') return v ? 'ON' : 'OFF';
  if (o.type === 'list') { const x = (o.options || []).find((y) => String(y[0]) === String(v)); return x ? String(x[1]) : String(v); }
  return String(v);
}
// value for inc/dec on a range op, clamped to the op's range
function stepRange(o, cur, step) {
  const r = (o && o.range) || { min: -Infinity, max: Infinity, step: 1 };
  const base = Number.isFinite(Number(cur)) ? Number(cur) : (r.centre ?? 0);
  const v = base + Number(step) * (r.step || 1);
  return Math.max(r.min, Math.min(r.max, Math.round(v * 1000) / 1000));
}
// next / previous entry of a list op (wraps off: stops at the ends like the module's gain up/down)
function stepList(o, cur, dir) {
  const opts = (o && o.options) || []; if (!opts.length) return undefined;
  const i = opts.findIndex((x) => String(x[0]) === String(cur));
  const j = i < 0 ? 0 : Math.max(0, Math.min(opts.length - 1, i + (dir < 0 ? -1 : 1)));
  return opts[j][0];
}
// 0.7.0 knobs: the signed detent count from the fork's $(this:delta); an empty/unparsed value falls back to -1 / +1
function deltaOf(v, fallback = 0) { const n = Number(String(v === undefined || v === null ? '' : v).trim()); return Number.isFinite(n) && n !== 0 && String(v).trim() !== '' ? n : Number(fallback) || 0; }
const clampSpeed = (v) => Math.max(1, Math.min(49, Math.round(Number(v) || 1)));
const DIRS = {
  up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0], upLeft: [-1, 1], upRight: [1, 1], downLeft: [-1, -1], downRight: [1, -1],
};
const DIR_CHOICES = [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'], ['upLeft', 'Up left'], ['upRight', 'Up right'], ['downLeft', 'Down left'], ['downRight', 'Down right']].map(([id, label]) => ({ id, label }));
// body for POST /api/sys/ptz/cmd/move: speed 0 = the app's session speed (CAMERA CONTROL › speed), else an explicit 1..49
function moveBody(cam, dir, speed) {
  const [x, y] = DIRS[dir] || [0, 0]; const s = Math.max(0, Math.min(49, Math.round(Number(speed) || 0)));
  return s ? { cam, pan: x * s, tilt: y * s, speed: true } : { cam, pan: x, tilt: y };
}
function lensBody(cam, dir, speed) {
  const sgn = dir === 'tele' || dir === 'far' ? 1 : -1; const s = Math.max(0, Math.min(49, Math.round(Number(speed) || 0)));
  return s ? { cam, dir: sgn * s, speed: true } : { cam, dir: sgn };
}
function ptzFeedback(S, kind, o = {}) {
  const c = camOf(S, o.cam); if (!c) return false;
  switch (kind) {
    case 'selected': return selectedCam(S) === c.id;
    case 'tally': return o.color === 'green' ? !!c.tallyGreen : !!c.tally;
    case 'power': return c.power === 'on';
    case 'online': return !!c.connected;
    case 'moving': return !!(c.moving || (c.axes && (c.axes.pt || c.axes.z || c.axes.f)));
    case 'preset': return Number(c.lastPreset) === Number(o.preset);
    case 'error': return !!(c.error || c.lastError);
    case 'on': return !!(c.values && c.values[o.op] === true);
    case 'value': return !!(c.values && String(c.values[o.op]) === String(o.value));
    default: return false;
  }
}
function presetName(c, n) { const m = (c && c.presetNames) || {}; return m[n] || m[String(n)] || ''; }

// ---------- variables ----------
function variableDefinitions(S) {
  const d = [
    { variableId: 'active_system', name: 'Control Center: system shown in the app (rs6/e2/pixelhue/atem/ptz)' },
    { variableId: 'systems_connected', name: 'Control Center: connected systems (comma list)' },
  ];
  for (const [sys, nm] of Object.entries(PRESET_SYS)) {
    if (!configured(S, sys)) continue;
    d.push({ variableId: `${sys}_connected`, name: `${nm}: connected (true/false)` },
      { variableId: `${sys}_last_preset`, name: `${nm}: last recalled preset (tile)` },
      { variableId: `${sys}_last_preset_name`, name: `${nm}: last recalled preset name` },
      { variableId: `${sys}_selection`, name: `${nm}: selected destinations` },
      { variableId: `${sys}_auto_take`, name: `${nm}: auto take (ON/OFF)` });
    for (const p of xPresets(S, sys)) d.push({ variableId: `${sys}_tile_${p.tile}_name`, name: `${nm}: preset name on tile ${p.tile}` });
    for (const x of xDests(S, sys)) {
      d.push({ variableId: `${sys}_${x.key}_label`, name: `${nm}: ${x.key} name` },
        { variableId: `${sys}_${x.key}_pgm`, name: `${nm}: ${x.key} preset on Program` },
        { variableId: `${sys}_${x.key}_pvw`, name: `${nm}: ${x.key} preset on Preview` });
    }
  }
  const a = atem(S);
  if (a) {
    d.push({ variableId: 'atem_connected', name: 'ATEM: connected (true/false)' }, { variableId: 'atem_model', name: 'ATEM: model' },
      { variableId: 'atem_program', name: 'ATEM: Program source (short name)' }, { variableId: 'atem_program_name', name: 'ATEM: Program source (long name)' }, { variableId: 'atem_program_id', name: 'ATEM: Program source id' },
      { variableId: 'atem_preview', name: 'ATEM: Preview source (short name)' }, { variableId: 'atem_preview_name', name: 'ATEM: Preview source (long name)' }, { variableId: 'atem_preview_id', name: 'ATEM: Preview source id' },
      { variableId: 'atem_style', name: 'ATEM: transition style' }, { variableId: 'atem_mix_rate', name: 'ATEM: mix rate (frames)' },
      { variableId: 'atem_ftb', name: 'ATEM: fade to black (ON/OFF)' }, { variableId: 'atem_in_transition', name: 'ATEM: transition running (true/false)' },
      { variableId: 'atem_macro_running', name: 'ATEM: running macro (name, empty when none)' });
    for (const x of a.aux || []) d.push({ variableId: `atem_aux_${x.index + 1}`, name: `ATEM: Aux ${x.index + 1} source (short name)` });
    for (const i of a.bus || []) d.push({ variableId: `atem_input_${i.id}_name`, name: `ATEM: source ${i.id} short name` });
    for (const m of a.macros || []) d.push({ variableId: `atem_macro_${m.index + 1}_name`, name: `ATEM: macro ${m.index + 1} name` });
  }
  if (ptz(S)) {
    d.push({ variableId: 'ptz_selected', name: 'PTZ: selected camera id' }, { variableId: 'ptz_selected_name', name: 'PTZ: selected camera name' },
      { variableId: 'ptz_speed_pt', name: 'PTZ: pan/tilt session speed' }, { variableId: 'ptz_speed_zoom', name: 'PTZ: zoom session speed' }, { variableId: 'ptz_speed_focus', name: 'PTZ: focus session speed' });
    for (const c of [{ id: 'sel', name: 'selected camera' }, ...cams(S)]) {
      const p = `ptz_${safeId(c.id)}`;
      for (const [k, n] of [['name', 'name'], ['model', 'model'], ['online', 'online (true/false)'], ['power', 'power'], ['tally', 'red tally (ON/OFF)'], ['tally_green', 'green tally (ON/OFF)'],
        ['last_preset', 'last recalled preset'], ['last_preset_name', 'last recalled preset name'], ['pan', 'pan (deg)'], ['tilt', 'tilt (deg)'], ['zoom', 'zoom (%)'], ['focus', 'focus (%)'],
        ['iris', 'iris'], ['iris_mode', 'iris mode (AUTO/MANUAL)'], ['focus_mode', 'focus mode (AF/MF)'], ['gain', 'gain'], ['shutter', 'shutter'], ['nd', 'ND filter'], ['wb', 'white balance mode'], ['scene', 'scene file'], ['error', 'last error']]) {
        d.push({ variableId: `${p}_${k}`, name: `PTZ ${c.name}: ${n}` });
      }
      if (c.id !== 'sel') for (let n = 1; n <= PTZ_PRESET_BUTTONS; n++) d.push({ variableId: `${p}_preset_${n}_name`, name: `PTZ ${c.name}: preset ${n} name ("P${n}" when unnamed)` });
    }
  }
  return d;
}

function ptzVars(S, cats, c, p, out) {
  const val = (id) => (c && c.values ? c.values[id] : undefined);
  const f = (id) => fmtValue(opFor(cats, S, c && c.id, id), val(id));
  const pos = (c && c.pos) || {};
  const num = (x) => (x === undefined || x === null || Number.isNaN(Number(x)) ? '' : String(Math.round(Number(x) * 10) / 10));
  Object.assign(out, {
    [`${p}_name`]: c ? c.name : '', [`${p}_model`]: c ? c.model || '' : '', [`${p}_online`]: String(!!(c && c.connected)), [`${p}_power`]: c ? (c.power === 'on' ? 'ON' : c.power ? 'STANDBY' : '') : '',
    [`${p}_tally`]: c && c.tally ? 'ON' : 'OFF', [`${p}_tally_green`]: c && c.tallyGreen ? 'ON' : 'OFF',
    [`${p}_last_preset`]: c && c.lastPreset ? String(c.lastPreset) : '', [`${p}_last_preset_name`]: c && c.lastPreset ? presetName(c, c.lastPreset) : '',
    [`${p}_pan`]: num(pos.pan), [`${p}_tilt`]: num(pos.tilt), [`${p}_zoom`]: num(pos.zoom), [`${p}_focus`]: num(pos.focus),
    [`${p}_iris`]: val('iris') !== undefined ? String(val('iris')) : num(pos.iris), [`${p}_iris_mode`]: val('irisMode') === undefined ? '' : val('irisMode') ? 'AUTO' : 'MANUAL',
    [`${p}_focus_mode`]: val('focusMode') === undefined ? '' : val('focusMode') ? 'AF' : 'MF',
    [`${p}_gain`]: f('gain'), [`${p}_shutter`]: val('shutterMode') !== undefined ? `${f('shutterMode')}${val('shutterMode') === '1' || val('shutterMode') === 'step' ? ' ' + f('shutterStep') : ''}`.trim() : f('shutter'),
    [`${p}_nd`]: f('ndFilter'), [`${p}_wb`]: f('wbMode') || f('colorTemp'), [`${p}_scene`]: f('scene'), [`${p}_error`]: c ? c.lastError || c.error || '' : '',
  });
}

function variableValues(S, cats = {}) {
  const v = {
    active_system: (S && S.active) || '',
    systems_connected: Object.keys(SYS_NAMES).filter((k) => k !== 'rs6' && connected(S, k)).join(','),
  };
  for (const sys of Object.keys(PRESET_SYS)) {
    const x = view(S, sys); if (!x) continue;
    const byKey = new Map(((x.presets) || []).map((p) => [p.key, p]));
    const last = x.lastRecalled ? byKey.get(x.lastRecalled.key || x.lastRecalled) || x.lastRecalled : null;
    Object.assign(v, {
      [`${sys}_connected`]: String(connected(S, sys)), [`${sys}_last_preset`]: last && last.tile ? String(last.tile) : '', [`${sys}_last_preset_name`]: (last && last.name) || '',
      [`${sys}_selection`]: (x.selection || []).join(','), [`${sys}_auto_take`]: x.autoTake ? 'ON' : 'OFF',
    });
    for (const p of xPresets(S, sys)) v[`${sys}_tile_${p.tile}_name`] = p.name;
    const nm = (k) => { const p = k && byKey.get(k.key || k); return p ? p.name : ''; };
    for (const d of xDests(S, sys)) { v[`${sys}_${d.key}_label`] = d.label; v[`${sys}_${d.key}_pgm`] = nm(d.pgmPreset); v[`${sys}_${d.key}_pvw`] = nm(d.pvwPreset); }
  }
  const a = atem(S);
  if (a) {
    const run = a.macroRun && a.macroRun.isRunning ? (a.macros || []).find((m) => m.index === a.macroRun.macroIndex) : null;
    Object.assign(v, {
      atem_connected: String(connected(S, 'atem')), atem_model: a.model || (a.status && a.status.info && a.status.info.model) || '',
      atem_program: atemName(S, a.program), atem_program_name: atemLong(S, a.program), atem_program_id: a.program === undefined ? '' : String(a.program),
      atem_preview: atemName(S, a.preview), atem_preview_name: atemLong(S, a.preview), atem_preview_id: a.preview === undefined ? '' : String(a.preview),
      atem_style: a.nextStyle || a.style || '', atem_mix_rate: a.mixRate === undefined ? '' : String(a.mixRate),
      atem_ftb: a.ftb && a.ftb.black ? 'ON' : 'OFF', atem_in_transition: String(!!a.inTransition),
      atem_macro_running: run ? run.name || `Macro ${run.index + 1}` : (a.macroRun && a.macroRun.isRunning ? 'running' : ''),
    });
    for (const x of a.aux || []) v[`atem_aux_${x.index + 1}`] = atemName(S, x.source);
    for (const i of a.bus || []) v[`atem_input_${i.id}_name`] = i.short || i.long || String(i.id);
    for (const m of a.macros || []) v[`atem_macro_${m.index + 1}_name`] = m.name || `Macro ${m.index + 1}`;
  }
  const z = ptz(S);
  if (z) {
    const sel = camOf(S, 'selected');
    Object.assign(v, { ptz_selected: sel ? sel.id : '', ptz_selected_name: sel ? sel.name : '', ptz_speed_pt: String((z.speeds || {}).pt ?? ''), ptz_speed_zoom: String((z.speeds || {}).zoom ?? ''), ptz_speed_focus: String((z.speeds || {}).focus ?? '') });
    ptzVars(S, cats, sel, 'ptz_sel', v);
    for (const c of cams(S)) {
      const p = `ptz_${safeId(c.id)}`; ptzVars(S, cats, c, p, v);
      for (let n = 1; n <= PTZ_PRESET_BUTTONS; n++) v[`${p}_preset_${n}_name`] = presetName(c, n) || `P${n}`;
    }
  }
  return v;
}

// structure only (what changes the definitions, dropdowns and button presets), not the live values
function signature(S) {
  return JSON.stringify({
    sys: S && S.systems ? Object.keys(S.systems).filter((k) => configured(S, k)) : [],
    x: Object.keys(PRESET_SYS).map((sys) => [xPresets(S, sys).map((p) => [p.tile, p.key, p.name]), xDests(S, sys).map((d) => [d.key, d.label]), ((view(S, sys) || {}).cues || []).map((c) => [c.id, c.name])]),
    a: atem(S) ? ['bus', 'auxSources', 'keyers', 'dsk', 'aux', 'macros'].map((k) => (atem(S)[k] || []).map((i) => [i.id ?? i.index, i.short || i.name || ''])) : null,
    p: cams(S).map((c) => [c.id, c.name, c.series, c.model]),
  });
}

// ---------- 0.7.0: per-camera deck presets (Companion pages generated by the app: lib/companion) ----------
const CAM_ARROWS = { up: '▲', down: '▼', left: '◀', right: '▶' };
// Knobs. press = what pushing the knob does (see HELP.md); lcd = the touch-strip readout above the knob
const CAM_KNOBS = {
  zoom: { label: 'ZOOM', value: (p) => `${T(`${p}_zoom`)}%`, rotate: (cam, f) => A('ptz_lens_delta', { cam, axis: 'zoom', delta: '$(this:delta)', fallback: f, step: 8, pulse: 250 }), press: (cam) => [A('ptz_stop', { cam, axes: 'all' })], pressLabel: 'STOP' },
  focus: { label: 'FOCUS', value: (p) => `${T(`${p}_focus_mode`)} ${T(`${p}_focus`)}`, rotate: (cam, f) => A('ptz_lens_delta', { cam, axis: 'focus', delta: '$(this:delta)', fallback: f, step: 4, pulse: 200 }), press: (cam) => [A('ptz_exec', { cam, op: 'oneTouchAF' })], pressLabel: 'PUSH AF' },
  iris: { label: 'IRIS', value: (p) => `${T(`${p}_iris_mode`)} ${T(`${p}_iris`)}`, rotate: (cam, f) => A('ptz_level_delta', { cam, op: 'iris', delta: '$(this:delta)', fallback: f, scale: 1 }), press: (cam) => [A('ptz_toggle', { cam, op: 'irisMode', mode: 'toggle' })], pressLabel: 'A/M' },
  ptspeed: { label: 'PT SPEED', value: () => T('ptz_speed_pt'), rotate: (cam, f) => A('ptz_speed_delta', { which: 'pt', delta: '$(this:delta)', fallback: f, mode: 'delta' }), press: () => [A('ptz_speed_delta', { which: 'pt', delta: '25', fallback: 25, mode: 'set' })], pressLabel: 'RST 25' },
  gain: { label: 'GAIN', value: (p) => T(`${p}_gain`), rotate: (cam, f) => A('ptz_list_delta', { cam, op: 'gain', delta: '$(this:delta)', fallback: f }), press: (cam) => [A('ptz_set', { cam, op: 'gain', value: '08' })], pressLabel: '0dB' },
  zoomspeed: { label: 'Z SPEED', value: () => T('ptz_speed_zoom'), rotate: (cam, f) => A('ptz_speed_delta', { which: 'zoom', delta: '$(this:delta)', fallback: f, mode: 'delta' }), press: () => [A('ptz_speed_delta', { which: 'zoom', delta: '25', fallback: 25, mode: 'set' })], pressLabel: 'RST 25' },
};
const KNOB_IDS = Object.keys(CAM_KNOBS);
function camDeckPresets(c) {
  const id = safeId(c.id); const p = `ptz_${id}`; const cam = c.id; const out = {}; const cat = `PTZ: ${c.name} deck`;
  for (const [d, g] of Object.entries(CAM_ARROWS)) {
    out[`${p}_move_${d}`] = btn(cat, `${c.name} pan/tilt ${d} while held`, look('ptz', `${g}\\n${T(`${p}_name`)}`), [A('ptz_move', { cam, dir: d, speed: 0 })], [A('ptz_stop', { cam, axes: 'pt' })],
      [{ feedbackId: 'ptz_moving', options: { cam }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
  }
  for (const [d, t] of [['tele', 'ZOOM\\nTELE'], ['wide', 'ZOOM\\nWIDE'], ['near', 'FOCUS\\nNEAR'], ['far', 'FOCUS\\nFAR']]) {
    const zoom = d === 'tele' || d === 'wide';
    out[`${p}_${d}`] = btn(cat, `${c.name} ${zoom ? 'zoom' : 'focus'} ${d} while held`, look('ptz', t), [A(zoom ? 'ptz_zoom' : 'ptz_focus', { cam, dir: d, speed: 0 })], [A('ptz_stop', { cam, axes: zoom ? 'zoom' : 'focus' })]);
  }
  out[`${p}_home`] = btn(cat, `${c.name} home`, look('ptz', 'CAM\\nHOME'), [A('ptz_exec', { cam, op: 'home' })]);
  out[`${p}_otaf`] = btn(cat, `${c.name} push auto focus`, look('ptz', 'PUSH\\nAF'), [A('ptz_exec', { cam, op: 'oneTouchAF' })]);
  out[`${p}_af`] = btn(cat, `${c.name} auto focus on/off`, look('ptz', `FOCUS\\n${T(`${p}_focus_mode`)}`), [A('ptz_toggle', { cam, op: 'focusMode', mode: 'toggle' })], [],
    [{ feedbackId: 'ptz_on', options: { cam, op: 'focusMode' }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
  out[`${p}_iris_auto`] = btn(cat, `${c.name} auto iris on/off`, look('ptz', `IRIS\\n${T(`${p}_iris_mode`)}`), [A('ptz_toggle', { cam, op: 'irisMode', mode: 'toggle' })], [],
    [{ feedbackId: 'ptz_on', options: { cam, op: 'irisMode' }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
  out[`${p}_stop`] = btn(cat, `${c.name} stop`, look('take', `STOP\\n${T(`${p}_name`)}`, COLORS.white, COLORS.red), [A('ptz_stop', { cam, axes: 'all' })]);
  out[`${p}_readout`] = btn(cat, `${c.name} readout`, look('status', `${T(`${p}_name`)}\\nP ${T(`${p}_last_preset`)}`, COLORS.white, COLORS.black), [], [],
    [{ feedbackId: 'ptz_tally', options: { cam, color: 'red' }, style: lit('ptz_pgm', COLORS.red) }, { feedbackId: 'ptz_online', options: { cam, invert: true }, style: { color: COLORS.yellow } }]);
  for (const k of KNOB_IDS) {
    const kb = CAM_KNOBS[k];
    // encoder: rotate = adjust by the detents turned, press = the knob's push action
    out[`${p}_enc_${k}`] = {
      type: 'button', category: `PTZ: ${c.name} knobs (Stream Deck +)`, name: `${c.name} knob: ${kb.label.toLowerCase()} (push: ${kb.pressLabel.toLowerCase()})`,
      options: { rotaryActions: true },
      style: look('ptz', `${kb.label}\\n${kb.value(p)}`),
      steps: [{ down: kb.press(cam), up: [], rotate_left: [kb.rotate(cam, -1)], rotate_right: [kb.rotate(cam, 1)] }], feedbacks: [],
    };
    // touch-strip cell above the knob: shows the value, a tap does the same as pushing the knob
    out[`${p}_lcd_${k}`] = btn(`PTZ: ${c.name} knobs (Stream Deck +)`, `${c.name} strip: ${kb.label.toLowerCase()}`, look('status', `${kb.label}\\n${kb.value(p)}\\n${kb.pressLabel}`, COLORS.white, COLORS.black), kb.press(cam));
  }
  return out;
}

// ---------- button presets ----------
const T = (s) => `$(rs6presets:${s})`;
function btn(category, name, style, down, up = [], feedbacks = []) { return { type: 'button', category, name, style, steps: [{ down, up }], feedbacks }; }
const A = (actionId, options = {}) => ({ actionId, options });

function buttonPresets(S) {
  const out = {};
  // E2 / PixelHue
  for (const [sys, nm] of Object.entries(PRESET_SYS)) {
    const x = view(S, sys); if (!x) continue;
    for (const p of xPresets(S, sys)) {
      const lo = Math.floor((p.tile - 1) / 24) * 24 + 1;
      out[`${sys}_preset_${p.tile}`] = btn(`${nm}: preset tiles ${lo}-${lo + 23}`, `${nm} tile ${p.tile} ${p.name}`, look(sys, T(`${sys}_tile_${p.tile}_name`)),
        [A(`${sys}_recall_preset`, { preset: p.tile, target: 'preview' })], [],
        [{ feedbackId: `${sys}_preset_pvw`, options: { preset: p.tile, partial: false }, style: lit(`${sys}_pvw`, COLORS.green) },
          { feedbackId: `${sys}_preset_pgm`, options: { preset: p.tile, partial: false }, style: lit(`${sys}_pgm`, COLORS.red) }]);
    }
    for (const d of xDests(S, sys)) {
      out[`${sys}_dest_${d.key}`] = btn(`${nm}: destinations`, `${nm} toggle ${d.key} ${d.label}`, look(sys, `${d.key}\\n${T(`${sys}_${d.key}_label`)}`),
        [A(`${sys}_toggle_destination`, { dest: d.key })], [], [{ feedbackId: `${sys}_dest_selected`, options: { dest: d.key }, style: lit(`${sys}_sel`, COLORS.amber, COLORS.black) }]);
    }
    out[`${sys}_take`] = btn(`${nm}: transitions`, `${nm} TAKE`, look('take', `${nm.toUpperCase()}\\nTAKE`, COLORS.white, COLORS.red), [A(`${sys}_take`)]);
    out[`${sys}_cut`] = btn(`${nm}: transitions`, `${nm} CUT`, look('cut', `${nm.toUpperCase()}\\nCUT`, COLORS.white, COLORS.darkred), [A(`${sys}_cut`)]);
    out[`${sys}_auto_take`] = btn(`${nm}: transitions`, `${nm} auto take`, look(sys, `AUTO\\nTAKE\\n${T(`${sys}_auto_take`)}`), [A(`${sys}_auto_take`, { mode: 'toggle' })], [],
      [{ feedbackId: `${sys}_auto_take_on`, options: {}, style: lit(`${sys}_sel`, COLORS.amber, COLORS.black) }]);
    out[`${sys}_status`] = btn(`${nm}: transitions`, `${nm} last recalled`, look('status', `${nm.toUpperCase()}\\n${T(`${sys}_last_preset_name`)}`, COLORS.lightgreen, COLORS.black), [], [],
      [{ feedbackId: `${sys}_connected`, options: {}, style: { color: COLORS.lightgreen } }]);
    if (sys === 'e2') {
      for (const c of x.cues || []) {
        out[`e2_cue_${c.id}`] = btn('E2: cues', `E2 cue ${c.number} ${c.name}`, look('e2', `CUE\\n${String(c.name).slice(0, 18)}`), [A('e2_cue', { cue: c.id, op: 'play' })]);
      }
    }
  }
  // ATEM
  const a = atem(S);
  if (a) {
    for (const i of a.bus || []) {
      out[`atem_pgm_${i.id}`] = btn('ATEM: Program bus', `ATEM PGM ${i.long || i.short}`, look('atem', `PGM\\n${T(`atem_input_${i.id}_name`)}`), [A('atem_program', { source: i.id })], [],
        [{ feedbackId: 'atem_program_is', options: { source: i.id }, style: lit('atem_pgm', COLORS.red) }]);
      out[`atem_pvw_${i.id}`] = btn('ATEM: Preview bus', `ATEM PVW ${i.long || i.short}`, look('atem', `PVW\\n${T(`atem_input_${i.id}_name`)}`), [A('atem_preview', { source: i.id })], [],
        [{ feedbackId: 'atem_preview_is', options: { source: i.id }, style: lit('atem_pvw', COLORS.green) }]);
    }
    out.atem_cut = btn('ATEM: transitions', 'ATEM CUT', look('cut', 'ATEM\\nCUT', COLORS.white, COLORS.darkred), [A('atem_cut')]);
    out.atem_auto = btn('ATEM: transitions', 'ATEM AUTO', look('take', `AUTO\\n${T('atem_style')}`, COLORS.white, COLORS.red), [A('atem_auto')], [],
      [{ feedbackId: 'atem_in_transition', options: {}, style: lit('atem_pgm', COLORS.red) }]);
    out.atem_ftb = btn('ATEM: transitions', 'ATEM fade to black', look('atem', 'FTB'), [A('atem_ftb')], [], [{ feedbackId: 'atem_ftb_active', options: {}, style: lit('atem_pgm', COLORS.red) }]);
    for (const s of ATEM_STYLES) out[`atem_style_${s}`] = btn('ATEM: transitions', `ATEM style ${s}`, look('atem', s), [A('atem_style', { style: s })], [], [{ feedbackId: 'atem_style_is', options: { style: s }, style: lit('atem_sel', COLORS.amber, COLORS.black) }]);
    for (const k of a.keyers || []) {
      out[`atem_usk_${k.index}_air`] = btn('ATEM: keys', `ATEM key ${k.index + 1} on air`, look('atem', `KEY ${k.index + 1}\\nON AIR`), [A('atem_usk_onair', { key: k.index, mode: 'toggle' })], [],
        [{ feedbackId: 'atem_usk', options: { key: k.index, what: 'onair' }, style: lit('atem_pgm', COLORS.red) }]);
      out[`atem_usk_${k.index}_tie`] = btn('ATEM: keys', `ATEM key ${k.index + 1} next transition (tie)`, look('atem', `KEY ${k.index + 1}\\nTIE`), [A('atem_usk_tie', { key: k.index, mode: 'toggle' })], [],
        [{ feedbackId: 'atem_usk', options: { key: k.index, what: 'tie' }, style: lit('atem_sel', COLORS.amber, COLORS.black) }]);
    }
    for (const k of a.dsk || []) {
      out[`atem_dsk_${k.index}_air`] = btn('ATEM: keys', `ATEM DSK ${k.index + 1} on air`, look('atem', `DSK ${k.index + 1}\\nON AIR`), [A('atem_dsk_onair', { key: k.index, mode: 'toggle' })], [],
        [{ feedbackId: 'atem_dsk', options: { key: k.index, what: 'onair' }, style: lit('atem_pgm', COLORS.red) }]);
      out[`atem_dsk_${k.index}_tie`] = btn('ATEM: keys', `ATEM DSK ${k.index + 1} tie`, look('atem', `DSK ${k.index + 1}\\nTIE`), [A('atem_dsk_tie', { key: k.index, mode: 'toggle' })], [],
        [{ feedbackId: 'atem_dsk', options: { key: k.index, what: 'tie' }, style: lit('atem_sel', COLORS.amber, COLORS.black) }]);
      out[`atem_dsk_${k.index}_auto`] = btn('ATEM: keys', `ATEM DSK ${k.index + 1} auto`, look('atem', `DSK ${k.index + 1}\\nAUTO`), [A('atem_dsk_auto', { key: k.index })], [],
        [{ feedbackId: 'atem_dsk', options: { key: k.index, what: 'transition' }, style: lit('atem_pgm', COLORS.red) }]);
    }
    for (const x of a.aux || []) {
      for (const i of a.auxSources || []) {
        out[`atem_aux_${x.index}_${i.id}`] = btn(`ATEM: Aux ${x.index + 1}`, `ATEM Aux ${x.index + 1} ← ${i.long || i.short}`, look('atem', `AUX ${x.index + 1}\\n${i.short || i.long}`), [A('atem_aux', { aux: x.index, source: i.id })], [],
          [{ feedbackId: 'atem_aux_is', options: { aux: x.index, source: i.id }, style: lit('atem_sel', COLORS.amber, COLORS.black) }]);
      }
    }
    for (const m of a.macros || []) {
      out[`atem_macro_${m.index}`] = btn('ATEM: macros', `ATEM macro ${m.index + 1} ${m.name || ''}`, look('atem', `MACRO\\n${T(`atem_macro_${m.index + 1}_name`)}`), [A('atem_macro_run', { macro: m.index })], [],
        [{ feedbackId: 'atem_macro_running', options: { macro: m.index }, style: lit('atem_sel', COLORS.amber, COLORS.black) }]);
    }
    out.atem_macro_stop = btn('ATEM: macros', 'ATEM macro stop', look('atem', 'MACRO\\nSTOP'), [A('atem_macro_stop')]);
    out.atem_status = btn('ATEM: transitions', 'ATEM Program / Preview', look('status', `PGM ${T('atem_program')}\\nPVW ${T('atem_preview')}`, COLORS.white, COLORS.black), []);
  }
  // PTZ
  if (ptz(S)) {
    for (const c of cams(S)) {
      const p = `ptz_${safeId(c.id)}`;
      out[`ptz_cam_${safeId(c.id)}`] = btn('PTZ: camera select', `Select ${c.name}`, look('ptz', T(`${p}_name`)), [A('ptz_select_camera', { cam: c.id })], [],
        [{ feedbackId: 'ptz_selected', options: { cam: c.id }, style: lit('ptz_sel', COLORS.amber, COLORS.black) },
          { feedbackId: 'ptz_tally', options: { cam: c.id, color: 'green' }, style: lit('ptz_pvw', COLORS.green) },
          { feedbackId: 'ptz_tally', options: { cam: c.id, color: 'red' }, style: lit('ptz_pgm', COLORS.red) },
          { feedbackId: 'ptz_online', options: { cam: c.id, invert: true }, style: { color: COLORS.yellow } }]);
      for (let n = 1; n <= PTZ_PRESET_BUTTONS; n++) {
        out[`ptz_${safeId(c.id)}_preset_${n}`] = btn(`PTZ: ${c.name} presets`, `${c.name} recall preset ${n}`, look('ptz', T(`${p}_preset_${n}_name`)), [A('ptz_preset_recall', { cam: c.id, preset: n, speed: '' })], [],
          [{ feedbackId: 'ptz_last_preset', options: { cam: c.id, preset: n }, style: lit('ptz_pvw', COLORS.green) }]);
      }
    }
    const S0 = { cam: 'selected' };
    const arrows = { up: '▲', down: '▼', left: '◀', right: '▶', upLeft: '◤', upRight: '◥', downLeft: '◣', downRight: '◢' };
    for (const [d, g] of Object.entries(arrows)) {
      out[`ptz_move_${d}`] = btn('PTZ: pan / tilt (selected camera, hold)', `Pan/tilt ${d} while held`, look('ptz', `${g}\\nPAN TILT`), [A('ptz_move', { ...S0, dir: d, speed: 0 })], [A('ptz_stop', { ...S0, axes: 'pt' })],
        [{ feedbackId: 'ptz_moving', options: S0, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
    }
    out.ptz_home = btn('PTZ: pan / tilt (selected camera, hold)', 'Home', look('ptz', 'HOME'), [A('ptz_exec', { ...S0, op: 'home' })]);
    out.ptz_stop_all = btn('PTZ: pan / tilt (selected camera, hold)', 'ALL STOP (every camera)', look('take', 'ALL\\nSTOP', COLORS.white, COLORS.red), [A('ptz_stop_all')]);
    for (const [d, t] of [['tele', 'ZOOM\\nTELE'], ['wide', 'ZOOM\\nWIDE'], ['near', 'FOCUS\\nNEAR'], ['far', 'FOCUS\\nFAR']]) {
      const zoom = d === 'tele' || d === 'wide';
      out[`ptz_${d}`] = btn('PTZ: lens (selected camera, hold)', `${zoom ? 'Zoom' : 'Focus'} ${d} while held`, look('ptz', t), [A(zoom ? 'ptz_zoom' : 'ptz_focus', { ...S0, dir: d, speed: 0 })], [A('ptz_stop', { ...S0, axes: zoom ? 'zoom' : 'focus' })]);
    }
    out.ptz_af = btn('PTZ: lens (selected camera, hold)', 'Auto focus on/off', look('ptz', `FOCUS\\n${T('ptz_sel_focus_mode')}`), [A('ptz_toggle', { ...S0, op: 'focusMode', mode: 'toggle' })], [],
      [{ feedbackId: 'ptz_on', options: { ...S0, op: 'focusMode' }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
    out.ptz_otaf = btn('PTZ: lens (selected camera, hold)', 'One-touch / push auto focus', look('ptz', 'PUSH\\nAF'), [A('ptz_exec', { ...S0, op: 'oneTouchAF' })]);
    out.ptz_iris_auto = btn('PTZ: exposure (selected camera)', 'Auto iris on/off', look('ptz', `IRIS\\n${T('ptz_sel_iris_mode')}`), [A('ptz_toggle', { ...S0, op: 'irisMode', mode: 'toggle' })], [],
      [{ feedbackId: 'ptz_on', options: { ...S0, op: 'irisMode' }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
    out.ptz_iris_up = btn('PTZ: exposure (selected camera)', 'Iris open', look('ptz', `IRIS +\\n${T('ptz_sel_iris')}`), [A('ptz_adjust', { ...S0, op: 'iris', mode: 'inc', value: 1 })]);
    out.ptz_iris_down = btn('PTZ: exposure (selected camera)', 'Iris close', look('ptz', `IRIS −\\n${T('ptz_sel_iris')}`), [A('ptz_adjust', { ...S0, op: 'iris', mode: 'dec', value: 1 })]);
    out.ptz_gain_up = btn('PTZ: exposure (selected camera)', 'Gain up', look('ptz', `GAIN +\\n${T('ptz_sel_gain')}`), [A('ptz_step', { ...S0, op: 'gain', dir: 'up' })]);
    out.ptz_gain_down = btn('PTZ: exposure (selected camera)', 'Gain down', look('ptz', `GAIN −\\n${T('ptz_sel_gain')}`), [A('ptz_step', { ...S0, op: 'gain', dir: 'down' })]);
    out.ptz_nd_up = btn('PTZ: exposure (selected camera)', 'ND filter next', look('ptz', `ND\\n${T('ptz_sel_nd')}`), [A('ptz_step', { ...S0, op: 'ndFilter', dir: 'up' })]);
    out.ptz_shutter_up = btn('PTZ: exposure (selected camera)', 'Shutter step up (UE150 spec)', look('ptz', `SHUT +\\n${T('ptz_sel_shutter')}`), [A('ptz_exec', { ...S0, op: 'shutterStepUp' })]);
    out.ptz_shutter_down = btn('PTZ: exposure (selected camera)', 'Shutter step down (UE150 spec)', look('ptz', `SHUT −\\n${T('ptz_sel_shutter')}`), [A('ptz_exec', { ...S0, op: 'shutterStepDown' })]);
    out.ptz_awb = btn('PTZ: white balance / paint (selected camera)', 'AWB execute', look('ptz', 'AWB'), [A('ptz_exec', { ...S0, op: 'awb' })]);
    out.ptz_abb = btn('PTZ: white balance / paint (selected camera)', 'ABB execute', look('ptz', 'ABB'), [A('ptz_exec', { ...S0, op: 'abb' })]);
    for (const [v, t] of [['0', 'ATW'], ['1', 'AWB A'], ['2', 'AWB B']]) {
      out[`ptz_wb_${t.replace(' ', '_')}`] = btn('PTZ: white balance / paint (selected camera)', `White balance ${t}`, look('ptz', `WB\\n${t}`), [A('ptz_set', { ...S0, op: 'wbMode', value: v })], [],
        [{ feedbackId: 'ptz_value', options: { ...S0, op: 'wbMode', value: v }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
    }
    for (const [op, t] of [['rGain', 'R GAIN'], ['bGain', 'B GAIN'], ['rPed', 'R PED'], ['bPed', 'B PED'], ['masterPed', 'M PED']]) {
      out[`ptz_${op}_up`] = btn('PTZ: white balance / paint (selected camera)', `${t} +`, look('ptz', `${t}\\n+`), [A('ptz_adjust', { ...S0, op, mode: 'inc', value: 4 })]);
      out[`ptz_${op}_down`] = btn('PTZ: white balance / paint (selected camera)', `${t} −`, look('ptz', `${t}\\n−`), [A('ptz_adjust', { ...S0, op, mode: 'dec', value: 4 })]);
    }
    out.ptz_power = btn('PTZ: system (selected camera)', 'Power on / standby', look('ptz', `POWER\\n${T('ptz_sel_power')}`), [A('ptz_power', { ...S0, mode: 'toggle' })], [],
      [{ feedbackId: 'ptz_power_on', options: S0, style: lit('ptz_pvw', COLORS.green) }]);
    out.ptz_tally_red = btn('PTZ: system (selected camera)', 'Red tally', look('ptz', 'TALLY\\nRED'), [A('ptz_tally', { ...S0, color: 'red', mode: 'toggle' })], [], [{ feedbackId: 'ptz_tally', options: { ...S0, color: 'red' }, style: lit('ptz_pgm', COLORS.red) }]);
    out.ptz_tally_green = btn('PTZ: system (selected camera)', 'Green tally', look('ptz', 'TALLY\\nGREEN'), [A('ptz_tally', { ...S0, color: 'green', mode: 'toggle' })], [], [{ feedbackId: 'ptz_tally', options: { ...S0, color: 'green' }, style: lit('ptz_pvw', COLORS.green) }]);
    out.ptz_menu = btn('PTZ: OSD menu (selected camera)', 'OSD menu on/off', look('ptz', 'MENU'), [A('ptz_toggle', { ...S0, op: 'menu', mode: 'toggle' })], [], [{ feedbackId: 'ptz_on', options: { ...S0, op: 'menu' }, style: lit('ptz_sel', COLORS.amber, COLORS.black) }]);
    for (const [op, t] of [['menuUp', '▲'], ['menuDown', '▼'], ['menuLeft', '◀'], ['menuRight', '▶'], ['menuEnter', 'ENTER'], ['menuCancel', 'CANCEL']]) out[`ptz_${op}`] = btn('PTZ: OSD menu (selected camera)', `OSD ${op.slice(4)}`, look('ptz', `MENU\\n${t}`), [A('ptz_exec', { ...S0, op })]);
    // 0.7.0: per-camera deck controls with stable ids ptz_<cam>_<control>, so a generated page per camera always drives
    // that camera (not whichever camera is selected). Encoders (enc_*) are for Stream Deck + / + XL knobs: rotate_left /
    // rotate_right both pass the fork's signed $(this:delta) (fallback -1 / +1 on a Companion without it).
    for (const c of cams(S)) Object.assign(out, camDeckPresets(c));
    out.ptz_status = btn('PTZ: system (selected camera)', 'Selected camera readout', look('status', `${T('ptz_sel_name')}\\nZ ${T('ptz_sel_zoom')}\\nI ${T('ptz_sel_iris')}`, COLORS.white, COLORS.black), []);
  }
  return out;
}

module.exports = {
  PRESET_SYS, SYS_NAMES, OPS, OP_BY_ID, PTZ_PRESET_BUTTONS, DIRS, DIR_CHOICES, ATEM_STYLES,
  view, connected, configured, safeId,
  xPresets, xFind, xDests, xPresetChoices, xDestChoices, xCueChoices, xTally, xDestSelected,
  atemName, atemBusChoices, atemAuxSourceChoices, atemKeyChoices, atemDskChoices, atemAuxChoices, atemMacroChoices, atemFeedback,
  cams, selectedCam, camId, camOf, camChoices, opsOfType, opChoices, opFor, fmtValue, stepRange, stepList, moveBody, lensBody, ptzFeedback, presetName,
  variableDefinitions, variableValues, signature, buttonPresets, camDeckPresets, CAM_KNOBS, KNOB_IDS, deltaOf, clampSpeed,
};

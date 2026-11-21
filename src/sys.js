'use strict';
// 0.6.0 PV Control Center: E2, PixelHue, ATEM and Panasonic PTZ, all through the Control Center app's HTTP API
// (never the devices themselves). Pure helpers, no Companion imports, so they can be unit tested.
// The state is the app's multi-system long-poll: GET /api/sys?since=<rev>&timeout=<ms>&views=all
//   { rev, active, systems: {key: {status, capabilities, configured, ...}}, views: {e2, pixelhue, atem, ptz} }
const OPS = require('./ptz-ops');

const PRESET_SYS = { e2: 'E2', pixelhue: 'PixelHue' };
const SYS_NAMES = { rs6: 'RS6', e2: 'E2', pixelhue: 'PixelHue', atem: 'ATEM', ptz: 'PTZ' };
const OP_BY_ID = new Map(OPS.map((o) => [o.id, o]));
const PTZ_PRESET_BUTTONS = 16; // per camera: preset name variables 1..16 (any 1..100 works in the actions)
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
// 0.8.0 (app 0.10.0, API 9): router outputs, every source, audio inputs, M/Es, SuperSource boxes and layouts
const atemSrcLabel = (S, id) => { const a = atem(S); const i = a && (a.sources || a.inputs || []).find((x) => x.id === Number(id)); return i ? i.long || i.short || String(id) : String(id); };
const atemOutputs = (S) => (atem(S) && atem(S).outputs) || [];
const atemOutputChoices = (S) => one(atemOutputs(S).map((o) => ({ id: o.key, label: `${o.group === 'aux' ? '' : o.group === 'me' ? 'M/E · ' : 'MV · '}${o.label}` })), { id: 'aux:0', label: 'Aux 1' });
const atemSourceChoices = (S) => one(((atem(S) && (atem(S).sources || atem(S).auxSources)) || []).map((i) => ({ id: i.id, label: `${i.id} ${i.long || i.short}` })), { id: 1, label: '1 Input 1' });
const atemAudioInputs = (S) => ((atem(S) && atem(S).audio && atem(S).audio.inputs) || []);
const atemAudioChoices = (S) => one(atemAudioInputs(S).map((i) => ({ id: i.id, label: `${i.name || i.id}${i.port ? ` (${i.port})` : ''}` })), { id: 1, label: 'Input 1' });
const atemMeChoices = (S) => one(((atem(S) && atem(S).mixEffects) || []).map((m) => ({ id: m.index + 1, label: `M/E ${m.index + 1}` })), { id: 1, label: 'M/E 1' });
const atemSsChoices = (S) => one(((atem(S) && atem(S).superSources) || []).map((x) => ({ id: x.index, label: `SuperSource ${x.index + 1}` })), { id: 0, label: 'SuperSource 1' });
const atemBoxChoices = (S) => { const ss = ((atem(S) && atem(S).superSources) || [])[0]; const n = (ss && ss.boxes && ss.boxes.length) || 4; return Array.from({ length: n }, (_, i) => ({ id: i, label: `Box ${i + 1}` })); };
const atemSsLayoutChoices = (S) => one(((atem(S) && atem(S).ssLayouts) || []).map((l) => ({ id: l.id, label: l.name })), { id: 'quad', label: 'Quad' });
const meOf = (o) => Math.max(1, Number(o && o.me) || 1); // older saved actions have no M/E: M/E 1
const meKeyer = (a, o) => { const m = (a.mixEffects || [])[meOf(o) - 1]; return m ? (m.keyers || []).find((x) => x.index === Number(o.key)) : (meOf(o) === 1 ? (a.keyers || []).find((x) => x.index === Number(o.key)) : null); };
const atemMuted = (S, id) => { const i = atemAudioInputs(S).find((x) => x.id === Number(id)); return !!(i && (i.muted || i.mix === 'off')); };
const ssBoxOf = (a, o) => { const ss = (a.superSources || []).find((x) => x.index === Number(o.ss || 0)); return ss ? (ss.boxes || []).find((b) => b.index === Number(o.box)) : null; };

function atemFeedback(S, kind, o = {}) {
  const a = atem(S); if (!a) return false;
  switch (kind) {
    case 'program': return a.program === Number(o.source);
    case 'preview': return a.preview === Number(o.source);
    case 'usk': { const k = meKeyer(a, o); return !!(k && (o.what === 'tie' ? k.tie : k.onAir)); }
    case 'output': {
      const key = String(o.output); const x = (a.outputs || []).find((q) => q.key === key);
      if (x) return x.source === Number(o.source);
      // Control Center 0.11.0+ lists M/E program / preview as buses, not router outputs: read them from mixEffects
      const m = /^me:(\d+):(program|preview)$/.exec(key); if (!m) return false;
      const mes = a.mixEffects || []; const me = mes.find((e) => Number(e && e.index) === Number(m[1])) || mes[Number(m[1])];
      return !!(me && me[m[2]] === Number(o.source));
    }
    case 'muted': return atemMuted(S, o.input);
    case 'ssBox': { const b = ssBoxOf(a, o); return !!(b && (o.what === 'enabled' ? b.enabled : b.enabled && b.source === Number(o.source))); }
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
    // 0.8.0: every router output, audio input levels, SuperSource boxes
    for (const o of atemOutputs(S)) d.push({ variableId: `atem_out_${safeId(o.key)}`, name: `ATEM: ${o.label} source (short name)` });
    for (const i of atemAudioInputs(S)) d.push({ variableId: `atem_audio_${i.id}_fader`, name: `ATEM audio: ${i.name || i.id} fader (dB)` }, { variableId: `atem_audio_${i.id}_mix`, name: `ATEM audio: ${i.name || i.id} mix (on/off/afv)` });
    if (a.audio) d.push({ variableId: 'atem_audio_master_fader', name: 'ATEM audio: master fader (dB)' });
    for (const x of a.superSources || []) for (const b of x.boxes || []) d.push({ variableId: `atem_ss${x.index + 1}_box${b.index + 1}`, name: `ATEM: SuperSource ${x.index + 1} box ${b.index + 1} source (short name)` });
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
    const sh = (id) => { const i = (a.sources || a.inputs || []).find((x) => x.id === Number(id)); return i ? i.short || i.long || String(id) : id === undefined || id === null ? '' : String(id); };
    const db = (x) => (Number.isFinite(x) ? (x <= -100 ? '-inf' : (Math.round(x * 10) / 10).toFixed(1)) : '');
    for (const o of atemOutputs(S)) v[`atem_out_${safeId(o.key)}`] = o.sourceShort || sh(o.source);
    for (const i of atemAudioInputs(S)) { v[`atem_audio_${i.id}_fader`] = db(i.fader); v[`atem_audio_${i.id}_mix`] = i.mix || ''; }
    if (a.audio) v.atem_audio_master_fader = db(a.audio.master && a.audio.master.fader);
    for (const x of a.superSources || []) for (const b of x.boxes || []) v[`atem_ss${x.index + 1}_box${b.index + 1}`] = b.enabled ? sh(b.source) : 'off';
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

module.exports = {
  PRESET_SYS, SYS_NAMES, OPS, OP_BY_ID, PTZ_PRESET_BUTTONS, DIRS, DIR_CHOICES, ATEM_STYLES,
  view, connected, configured, safeId,
  xPresets, xFind, xDests, xPresetChoices, xDestChoices, xCueChoices, xTally, xDestSelected,
  atemName, atemSrcLabel, atemOutputs, atemOutputChoices, atemSourceChoices, atemAudioInputs, atemAudioChoices, atemMeChoices, atemSsChoices, atemBoxChoices, atemSsLayoutChoices, atemMuted, meOf,
  atemBusChoices, atemAuxSourceChoices, atemKeyChoices, atemDskChoices, atemAuxChoices, atemMacroChoices, atemFeedback,
  cams, selectedCam, camId, camOf, camChoices, opsOfType, opChoices, opFor, fmtValue, stepRange, stepList, moveBody, lensBody, ptzFeedback, presetName,
  variableDefinitions, variableValues, signature, deltaOf, clampSpeed,
};

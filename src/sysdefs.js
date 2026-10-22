'use strict';
// 0.6.0 PV Control Center: action and feedback definitions for E2, PixelHue, ATEM and PTZ. Every callback calls the
// Control Center app's HTTP API (src/api.js); nothing talks to a device. `inst` is the Companion instance (src/main.js).
// New ids are prefixed by system (e2_, pixelhue_, atem_, ptz_, sys_); the RS6 ids in main.js are unchanged.
const X = require('./sys');
const L = require('./logic');
const { COLORS } = L;

const TRI = { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] };
const triOf = (mode, cur) => (mode === 'on' ? true : mode === 'off' ? false : !cur);
const dd = (id, label, choices, extra = {}) => ({ type: 'dropdown', id, label, default: choices[0] ? choices[0].id : '', choices, ...extra });

function sysActions(inst) {
  const S = inst.sys; const out = {};
  const run = (label, fn) => inst.runSys(label, fn);
  out.sys_set_active = {
    name: 'Control Center: show a system in the app',
    options: [dd('system', 'System', Object.entries(X.SYS_NAMES).map(([id, label]) => ({ id, label })))],
    callback: (a) => run('Show system', () => inst.api.sysActive(a.options.system)),
  };
  // ---- E2 / PixelHue ----
  for (const [sys, nm] of Object.entries(X.PRESET_SYS)) {
    const presetOpt = dd('preset', 'Preset tile', X.xPresetChoices(S, sys), { allowCustom: true, regex: '/^\\d+$/' });
    const destOpt = dd('dest', 'Destination (S<n> screen / A<n> aux)', X.xDestChoices(S, sys), { allowCustom: true, regex: '/^[SAsa]\\d+$/' });
    out[`${sys}_recall_preset`] = {
      name: `${nm}: recall preset (tile)`,
      options: [presetOpt, dd('target', 'To', [{ id: 'preview', label: 'Preview' }, { id: 'program', label: 'Program' }])],
      callback: (a) => run(`${nm} recall`, () => inst.api.sysRecall(sys, String(a.options.preset), a.options.target)),
    };
    out[`${sys}_take`] = { name: `${nm}: TAKE`, options: [], callback: () => run(`${nm} take`, () => inst.api.sysTake(sys)) };
    out[`${sys}_cut`] = { name: `${nm}: CUT`, options: [], callback: () => run(`${nm} cut`, () => inst.api.sysCut(sys)) };
    out[`${sys}_toggle_destination`] = { name: `${nm}: toggle destination`, options: [destOpt], callback: (a) => run(`${nm} toggle destination`, () => inst.api.sysToggleDest(sys, String(a.options.dest).toUpperCase())) };
    out[`${sys}_set_destinations`] = {
      name: `${nm}: select destinations (replace the selection)`,
      options: [{ type: 'textinput', id: 'dests', label: 'Destinations, comma separated (e.g. S1,S2,A1; empty = none)', default: 'S1' }],
      callback: (a) => run(`${nm} select destinations`, () => inst.api.sysSelection(sys, String(a.options.dests || '').split(/[,\s]+/).filter(Boolean).map((k) => k.toUpperCase()))),
    };
    out[`${sys}_auto_take`] = {
      name: `${nm}: auto take on recall`, options: [TRI],
      callback: (a) => run(`${nm} auto take`, () => inst.api.sysAutoTake(sys, a.options.mode === 'toggle' ? undefined : a.options.mode === 'on')),
    };
    out[`${sys}_refresh`] = { name: `${nm}: re-read presets and destinations`, options: [], callback: () => run(`${nm} refresh`, () => inst.api.sysRefresh(sys)) };
    if (sys === 'e2') {
      out.e2_cue = {
        name: 'E2: cue play / pause / stop',
        options: [dd('cue', 'Cue', X.xCueChoices(S), { allowCustom: true, regex: '/^\\d+$/' }), dd('op', 'Command', [{ id: 'play', label: 'Play' }, { id: 'pause', label: 'Pause' }, { id: 'stop', label: 'Stop' }])],
        callback: (a) => run('E2 cue', () => inst.api.sysCue('e2', a.options.cue, a.options.op)),
      };
      out.e2_freeze = {
        name: 'E2: freeze a source / destination',
        options: [dd('kind', 'What', [{ id: 'source', label: 'Source' }, { id: 'screen', label: 'Screen destination' }, { id: 'aux', label: 'Aux destination' }]),
          { type: 'textinput', id: 'id', label: 'Id (as listed in the app)', default: '0' }, dd('on', 'Freeze', [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }])],
        callback: (a) => run('E2 freeze', () => inst.api.sysFreeze('e2', a.options.kind, a.options.id, a.options.on === 'on')),
      };
    }
  }
  // ---- ATEM ----
  const bus = X.atemBusChoices(S); const ar = (name, body, label) => run(`ATEM ${label || name}`, () => inst.api.atem(name, body));
  const a0 = () => (inst.sys && inst.sys.views && inst.sys.views.atem) || {};
  const keyState = (list, k, f) => { const e = (a0()[list] || []).find((x) => x.index === Number(k)); return !!(e && e[f]); };
  Object.assign(out, {
    atem_program: { name: 'ATEM: Program source', options: [dd('source', 'Source', bus, { allowCustom: true, regex: '/^\\d+$/' })], callback: (a) => ar('program', { source: Number(a.options.source) }) },
    atem_preview: { name: 'ATEM: Preview source', options: [dd('source', 'Source', bus, { allowCustom: true, regex: '/^\\d+$/' })], callback: (a) => ar('preview', { source: Number(a.options.source) }) },
    atem_cut: { name: 'ATEM: CUT', options: [], callback: () => ar('cut') },
    atem_auto: { name: 'ATEM: AUTO transition', options: [], callback: () => ar('auto') },
    atem_ftb: { name: 'ATEM: fade to black', options: [], callback: () => ar('ftb') },
    atem_ftb_rate: { name: 'ATEM: fade to black rate', options: [{ type: 'number', id: 'rate', label: 'Frames (1-250)', default: 25, min: 1, max: 250 }], callback: (a) => ar('ftbRate', { rate: a.options.rate }) },
    atem_style: { name: 'ATEM: transition style', options: [dd('style', 'Style', X.ATEM_STYLES.map((s) => ({ id: s, label: s })))], callback: (a) => ar('style', { style: a.options.style }) },
    atem_mix_rate: { name: 'ATEM: mix rate', options: [{ type: 'number', id: 'rate', label: 'Frames (1-250)', default: 25, min: 1, max: 250 }], callback: (a) => ar('mixRate', { rate: a.options.rate }) },
    atem_usk_onair: { name: 'ATEM: upstream key on air', options: [dd('key', 'Key', X.atemKeyChoices(S)), TRI], callback: (a) => ar('uskOnAir', { key: Number(a.options.key), on: triOf(a.options.mode, keyState('keyers', a.options.key, 'onAir')) }, 'key on air') },
    atem_usk_tie: { name: 'ATEM: upstream key in the next transition (tie)', options: [dd('key', 'Key', X.atemKeyChoices(S)), TRI], callback: (a) => ar('uskTie', { key: Number(a.options.key), on: triOf(a.options.mode, keyState('keyers', a.options.key, 'tie')) }, 'key tie') },
    atem_dsk_onair: { name: 'ATEM: downstream key on air', options: [dd('key', 'DSK', X.atemDskChoices(S)), TRI], callback: (a) => ar('dskOnAir', { key: Number(a.options.key), on: triOf(a.options.mode, keyState('dsk', a.options.key, 'onAir')) }, 'DSK on air') },
    atem_dsk_tie: { name: 'ATEM: downstream key tie', options: [dd('key', 'DSK', X.atemDskChoices(S)), TRI], callback: (a) => ar('dskTie', { key: Number(a.options.key), on: triOf(a.options.mode, keyState('dsk', a.options.key, 'tie')) }, 'DSK tie') },
    atem_dsk_auto: { name: 'ATEM: downstream key AUTO', options: [dd('key', 'DSK', X.atemDskChoices(S))], callback: (a) => ar('dskAuto', { key: Number(a.options.key) }, 'DSK auto') },
    atem_aux: { name: 'ATEM: aux output source', options: [dd('aux', 'Aux', X.atemAuxChoices(S)), dd('source', 'Source', X.atemAuxSourceChoices(S), { allowCustom: true, regex: '/^\\d+$/' })], callback: (a) => ar('aux', { aux: Number(a.options.aux), source: Number(a.options.source) }) },
    atem_macro_run: { name: 'ATEM: run macro', options: [dd('macro', 'Macro', X.atemMacroChoices(S), { allowCustom: true, regex: '/^\\d+$/' })], callback: (a) => ar('macroRun', { macro: Number(a.options.macro) }, 'macro run') },
    atem_macro_stop: { name: 'ATEM: stop macro', options: [], callback: () => ar('macroStop', {}, 'macro stop') },
  });
  // ---- PTZ ----
  const camOpt = dd('cam', 'Camera', X.camChoices(S), { allowCustom: true, regex: '/^[\\w-]+$/' });
  const speedOpt = (label) => ({ type: 'number', id: 'speed', label: `${label} speed (1-49; 0 = the app's session speed)`, default: 0, min: 0, max: 49 });
  const pr = (label, name, body) => run(`PTZ ${label}`, () => inst.api.ptz(name, body));
  const cur = (cam, op) => { const c = X.camOf(inst.sys, cam); return c && c.values ? c.values[op] : undefined; };
  const op = (cam, id) => X.opFor(inst.ptzCats, inst.sys, cam, id);
  Object.assign(out, {
    ptz_select_camera: { name: 'PTZ: select camera (the app\'s CAMERA CONTROL and the "Selected camera" buttons)', options: [dd('cam', 'Camera', X.camChoices(S, false).length ? X.camChoices(S, false) : [{ id: 'cam1', label: 'cam1' }], { allowCustom: true })], callback: (a) => pr('select', 'select', { cam: a.options.cam }) },
    // hold-to-run: put ptz_move / ptz_zoom / ptz_focus on DOWN and ptz_stop on UP. The module re-arms the app's dead-man
    // while held and stops by itself after the "max hold" time (Settings) or when the connection is lost.
    ptz_move: { name: 'PTZ: pan / tilt while held (put PTZ: stop on release)', options: [camOpt, dd('dir', 'Direction', X.DIR_CHOICES), speedOpt('Pan/tilt')], callback: (a) => inst.ptzHold('pt', a.options.cam, (cam) => inst.api.ptz('move', X.moveBody(cam, a.options.dir, a.options.speed))) },
    ptz_move_xy: {
      name: 'PTZ: pan / tilt at a signed speed while held (proportional, -49..49 each)',
      options: [camOpt, { type: 'number', id: 'pan', label: 'Pan (-49 left .. 49 right)', default: 10, min: -49, max: 49 }, { type: 'number', id: 'tilt', label: 'Tilt (-49 down .. 49 up)', default: 0, min: -49, max: 49 }],
      callback: (a) => inst.ptzHold('pt', a.options.cam, (cam) => inst.api.ptz('move', { cam, pan: Number(a.options.pan) || 0, tilt: Number(a.options.tilt) || 0, speed: true })),
    },
    ptz_zoom: { name: 'PTZ: zoom while held (put PTZ: stop on release)', options: [camOpt, dd('dir', 'Direction', [{ id: 'tele', label: 'Tele (in)' }, { id: 'wide', label: 'Wide (out)' }]), speedOpt('Zoom')], callback: (a) => inst.ptzHold('zoom', a.options.cam, (cam) => inst.api.ptz('zoom', X.lensBody(cam, a.options.dir, a.options.speed))) },
    ptz_focus: { name: 'PTZ: focus while held (put PTZ: stop on release)', options: [camOpt, dd('dir', 'Direction', [{ id: 'far', label: 'Far' }, { id: 'near', label: 'Near' }]), speedOpt('Focus')], callback: (a) => inst.ptzHold('focus', a.options.cam, (cam) => inst.api.ptz('focus', X.lensBody(cam, a.options.dir, a.options.speed))) },
    ptz_stop: {
      name: 'PTZ: stop (release of a held button)',
      options: [camOpt, dd('axes', 'Stop', [{ id: 'all', label: 'Pan/tilt, zoom and focus' }, { id: 'pt', label: 'Pan/tilt' }, { id: 'zoom', label: 'Zoom' }, { id: 'focus', label: 'Focus' }])],
      callback: (a) => inst.ptzRelease(a.options.cam, a.options.axes),
    },
    ptz_stop_all: { name: 'PTZ: ALL STOP (every camera, every axis)', options: [], callback: () => inst.ptzReleaseAll() },
    ptz_speeds: {
      name: 'PTZ: session speeds (the app\'s speed sliders)',
      options: [{ type: 'number', id: 'pt', label: 'Pan/tilt (1-49)', default: 25, min: 1, max: 49 }, { type: 'number', id: 'zoom', label: 'Zoom (1-49)', default: 25, min: 1, max: 49 }, { type: 'number', id: 'focus', label: 'Focus (1-49)', default: 15, min: 1, max: 49 }],
      callback: (a) => pr('speeds', 'speeds', { pt: a.options.pt, zoom: a.options.zoom, focus: a.options.focus }),
    },
    ptz_preset_recall: {
      name: 'PTZ: recall preset',
      options: [camOpt, { type: 'number', id: 'preset', label: 'Preset (1-100)', default: 1, min: 1, max: 100 }, { type: 'textinput', id: 'speed', label: 'Preset speed code (empty = unchanged; e.g. 999 fastest, 275 slowest)', default: '' }],
      callback: (a) => pr('recall', 'recall', { cam: X.camId(inst.sys, a.options.cam), preset: Number(a.options.preset), speed: String(a.options.speed || '').trim() || undefined }),
    },
    ptz_preset_store: {
      name: 'PTZ: store preset',
      options: [camOpt, { type: 'number', id: 'preset', label: 'Preset (1-100)', default: 1, min: 1, max: 100 }, { type: 'textinput', id: 'name', label: 'Name (optional)', default: '' }],
      callback: (a) => pr('store', 'store', { cam: X.camId(inst.sys, a.options.cam), preset: Number(a.options.preset), name: String(a.options.name || '').trim() || undefined }),
    },
    ptz_power: { name: 'PTZ: power on / standby', options: [camOpt, TRI], callback: (a) => { const c = X.camOf(inst.sys, a.options.cam); return pr('power', 'power', { cam: X.camId(inst.sys, a.options.cam), on: triOf(a.options.mode, c && c.power === 'on') }); } },
    ptz_tally: {
      name: 'PTZ: tally lamp', options: [camOpt, dd('color', 'Lamp', [{ id: 'red', label: 'Red' }, { id: 'green', label: 'Green (where the camera has one)' }]), TRI],
      callback: (a) => { const c = X.camOf(inst.sys, a.options.cam); const now = c ? (a.options.color === 'green' ? c.tallyGreen : c.tally) : false; return pr('tally', 'tally', { cam: X.camId(inst.sys, a.options.cam), color: a.options.color, on: triOf(a.options.mode, now) }); },
    },
    // the full camera command set (bitfocus companion-module-panasonic-ptz aw_ptz / aw_cam + AW-UE150 spec), by type
    ptz_exec: { name: 'PTZ: camera command (one-shot: AWB, ABB, one-touch AF, home, menu keys, step up/down …)', options: [camOpt, dd('op', 'Command', X.opChoices(['button']))], callback: (a) => pr(a.options.op, 'op', { cam: X.camId(inst.sys, a.options.cam), op: a.options.op }) },
    ptz_toggle: { name: 'PTZ: camera on/off setting (AF, auto iris, super gain, detail, bars, OSD menu …)', options: [camOpt, dd('op', 'Setting', X.opChoices(['toggle'])), TRI], callback: (a) => pr(a.options.op, 'op', { cam: X.camId(inst.sys, a.options.cam), op: a.options.op, value: triOf(a.options.mode, cur(a.options.cam, a.options.op)) }) },
    ptz_set: {
      name: 'PTZ: camera setting to a value (gain, ND, shutter, WB mode, scene, gamma, knee, matrix type …)',
      options: [camOpt, dd('op', 'Setting', X.opChoices(['list', 'range'])), { type: 'textinput', id: 'value', label: 'Value (a list code such as 08 for 0dB gain, or a number; see the app\'s CAMERAS › command reference)', default: '' }],
      callback: (a) => { const o = op(a.options.cam, a.options.op); const v = String(a.options.value).trim(); return pr(a.options.op, 'op', { cam: X.camId(inst.sys, a.options.cam), op: a.options.op, value: o && o.type === 'range' ? Number(v) : v }); },
    },
    ptz_step: {
      name: 'PTZ: camera list setting up / down (gain, ND, shutter mode, scene …)', options: [camOpt, dd('op', 'Setting', X.opChoices(['list'])), dd('dir', 'Direction', [{ id: 'up', label: 'Up / next' }, { id: 'down', label: 'Down / previous' }])],
      callback: (a) => { const o = op(a.options.cam, a.options.op); const v = X.stepList(o, cur(a.options.cam, a.options.op), a.options.dir === 'down' ? -1 : 1); if (v === undefined) { inst.log('warn', `PTZ ${a.options.op}: no values known for this camera`); return undefined; } return pr(a.options.op, 'op', { cam: X.camId(inst.sys, a.options.cam), op: a.options.op, value: v }); },
    },
    ptz_adjust: {
      name: 'PTZ: camera level set / up / down (iris, R/B gain, pedestals, detail, gamma, knee, matrix, chroma, colour temperature …)',
      options: [camOpt, dd('op', 'Level', X.opChoices(['range'])), dd('mode', 'Mode', [{ id: 'inc', label: 'Up by' }, { id: 'dec', label: 'Down by' }, { id: 'set', label: 'Set to' }, { id: 'centre', label: 'Centre / default' }]), { type: 'number', id: 'value', label: 'Steps (up/down) or value (set)', default: 1, min: -100000, max: 100000 }],
      callback: (a) => {
        const o = op(a.options.cam, a.options.op); const c = cur(a.options.cam, a.options.op); const m = a.options.mode; const n = Number(a.options.value) || 0;
        const v = m === 'set' ? n : m === 'centre' ? ((o && o.range && o.range.centre) ?? 0) : X.stepRange(o, c, m === 'dec' ? -n : n);
        inst.optimistic(a.options.cam, a.options.op, v);
        return pr(a.options.op, 'op', { cam: X.camId(inst.sys, a.options.cam), op: a.options.op, value: v });
      },
    },
    ptz_refresh: { name: 'PTZ: re-read the camera', options: [camOpt], callback: (a) => pr('refresh', 'refresh', { cam: X.camId(inst.sys, a.options.cam) }) },
  });
  return out;
}

function sysFeedbacks(inst) {
  const g = () => inst.sys; const out = {};
  const AMBER = { bgcolor: COLORS.amber, color: COLORS.black }; const GREEN = { bgcolor: COLORS.green, color: COLORS.white }; const RED = { bgcolor: COLORS.red, color: COLORS.white };
  const bool = (name, defaultStyle, options, callback) => ({ type: 'boolean', name, defaultStyle, options, callback });
  const S = g();
  for (const [sys, nm] of Object.entries(X.PRESET_SYS)) {
    const presetOpts = [dd('preset', 'Preset tile', X.xPresetChoices(S, sys), { allowCustom: true }), { type: 'checkbox', id: 'partial', label: 'Also light when only some of its destinations match', default: false }];
    out[`${sys}_preset_pvw`] = bool(`${nm}: preset on Preview`, GREEN, presetOpts, (f) => X.xTally(g(), sys, f.options.preset, 'pvw', f.options.partial));
    out[`${sys}_preset_pgm`] = bool(`${nm}: preset on Program`, RED, presetOpts, (f) => X.xTally(g(), sys, f.options.preset, 'pgm', f.options.partial));
    out[`${sys}_dest_selected`] = bool(`${nm}: destination selected`, AMBER, [dd('dest', 'Destination', X.xDestChoices(S, sys), { allowCustom: true })], (f) => X.xDestSelected(g(), sys, f.options.dest));
    out[`${sys}_auto_take_on`] = bool(`${nm}: auto take is ON`, AMBER, [], () => !!(X.view(g(), sys) && X.view(g(), sys).autoTake));
    out[`${sys}_connected`] = bool(`${nm}: app connected to the ${nm}`, GREEN, [], () => X.connected(g(), sys));
  }
  const bus = X.atemBusChoices(S);
  Object.assign(out, {
    atem_connected: bool('ATEM: app connected to the ATEM', GREEN, [], () => X.connected(g(), 'atem')),
    atem_program_is: bool('ATEM: source on Program', RED, [dd('source', 'Source', bus, { allowCustom: true })], (f) => X.atemFeedback(g(), 'program', f.options)),
    atem_preview_is: bool('ATEM: source on Preview', GREEN, [dd('source', 'Source', bus, { allowCustom: true })], (f) => X.atemFeedback(g(), 'preview', f.options)),
    atem_usk: bool('ATEM: upstream key on air / tied', RED, [dd('key', 'Key', X.atemKeyChoices(S)), dd('what', 'State', [{ id: 'onair', label: 'On air' }, { id: 'tie', label: 'In the next transition' }])], (f) => X.atemFeedback(g(), 'usk', f.options)),
    atem_dsk: bool('ATEM: downstream key on air / tied / in transition', RED, [dd('key', 'DSK', X.atemDskChoices(S)), dd('what', 'State', [{ id: 'onair', label: 'On air' }, { id: 'tie', label: 'Tied' }, { id: 'transition', label: 'In transition' }])], (f) => X.atemFeedback(g(), 'dsk', f.options)),
    atem_aux_is: bool('ATEM: aux output source is', AMBER, [dd('aux', 'Aux', X.atemAuxChoices(S)), dd('source', 'Source', X.atemAuxSourceChoices(S), { allowCustom: true })], (f) => X.atemFeedback(g(), 'aux', f.options)),
    atem_macro_running: bool('ATEM: macro running', AMBER, [dd('macro', 'Macro', [{ id: 'any', label: 'Any macro' }, ...X.atemMacroChoices(S)])], (f) => X.atemFeedback(g(), 'macro', f.options)),
    atem_ftb_active: bool('ATEM: fade to black active', RED, [], () => X.atemFeedback(g(), 'ftb')),
    atem_in_transition: bool('ATEM: transition running', RED, [], () => X.atemFeedback(g(), 'transition')),
    atem_style_is: bool('ATEM: next transition style is', AMBER, [dd('style', 'Style', X.ATEM_STYLES.map((s) => ({ id: s, label: s })))], (f) => X.atemFeedback(g(), 'style', f.options)),
  });
  const camOpt = dd('cam', 'Camera', X.camChoices(S), { allowCustom: true });
  Object.assign(out, {
    ptz_selected: bool('PTZ: camera is the selected camera', AMBER, [camOpt], (f) => X.ptzFeedback(g(), 'selected', f.options)),
    ptz_tally: bool('PTZ: tally lamp on', RED, [camOpt, dd('color', 'Lamp', [{ id: 'red', label: 'Red' }, { id: 'green', label: 'Green' }])], (f) => X.ptzFeedback(g(), 'tally', f.options)),
    ptz_power_on: bool('PTZ: camera powered on', GREEN, [camOpt], (f) => X.ptzFeedback(g(), 'power', f.options)),
    ptz_online: bool('PTZ: camera online (tick Invert to light an offline camera)', GREEN, [camOpt, { type: 'checkbox', id: 'invert', label: 'Invert (light when offline)', default: false }], (f) => X.ptzFeedback(g(), 'online', f.options) !== !!f.options.invert),
    ptz_moving: bool('PTZ: camera moving (held by a control)', AMBER, [camOpt], (f) => X.ptzFeedback(g(), 'moving', f.options)),
    ptz_last_preset: bool('PTZ: last recalled preset is', GREEN, [camOpt, { type: 'number', id: 'preset', label: 'Preset (1-100)', default: 1, min: 1, max: 100 }], (f) => X.ptzFeedback(g(), 'preset', f.options)),
    ptz_error: bool('PTZ: camera reported an error', { bgcolor: COLORS.yellow, color: COLORS.black }, [camOpt], (f) => X.ptzFeedback(g(), 'error', f.options)),
    ptz_on: bool('PTZ: camera on/off setting is ON (AF, auto iris, bars, OSD menu …)', AMBER, [camOpt, dd('op', 'Setting', X.opChoices(['toggle']))], (f) => X.ptzFeedback(g(), 'on', f.options)),
    ptz_value: bool('PTZ: camera setting equals (gain, ND, WB mode, scene …)', AMBER, [camOpt, dd('op', 'Setting', X.opChoices(['list', 'range'])), { type: 'textinput', id: 'value', label: 'Value (list code or number)', default: '' }], (f) => X.ptzFeedback(g(), 'value', f.options)),
  });
  return out;
}

module.exports = { sysActions, sysFeedbacks };

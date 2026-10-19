'use strict';
// Pure helpers (no Companion imports) so they can be unit tested.
const rgb = (r, g, b) => ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff); // same as base combineRgb
const COLORS = { white: rgb(255, 255, 255), black: rgb(0, 0, 0), red: rgb(200, 0, 0), green: rgb(0, 160, 60), amber: rgb(230, 150, 0), grey: rgb(40, 40, 40), darkred: rgb(70, 0, 0), blue: rgb(30, 90, 200), yellow: rgb(255, 200, 0) };

function findPreset(state, number) { return state && state.presets ? state.presets.find((p) => p.number === Number(number)) : undefined; }

// which: 'pvw' | 'pgm'. includePartial lights the button if any of the preset's destinations carry it.
function presetTally(state, number, which, includePartial = false) {
  const p = findPreset(state, number); if (!p || !p.tally) return false;
  const v = p.tally[which];
  return v === 'full' || (includePartial && v === 'partial');
}

function destSelected(state, key) { return !!(state && Array.isArray(state.selection) && state.selection.includes(String(key).toUpperCase())); }

// ---------- live device state (app >= 0.2.0: state.live) ----------
const live = (state) => (state && state.live) || null;
const liveInputs = (state) => (live(state) && live(state).inputs) || [];
const findInput = (state, n) => liveInputs(state).find((i) => i.number === Number(n));
const findDest = (state, key) => ((state && state.destinations) || []).find((d) => d.key === String(key).toUpperCase());

function inputChoices(state) {
  const ins = liveInputs(state);
  return ins.length ? ins.map((i) => ({ id: i.number, label: `${i.number} ${i.label || 'Input ' + i.number}` })) : [{ id: 1, label: '1' }];
}

// Real input tally from the device (Program/Preview layer + background sources). dest = 'any' or a destination key.
function inputTally(state, n, which, dest = 'any') {
  const t = live(state) && live(state).tally; if (!t || !t.inputs) return false;
  const e = t.inputs[Number(n)] || t.inputs[String(n)]; if (!e) return false;
  const list = which === 'pgm' ? e.program : e.preview;
  if (!list || !list.length) return false;
  return !dest || dest === 'any' ? true : list.includes(String(dest).toUpperCase());
}

// Last Screen memory loaded on a destination side equals id (AWJ §3.11).
function destMemoryIs(state, key, side, id) {
  const d = findDest(state, key); if (!d) return false;
  const m = side === 'pvw' ? d.previewMemory : d.programMemory;
  return !!m && Number(m.id) === Number(id);
}
function masterIs(state, side, id) {
  const m = live(state) && live(state).lastMaster && live(state).lastMaster[side === 'pvw' ? 'preview' : 'program'];
  return !!m && Number(m.id) === Number(id);
}
function inputFrozen(state, n) { const i = findInput(state, n); return !!(i && i.freeze); }
function inputProblem(state, n, what = 'either') {
  const i = findInput(state, n); if (!i) return false;
  const unavailable = i.isAvailable === false; const disabled = i.isEnabled === false;
  return what === 'unavailable' ? unavailable : what === 'disabled' ? disabled : unavailable || disabled;
}
function backupEntry(state, kind, id) {
  const b = live(state) && live(state).backup; if (!b) return null;
  if (kind === 'input') return (b.inputs || []).find((x) => x.number === Number(id)) || null;
  if (kind === 'group') return (b.groups || []).find((x) => x.group === Number(id)) || null;
  const [scr, set] = String(id).split('/');
  return (b.backgrounds || []).find((x) => x.screen === String(scr).toUpperCase() && x.set === Number(set)) || null;
}
// slot 'any' = a backup slot (1 or 2) is selected; otherwise the exact slot is selected.
function backupActive(state, kind, id, slot = 'any') {
  const e = backupEntry(state, kind, id); if (!e) return false;
  return slot === 'any' ? !!e.selected && e.selected !== 'NONE' : String(e.selected) === String(slot);
}
function audioMuted(state, dir, n, ch) {
  const a = live(state) && live(state).audio; if (!a) return false;
  const list = dir === 'outputs' ? a.outputs : a.inputs; const key = dir === 'outputs' ? 'output' : 'input';
  const row = (list || []).find((x) => x[key] === Number(n)); if (!row) return false;
  const c = row.channels.find((x) => x.channel === Number(ch));
  return !!(c && c.mute);
}
const memNum = (m) => (m ? m.id : '');
const memName = (m) => (m ? m.label || '' : '');

function variableDefinitions(state) {
  const defs = [
    { variableId: 'last_preset_number', name: 'Last recalled preset number' },
    { variableId: 'last_preset_name', name: 'Last recalled preset name' },
    { variableId: 'program_presets', name: 'Presets fully on Program (comma list)' },
    { variableId: 'selection', name: 'Selected destinations' },
    { variableId: 'auto_take', name: 'Auto take on recall (ON/OFF)' },
    { variableId: 'device_connected', name: 'App connected to the RS6 (true/false)' },
  ];
  for (const p of (state && state.presets) || []) defs.push({ variableId: `preset_${p.number}_name`, name: `Preset ${p.number} name` });
  defs.push({ variableId: 'live_mode', name: 'Live device state mode (push / poll-awj / poll-rest / off)' });
  for (const side of ['pgm', 'pvw']) {
    defs.push({ variableId: `master_${side}_number`, name: `Last Master memory on ${side.toUpperCase()} (number)` });
    defs.push({ variableId: `master_${side}_name`, name: `Last Master memory on ${side.toUpperCase()} (name)` });
  }
  for (const d of (state && state.destinations) || []) {
    for (const side of ['pgm', 'pvw']) {
      defs.push({ variableId: `${d.key}_${side}_memory_number`, name: `${d.key} last Screen memory on ${side.toUpperCase()} (number)` });
      defs.push({ variableId: `${d.key}_${side}_memory_name`, name: `${d.key} last Screen memory on ${side.toUpperCase()} (name)` });
    }
    defs.push({ variableId: `${d.key}_pgm_layer1`, name: `${d.key} Program layer 1 source (label)` });
  }
  for (const i of liveInputs(state)) defs.push({ variableId: `input_${i.number}_label`, name: `Input ${i.number} label` });
  return defs;
}

function variableValues(state) {
  const v = {
    last_preset_number: state && state.lastRecalled ? state.lastRecalled.number : '',
    last_preset_name: state && state.lastRecalled ? state.lastRecalled.name : '',
    program_presets: state && state.programPresets ? state.programPresets.join(',') : '',
    selection: state && state.selection ? state.selection.join(',') : '',
    auto_take: state && state.autoTake ? 'ON' : 'OFF',
    device_connected: state ? String(!!state.connected) : 'false',
  };
  for (const p of (state && state.presets) || []) v[`preset_${p.number}_name`] = p.name;
  const lv = live(state);
  v.live_mode = lv ? lv.mode || 'off' : 'off';
  const lm = (lv && lv.lastMaster) || {};
  v.master_pgm_number = memNum(lm.program); v.master_pgm_name = memName(lm.program);
  v.master_pvw_number = memNum(lm.preview); v.master_pvw_name = memName(lm.preview);
  for (const d of (state && state.destinations) || []) {
    v[`${d.key}_pgm_memory_number`] = memNum(d.programMemory); v[`${d.key}_pgm_memory_name`] = memName(d.programMemory);
    v[`${d.key}_pvw_memory_number`] = memNum(d.previewMemory); v[`${d.key}_pvw_memory_name`] = memName(d.previewMemory);
    v[`${d.key}_pgm_layer1`] = d.programLayer1 || '';
  }
  for (const i of liveInputs(state)) v[`input_${i.number}_label`] = i.label || '';
  return v;
}

function presetSignature(state) {
  return JSON.stringify({
    p: ((state && state.presets) || []).map((p) => [p.number, p.name]),
    d: ((state && state.destinations) || []).map((d) => [d.key, d.label]),
    i: liveInputs(state).map((i) => [i.number, i.label]),
    a: ((live(state) && live(state).audio) || { inputs: [], outputs: [] }),
    b: ((live(state) && live(state).backup) || { inputs: [], backgrounds: [], groups: [] }).inputs.map((x) => x.number),
  }, (k, val) => (k === 'mute' ? undefined : val)); // structure only, not mute values
}

function buttonPresets(state) {
  const out = {};
  for (const p of (state && state.presets) || []) {
    out[`preset_${p.number}`] = {
      type: 'button', category: 'Presets', name: `${p.number} ${p.name}`,
      style: { text: `${p.number}\\n$(rs6presets:preset_${p.number}_name)`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
      steps: [{ down: [{ actionId: 'recall_preset', options: { preset: p.number } }], up: [] }],
      feedbacks: [
        { feedbackId: 'preset_pvw', options: { preset: p.number, partial: false }, style: { bgcolor: COLORS.green, color: COLORS.white } },
        { feedbackId: 'preset_pgm', options: { preset: p.number, partial: false }, style: { bgcolor: COLORS.red, color: COLORS.white } },
      ],
    };
  }
  for (const d of (state && state.destinations) || []) {
    out[`dest_${d.key}`] = {
      type: 'button', category: 'Destinations', name: `Toggle ${d.key} ${d.label}`,
      style: { text: `${d.key}\\n${d.label}`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
      steps: [{ down: [{ actionId: 'toggle_destination', options: { dest: d.key } }], up: [] }],
      feedbacks: [{ feedbackId: 'dest_selected', options: { dest: d.key }, style: { bgcolor: COLORS.amber, color: COLORS.black } }],
    };
  }
  out.take = { type: 'button', category: 'Transitions', name: 'TAKE', style: { text: 'TAKE', size: '24', color: COLORS.white, bgcolor: COLORS.red }, steps: [{ down: [{ actionId: 'take', options: {} }], up: [] }], feedbacks: [] };
  out.cut = { type: 'button', category: 'Transitions', name: 'CUT', style: { text: 'CUT', size: '24', color: COLORS.white, bgcolor: COLORS.darkred }, steps: [{ down: [{ actionId: 'cut', options: {} }], up: [] }], feedbacks: [] };
  out.auto_take = {
    type: 'button', category: 'Transitions', name: 'Auto take toggle',
    style: { text: 'AUTO\\nTAKE\\n$(rs6presets:auto_take)', size: '14', color: COLORS.white, bgcolor: COLORS.grey },
    steps: [{ down: [{ actionId: 'auto_take', options: { mode: 'toggle' } }], up: [] }],
    feedbacks: [{ feedbackId: 'auto_take_on', options: {}, style: { bgcolor: COLORS.amber, color: COLORS.black } }],
  };
  // ---- live device presets ----
  for (const i of liveInputs(state)) {
    const lbl = `$(rs6presets:input_${i.number}_label)`;
    out[`input_tally_${i.number}`] = {
      type: 'button', category: 'Input tally', name: `Tally IN ${i.number} ${i.label || ''}`,
      style: { text: `IN ${i.number}\\n${lbl}`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
      steps: [{ down: [], up: [] }],
      feedbacks: [
        { feedbackId: 'input_pvw', options: { input: i.number, dest: 'any' }, style: { bgcolor: COLORS.green, color: COLORS.white } },
        { feedbackId: 'input_pgm', options: { input: i.number, dest: 'any' }, style: { bgcolor: COLORS.red, color: COLORS.white } },
        { feedbackId: 'input_problem', options: { input: i.number, what: 'either' }, style: { color: COLORS.yellow } },
      ],
    };
    out[`input_freeze_${i.number}`] = {
      type: 'button', category: 'Input freeze', name: `Freeze IN ${i.number} ${i.label || ''}`,
      style: { text: `FRZ ${i.number}\\n${lbl}`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
      steps: [{ down: [{ actionId: 'input_freeze', options: { input: i.number, mode: 'toggle' } }], up: [] }],
      feedbacks: [{ feedbackId: 'input_frozen', options: { input: i.number }, style: { bgcolor: COLORS.blue, color: COLORS.white } }],
    };
  }
  const bk = (live(state) && live(state).backup) || { inputs: [] };
  for (const b of bk.inputs || []) {
    for (const slot of ['NONE', '1', '2']) {
      out[`input_backup_${b.number}_${slot}`] = {
        type: 'button', category: 'Backups', name: `IN ${b.number} ${slot === 'NONE' ? 'primary' : 'backup ' + slot}`,
        style: { text: `IN ${b.number}\\n${slot === 'NONE' ? 'PRIMARY' : 'BKP ' + slot}`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
        steps: [{ down: [{ actionId: 'backup_trigger', options: { kind: 'input', id: String(b.number), slot } }], up: [] }],
        feedbacks: [{ feedbackId: 'backup_active', options: { kind: 'input', id: String(b.number), slot }, style: { bgcolor: COLORS.amber, color: COLORS.black } }],
      };
    }
  }
  const au = (live(state) && live(state).audio) || { inputs: [], outputs: [] };
  for (const [dir, key, short] of [['inputs', 'input', 'IN'], ['outputs', 'output', 'OUT']]) {
    for (const row of au[dir] || []) {
      for (const c of row.channels) {
        out[`audio_${dir}_${row[key]}_${c.channel}`] = {
          type: 'button', category: `Audio ${dir} mute`, name: `Mute audio ${key} ${row[key]} ch ${c.channel}`,
          style: { text: `${short} ${row[key]}\\nCH ${c.channel}\\nMUTE`, size: 'auto', color: COLORS.white, bgcolor: COLORS.grey },
          steps: [{ down: [{ actionId: 'audio_mute', options: { dir, id: row[key], channel: c.channel, mode: 'toggle' } }], up: [] }],
          feedbacks: [{ feedbackId: 'audio_muted', options: { dir, id: row[key], channel: c.channel }, style: { bgcolor: COLORS.red, color: COLORS.white } }],
        };
      }
    }
  }
  out.master_status = { type: 'button', category: 'Status', name: 'Last Master memory (PGM)', style: { text: 'MASTER\\n$(rs6presets:master_pgm_number)\\n$(rs6presets:master_pgm_name)', size: 'auto', color: COLORS.red, bgcolor: COLORS.black }, steps: [{ down: [], up: [] }], feedbacks: [] };
  out.last = { type: 'button', category: 'Status', name: 'Last recalled preset', style: { text: 'PVW\\n$(rs6presets:last_preset_number)\\n$(rs6presets:last_preset_name)', size: 'auto', color: COLORS.green, bgcolor: COLORS.black }, steps: [{ down: [], up: [] }], feedbacks: [] };
  return out;
}

module.exports = {
  rgb, COLORS, findPreset, presetTally, destSelected, variableDefinitions, variableValues, presetSignature, buttonPresets,
  inputChoices, inputTally, destMemoryIs, masterIs, inputFrozen, inputProblem, backupEntry, backupActive, audioMuted, findInput,
};

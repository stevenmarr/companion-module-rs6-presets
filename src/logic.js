'use strict';
// Pure helpers (no Companion imports) so they can be unit tested.
const rgb = (r, g, b) => ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff); // same as base combineRgb
const COLORS = { white: rgb(255, 255, 255), black: rgb(0, 0, 0), red: rgb(200, 0, 0), green: rgb(0, 160, 60), amber: rgb(230, 150, 0), grey: rgb(40, 40, 40), darkred: rgb(70, 0, 0) };

function findPreset(state, number) { return state && state.presets ? state.presets.find((p) => p.number === Number(number)) : undefined; }

// which: 'pvw' | 'pgm'. includePartial lights the button if any of the preset's destinations carry it.
function presetTally(state, number, which, includePartial = false) {
  const p = findPreset(state, number); if (!p || !p.tally) return false;
  const v = p.tally[which];
  return v === 'full' || (includePartial && v === 'partial');
}

function destSelected(state, key) { return !!(state && Array.isArray(state.selection) && state.selection.includes(String(key).toUpperCase())); }

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
  return v;
}

function presetSignature(state) {
  return JSON.stringify({
    p: ((state && state.presets) || []).map((p) => [p.number, p.name]),
    d: ((state && state.destinations) || []).map((d) => [d.key, d.label]),
  });
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
  out.last = { type: 'button', category: 'Status', name: 'Last recalled preset', style: { text: 'PVW\\n$(rs6presets:last_preset_number)\\n$(rs6presets:last_preset_name)', size: 'auto', color: COLORS.green, bgcolor: COLORS.black }, steps: [{ down: [], up: [] }], feedbacks: [] };
  return out;
}

module.exports = { rgb, COLORS, findPreset, presetTally, destSelected, variableDefinitions, variableValues, presetSignature, buttonPresets };

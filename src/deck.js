'use strict';
// 0.9.0: the Stream Deck as the primary live camera surface (design: research note 10-streamdeck-ptz.md).
// Brand-styled keys for the LIVE / PAINT / FUNCTIONS / MOVE pages the app generates (lib/companion in the app,
// branch ptz-pages), the deck actions (guarded recall, hold-to-repeat, ramped hold, fine / coarse and multi-step R/B dials, cycles)
// and their feedbacks and variables. Everything acts on the SELECTED camera unless a preset names one, and every
// command goes through the app's HTTP API (needs app 0.12.0: features ptzLiveGuard + ptzDeckFunctions).
const X = require('./sys');

// ---------- brand ----------
const BRAND = {
  // Dark theme = Control app tokens. Red = PGM/LIVE only. Feature ON = accent (app .mode.active).
  bg: 0x101012, panel: 0x18181b, panel2: 0x222226, line: 0x34343a,
  text: 0xe6e6e8, dim: 0x9a9aa2, grey: 0x6e6e6e, black: 0x000000,
  red: 0xc42020, pgm: 0xc42020, onPgm: 0xffffff,
  pvw: 0x137a3a, onPvw: 0xffffff,
  armed: 0xe0a000, onArmed: 0x101012,
  focus: 0x7fb2ff, accent: 0x3b8cff, danger: 0xc42020,
  allstopBg: 0x3a0d10, allstopText: 0xffb3b6,
};
const T = (s) => `$(rs6presets:${s})`;
const A = (actionId, options = {}) => ({ actionId, options });

// Long names first, short ones only when the long one does not fit the key at the house size.
// A bold companion-sans glyph is about 0.6 em wide, so at the 21 % name size about 7 characters fit a line.
function fits(text, sizePct, lines = 2) {
  const per = Math.floor(88 / (sizePct * 0.6));
  const words = String(text).split(/\s+/).filter(Boolean); let n = 1; let cur = 0;
  for (const w of words) {
    if (w.length > per) return false;
    if (!cur) cur = w.length; else if (cur + 1 + w.length <= per) cur += 1 + w.length; else { n++; cur = w.length; }
  }
  return n <= lines;
}
const pick = (long, short, size = 21, lines = 2) => (!short || fits(long, size, lines) ? long : short);

// ---------- what the deck controls ----------
// value variables, per camera and for the selected one (ptz_sel_*): [suffix, op]
const VALUE_VARS = [
  ['r_gain', 'rGain'], ['b_gain', 'bGain'], ['r_ped', 'rPed'], ['b_ped', 'bPed'], ['m_ped', 'masterPed'],
  ['detail', 'detail'], ['m_detail', 'masterDetail'], ['gamma_mode', 'gammaMode'], ['gamma', 'gamma'],
  ['knee_mode', 'kneeMode'], ['knee', 'kneePoint'], ['matrix', 'matrixType'], ['chroma', 'chromaLevel'],
  ['shutter_mode', 'shutterMode'], ['drs', 'drs'], ['night', 'dayNight'], ['freeze', 'freezePreset'], ['ois', 'ois'],
  ['bars', 'colorBars'], ['dext', 'dExtender'], ['preset_speed', 'presetSpeed'], ['af', 'focusMode'], ['auto_iris', 'irisMode'],
];
// values that count as "off" for a list function (DRS OFF, D.EXT OFF)
const OFF_VALUES = { drs: ['0'], dExtender: ['0'], ndFilter: ['0'], kneeMode: ['0'], shutterMode: ['0'] };
const PRESET_SPEEDS = ['250', '500', '999']; // SLOW (speed 10) · MID (20) · FAST (30)
const SPEED_NAMES = { 250: 'SLOW 10', 500: 'MID 20', 999: 'FAST 30' };

// Dials (+ / + XL). Labels / formats match Control Center PTZ paint (public/ptz.js SHORT + FMT).
// Unpaired: turn = op by fine/coarse codes; push = FINE <-> COARSE; strip tap = `tap`.
// Paired biases (`axes`): one multi-step dial — push cycles R·FINE → R·COARSE → B·FINE → B·COARSE; strip tap = AWB/ABB.
const DIALS = {
  iris: { op: 'iris', long: 'IRIS', coarse: 5, v: 'iris', mode: 'iris_mode', tap: (cam) => [A('ptz_toggle', { cam, op: 'irisMode', mode: 'toggle' })], tapLabel: 'A/M' },
  mped: { op: 'masterPed', long: 'M.PED', short: 'M.PED', coarse: 5, v: 'm_ped', tap: (cam) => [A('ptz_adjust', { cam, op: 'masterPed', mode: 'centre', value: 0 })], tapLabel: 'RESET' },
  gain_rb: {
    long: 'R B GAIN', short: 'GAIN',
    axes: [
      { op: 'rGain', long: 'R GAIN', short: 'R', v: 'r_gain', coarse: 5 },
      { op: 'bGain', long: 'B GAIN', short: 'B', v: 'b_gain', coarse: 5 },
    ],
    tap: (cam) => [A('ptz_exec', { cam, op: 'awb' })], tapLabel: 'AWB',
  },
  ped_rb: {
    long: 'R B PED', short: 'PED',
    axes: [
      { op: 'rPed', long: 'R PED', short: 'R', v: 'r_ped', coarse: 5 },
      { op: 'bPed', long: 'B PED', short: 'B', v: 'b_ped', coarse: 5 },
    ],
    tap: (cam) => [A('ptz_exec', { cam, op: 'abb' })], tapLabel: 'ABB',
  },
  detail: { op: 'masterDetail', long: 'M.DTL', short: 'M.DTL', coarse: 4, v: 'm_detail', mode: 'detail', tap: (cam) => [A('ptz_toggle', { cam, op: 'detail', mode: 'toggle' })], tapLabel: 'ON/OFF' },
  gamma: { op: 'gamma', long: 'GAMMA', coarse: 5, v: 'gamma', mode: 'gamma_mode', tap: (cam) => [A('deck_cycle', { cam, op: 'gammaMode', values: '' })], tapLabel: 'MODE' },
  chroma: { op: 'chromaLevel', long: 'CHROMA', short: 'CHROMA', coarse: 10, v: 'chroma', tap: (cam) => [A('ptz_adjust', { cam, op: 'chromaLevel', mode: 'centre', value: 0 })], tapLabel: 'RESET' },
  knee: { op: 'kneePoint', long: 'K.POINT', short: 'K.POINT', coarse: 4, v: 'knee', mode: 'knee_mode', tap: (cam) => [A('deck_cycle', { cam, op: 'kneeMode', values: '' })], tapLabel: 'MODE' },
  gain: { op: 'gain', long: 'GAIN', list: true, coarse: 1, v: 'gain', tap: (cam) => [A('ptz_set', { cam, op: 'gain', value: '08' })], tapLabel: '0dB' },
  zoom: { lens: 'zoom', long: 'ZOOM', fineSpeed: 4, coarseSpeed: 14, v: 'zoom', unit: '%', tap: (cam) => [A('ptz_stop', { cam, axes: 'zoom' })], tapLabel: 'STOP' },
  focus: { lens: 'focus', long: 'FOCUS', fineSpeed: 2, coarseSpeed: 8, v: 'focus', mode: 'focus_mode', tap: (cam) => [A('ptz_exec', { cam, op: 'oneTouchAF' })], tapLabel: 'PUSH AF' },
};
const DIAL_IDS = Object.keys(DIALS);

// Paint keys: -/+ pairs (hold to repeat), cycles, toggles and one-shots
const PAINT_PAIRS = {
  iris: ['iris', 'IRIS', null, 'iris'], gain: ['gain', 'GAIN', null, 'gain'], shutter: ['shutter', 'SHUTTER', 'SHUT', 'shutter'],
  rgain: ['rGain', 'R GAIN', null, 'r_gain'], bgain: ['bGain', 'B GAIN', null, 'b_gain'], rped: ['rPed', 'R PED', null, 'r_ped'], bped: ['bPed', 'B PED', null, 'b_ped'],
  mped: ['masterPed', 'M.PED', 'M.PED', 'm_ped'], detail: ['masterDetail', 'M.DTL', 'M.DTL', 'm_detail'], gamma: ['gamma', 'GAMMA', null, 'gamma'],
  knee: ['kneePoint', 'K.POINT', 'K.POINT', 'knee'], chroma: ['chromaLevel', 'CHROMA', 'CHROMA', 'chroma'],
};
const PAINT_CYCLES = {
  nd: ['ndFilter', 'ND FILTER', 'ND', 'nd'], wb: ['wbMode', 'WHITE BAL', 'WB', 'wb'], gamma_mode: ['gammaMode', 'GAMMA MODE', 'GAMMA', 'gamma_mode'],
  knee_mode: ['kneeMode', 'KNEE MODE', 'KNEE', 'knee_mode'], matrix: ['matrixType', 'MATRIX', null, 'matrix'],
};
// function toggles (red when ON): [op, long, short, kind]
const FUNCS = {
  tally: ['tallyRed', 'TALLY', null, 'tally'], power: ['power', 'POWER', 'PWR', 'power'], af: ['focusMode', 'AUTO FOCUS', 'AF', 'toggle'],
  otaf: ['oneTouchAF', 'PUSH AF', null, 'exec'], ois: ['ois', 'STABILIZER', 'OIS', 'toggle'], bars: ['colorBars', 'COLOUR BARS', 'BARS', 'toggle'],
  dext: ['dExtender', 'D.EXTENDER', 'D.EXT', 'cycle'], freeze: ['freezePreset', 'FREEZE ON PRESET', 'FREEZE', 'toggle'],
  pspeed: ['presetSpeed', 'PRESET SPEED', 'P SPEED', 'speed'], autoiris: ['irisMode', 'AUTO IRIS', 'A.IRIS', 'toggle'],
  drs: ['drs', 'DRS', null, 'cycle'], night: ['dayNight', 'NIGHT MODE', 'NIGHT', 'toggle'],
};
const DECK_PRESETS = 18; // the + XL bank; XL uses 16, MK.2 6

// ---------- state helpers ----------
const guardOf = (S) => { const g = (S && S.views && S.views.ptz && S.views.ptz.liveGuard) || null; return { mode: (g && g.mode) || 'hold', holdMs: (g && Number(g.holdMs)) || 600 }; };
const valOf = (c, op) => (c && c.values ? c.values[op] : undefined);
function isActive(S, cats, cam, op) {
  const c = X.camOf(S, cam); if (!c) return false;
  if (op === 'tallyRed') return !!c.tally;
  if (op === 'power') return c.power === 'on';
  const v = valOf(c, op); const o = X.opFor(cats, S, c.id, op);
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'boolean' || (o && o.type === 'toggle')) return v === true || v === 1 || v === '1';
  const off = OFF_VALUES[op] || ['0', 'OFF'];
  return !off.includes(String(v));
}
function recallHint(S, c) {
  if (!c || !c.tally) return '';
  const g = guardOf(S);
  return g.mode === 'lock' ? 'LOCKED' : g.mode === 'hold' ? 'HOLD' : 'LIVE';
}
function deckState(S, c) {
  if (!c) return '';
  if (!c.connected) return 'OFFLINE';
  const sel = X.selectedCam(S) === c.id;
  return c.tally && sel ? 'LIVE · SEL' : c.tally ? 'LIVE' : sel ? 'SELECTED' : '';
}
function speedName(v) { return SPEED_NAMES[String(v)] || (v === undefined || v === '' ? '' : `CODE ${v}`); }

// ---------- variables ----------
function variableDefinitions(S) {
  const d = [];
  if (!X.ptz(S)) return d;
  d.push({ variableId: 'deck_guard', name: 'PTZ deck: live recall guard (OFF / HOLD / LOCK)' }, { variableId: 'deck_guard_ms', name: 'PTZ deck: hold time for a live recall (ms)' },
    { variableId: 'deck_msg', name: 'PTZ deck: last deck message (HOLD TO RECALL, LOCKED …)' });
  for (const k of DIAL_IDS) {
    d.push({ variableId: `deck_${k}_fine`, name: `PTZ deck: ${DIALS[k].long.toLowerCase()} dial FINE / COARSE` });
    if (DIALS[k].axes) {
      d.push({ variableId: `deck_${k}_axis`, name: `PTZ deck: ${DIALS[k].long.toLowerCase()} dial active axis (R / B …)` });
      d.push({ variableId: `deck_${k}_readout`, name: `PTZ deck: ${DIALS[k].long.toLowerCase()} dial both-bias readout (app paint style)` });
    }
  }
  for (const c of [{ id: 'sel', name: 'selected camera' }, ...X.cams(S)]) {
    const p = `ptz_${X.safeId(c.id)}`;
    for (const [k] of VALUE_VARS) d.push({ variableId: `${p}_${k}`, name: `PTZ ${c.name}: ${k.replace(/_/g, ' ')}` });
    d.push({ variableId: `${p}_recall_hint`, name: `PTZ ${c.name}: what a deck recall needs now (HOLD / LOCKED / LIVE / empty)` },
      { variableId: `${p}_deck_state`, name: `PTZ ${c.name}: LIVE / SELECTED / OFFLINE` });
    if (c.id === 'sel') for (let n = 1; n <= DECK_PRESETS; n++) d.push({ variableId: `${p}_preset_${n}_name`, name: `PTZ selected camera: preset ${n} name` });
  }
  return d;
}
function variableValues(S, cats = {}) {
  const v = {};
  if (!X.ptz(S)) return v;
  const g = guardOf(S);
  v.deck_guard = g.mode.toUpperCase(); v.deck_guard_ms = String(g.holdMs);
  const sel = X.camOf(S, 'selected');
  for (const [p, c] of [['ptz_sel', sel], ...X.cams(S).map((x) => [`ptz_${X.safeId(x.id)}`, x])]) {
    for (const [k, op] of VALUE_VARS) {
      const raw = valOf(c, op);
      v[`${p}_${k}`] = op === 'presetSpeed' ? speedName(raw) : X.fmtValue(X.opFor(cats, S, c && c.id, op), raw);
    }
    v[`${p}_recall_hint`] = recallHint(S, c); v[`${p}_deck_state`] = deckState(S, c);
  }
  for (let n = 1; n <= DECK_PRESETS; n++) { const nm = sel ? ((sel.presetNames || {})[n] || (sel.presetNames || {})[String(n)]) : ''; v[`ptz_sel_preset_${n}_name`] = nm || `P${n}`; }
  for (const k of DIAL_IDS) {
    const dl = DIALS[k]; if (!dl.axes) continue;
    const active = 0; // static template; live axis marker is deck_*_axis on the value line
    const parts = dl.axes.map((ax) => {
      const raw = valOf(sel, ax.op);
      const formatted = X.fmtValue(X.opFor(cats, S, sel && sel.id, ax.op), raw);
      return `${ax.short} ${formatted || '-'}`;
    });
    v[`deck_${k}_readout`] = parts.join('  ');
  }
  return v;
}

// ---------- runtime: hold timers, repeats, ramps, fine / coarse ----------
class DeckRuntime {
  constructor(inst) {
    this.inst = inst;
    this.fine = Object.fromEntries(DIAL_IDS.map((k) => [k, true]));
    this.axis = Object.fromEntries(DIAL_IDS.filter((k) => DIALS[k].axes).map((k) => [k, 0]));
    this.arming = new Map(); this.repeats = new Map(); this.ramps = new Map(); this.msgTimer = null;
  }
  get S() { return this.inst.sys; }
  activeAxis(k) { const dl = DIALS[k]; if (!dl || !dl.axes) return null; return dl.axes[this.axis[k] || 0] || dl.axes[0]; }
  vars() {
    const v = {};
    for (const k of DIAL_IDS) {
      v[`deck_${k}_fine`] = this.fine[k] ? 'FINE' : 'COARSE';
      if (DIALS[k].axes) { const ax = this.activeAxis(k); v[`deck_${k}_axis`] = ax ? ax.short : ''; }
    }
    return v;
  }
  say(msg) {
    this.inst.setVariableValues({ deck_msg: msg });
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { this.msgTimer = null; this.inst.setVariableValues({ deck_msg: '' }); }, 2500);
  }
  check(...ids) { try { this.inst.checkFeedbacks(...ids); } catch { /* not running in Companion */ } }
  async send(label, name, body) {
    try { return await this.inst.api.ptz(name, body); } catch (e) { this.inst.log(/locked|hold the preset/i.test(e.message) ? 'warn' : 'error', `PTZ ${label}: ${e.message}`); if (/locked/i.test(e.message)) this.say('LOCKED'); else if (/hold the preset/i.test(e.message)) this.say('HOLD TO RECALL'); return undefined; }
  }

  // guarded recall: DOWN on a live camera in HOLD mode starts the hold timer, UP before it fires cancels
  async recall(camOpt, preset, phase) {
    const S = this.S; const cam = X.camId(S, camOpt); if (!cam) { this.inst.log('warn', 'PTZ: no camera configured in the app'); return undefined; }
    const c = X.camOf(S, cam); const g = guardOf(S); const key = `${cam}|${preset}`; const live = !!(c && c.tally);
    if (phase === 'up') {
      const t = this.arming.get(key);
      if (t) { clearTimeout(t); this.arming.delete(key); this.say('HOLD TO RECALL'); this.check('deck_arming'); }
      return undefined;
    }
    if (!live || g.mode === 'off') return this.send('recall', 'recall', { cam, preset: Number(preset), guarded: true });
    if (g.mode === 'lock') { this.say('LOCKED'); this.inst.log('warn', `PTZ ${cam} is live: recall locked (live guard LOCK)`); return undefined; }
    if (this.arming.has(key)) return undefined;
    this.arming.set(key, setTimeout(() => {
      this.arming.delete(key); this.check('deck_arming');
      this.send('recall', 'recall', { cam, preset: Number(preset), guarded: true, confirmed: true });
    }, g.holdMs));
    this.check('deck_arming');
    return undefined;
  }
  isArming(camOpt, preset) { return this.arming.has(`${X.camId(this.S, camOpt)}|${preset}`); }

  // one step of a value: range +-n codes, list next / previous, or the op's own button (shutter step up / down)
  async step(camOpt, op, dir, n = 1) {
    const S = this.S; const cats = this.inst.ptzCats; const cam = X.camId(S, camOpt); if (!cam) return undefined;
    if (op === 'shutter') return this.send('shutter', 'op', { cam, op: dir < 0 ? 'shutterStepDown' : 'shutterStepUp' });
    const o = X.opFor(cats, S, cam, op); const c = X.camOf(S, cam); const cur = valOf(c, op);
    const v = o && o.type === 'list' ? X.stepList(o, cur, dir) : X.stepRange(o, cur, dir * n);
    if (v === undefined) { this.inst.log('warn', `PTZ ${op}: no values known for this camera`); return undefined; }
    this.inst.optimistic(cam, op, v);
    this.inst.setVariableValues(variableValues(S, cats));
    return this.send(op, 'op', { cam, op, value: v });
  }
  // hold to repeat: the first step at once, then every `every` ms after `delay` ms, until UP (or 15 s)
  async repeat(camOpt, op, dir, phase, n = 1, delay = 400, every = 150) {
    const key = `${camOpt}|${op}|${dir}`; const old = this.repeats.get(key);
    if (old) { clearTimeout(old.t); clearInterval(old.i); this.repeats.delete(key); }
    if (phase === 'up') return undefined;
    const r = { t: null, i: null, since: Date.now() };
    r.t = setTimeout(() => { r.i = setInterval(() => { if (Date.now() - r.since > 15000) { clearInterval(r.i); this.repeats.delete(key); return; } this.step(camOpt, op, dir, n); }, every); }, delay);
    this.repeats.set(key, r);
    return this.step(camOpt, op, dir, n);
  }
  // next value of a list op (wraps), or flip a toggle. `values` limits the cycle (comma list of codes)
  async cycle(camOpt, op, values) {
    const S = this.S; const cats = this.inst.ptzCats; const cam = X.camId(S, camOpt); if (!cam) return undefined;
    const c = X.camOf(S, cam); const o = X.opFor(cats, S, cam, op); const cur = valOf(c, op);
    let v;
    if (op === 'tallyRed') return this.send('tally', 'tally', { cam, color: 'red', on: !(c && c.tally) });
    if (op === 'power') return this.send('power', 'power', { cam, on: !(c && c.power === 'on') });
    if (o && o.type === 'toggle') v = !(cur === true);
    else {
      const list = String(values || '').split(',').map((x) => x.trim()).filter(Boolean);
      const codes = list.length ? list : ((o && o.options) || []).map((x) => String(x[0]));
      if (!codes.length) { this.inst.log('warn', `PTZ ${op}: no values known for this camera`); return undefined; }
      const i = codes.indexOf(String(cur)); v = codes[(i + 1) % codes.length];
    }
    this.inst.optimistic(cam, op, v);
    this.inst.setVariableValues(variableValues(S, cats));
    this.check('ptz_active');
    return this.send(op, 'op', { cam, op, value: v });
  }
  async dial(camOpt, k, d) {
    const dl = DIALS[k]; if (!dl || !d) return undefined;
    const fine = this.fine[k] !== false;
    if (dl.lens) {
      const speed = X.clampSpeed(Math.abs(d) * (fine ? dl.fineSpeed : dl.coarseSpeed));
      return this.inst.ptzPulse(dl.lens, camOpt, (cam) => this.inst.api.ptz(dl.lens, { cam, dir: Math.sign(d) * speed, speed: true }), 250);
    }
    if (dl.axes) {
      const ax = this.activeAxis(k); if (!ax) return undefined;
      return this.step(camOpt, ax.op, Math.sign(d), Math.abs(d) * (fine ? 1 : ax.coarse));
    }
    if (dl.list) return this.step(camOpt, dl.op, Math.sign(d), 1);
    return this.step(camOpt, dl.op, Math.sign(d), Math.abs(d) * (fine ? 1 : dl.coarse));
  }
  // unpaired: toggle / set FINE|COARSE. paired multi-step: advance R·FINE → R·COARSE → B·FINE → B·COARSE (or set).
  setFine(k, mode) {
    const ks = k === 'all' ? DIAL_IDS : [k];
    for (const x of ks) {
      const dl = DIALS[x]; if (!dl) continue;
      if (dl.axes && (mode === 'toggle' || mode === 'next')) {
        const n = dl.axes.length * 2;
        let i = (this.axis[x] || 0) * 2 + (this.fine[x] !== false ? 0 : 1);
        i = (i + 1) % n;
        this.axis[x] = Math.floor(i / 2);
        this.fine[x] = (i % 2) === 0;
      } else if (dl.axes && (mode === 'r' || mode === 'b' || mode === '0' || mode === '1')) {
        this.axis[x] = (mode === 'b' || mode === '1') ? 1 : 0;
      } else {
        this.fine[x] = mode === 'fine' ? true : mode === 'coarse' ? false : !this.fine[x];
      }
    }
    this.inst.setVariableValues(this.vars()); this.check('deck_fine');
  }
  // speed-ramped hold: 25 % of the session speed at once, 100 % after 1.5 s; a tap is a creep
  async ramp(camOpt, axis, dir, phase) {
    const S = this.S; const cam = X.camId(S, camOpt); if (!cam) return undefined;
    const key = `${cam}|${axis}`; const old = this.ramps.get(key);
    if (old) { clearInterval(old); this.ramps.delete(key); }
    if (phase === 'up') return this.inst.ptzRelease(cam, axis);
    const speeds = (X.ptz(S) && X.ptz(S).speeds) || {}; const top = X.clampSpeed(speeds[axis] || 25); const t0 = Date.now();
    const at = () => X.clampSpeed(top * Math.min(1, 0.25 + 0.75 * ((Date.now() - t0) / 1500)));
    const send = (id) => (axis === 'pt' ? this.inst.api.ptz('move', X.moveBody(id, dir, at())) : this.inst.api.ptz(axis, X.lensBody(id, dir, at())));
    await this.inst.ptzHold(axis, cam, send);
    const i = setInterval(() => { if (Date.now() - t0 > 1600) { clearInterval(i); this.ramps.delete(key); } send(cam).catch(() => {}); }, 250);
    this.ramps.set(key, i);
    return undefined;
  }
  async guard(mode) { const r = await this.send('guard', 'guard', { mode }); if (r && r.liveGuard && this.S && this.S.views && this.S.views.ptz) { this.S.views.ptz.liveGuard = r.liveGuard; this.inst.setVariableValues(variableValues(this.S, this.inst.ptzCats)); this.check('deck_guard_is', 'deck_live_guarded'); } return r; }
  async selectNext(dir) {
    const list = X.cams(this.S); if (!list.length) return undefined;
    const i = list.findIndex((c) => c.id === X.selectedCam(this.S));
    const n = list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length];
    return this.send('select', 'select', { cam: n.id });
  }
  stopAll() {
    for (const t of this.arming.values()) clearTimeout(t); this.arming.clear();
    for (const r of this.repeats.values()) { clearTimeout(r.t); clearInterval(r.i); } this.repeats.clear();
    for (const i of this.ramps.values()) clearInterval(i); this.ramps.clear();
    if (this.msgTimer) clearTimeout(this.msgTimer);
  }
}

// ---------- actions / feedbacks ----------
function deckActions(inst) {
  const S = inst.sys; const D = inst.deck;
  const dd = (id, label, choices, extra = {}) => ({ type: 'dropdown', id, label, default: choices[0] && choices[0].id, choices, ...extra });
  const camOpt = dd('cam', 'Camera', X.camChoices(S), { allowCustom: true, regex: '/^[\\w-]+$/' });
  const phase = dd('phase', 'Key', [{ id: 'down', label: 'Pressed (put on DOWN)' }, { id: 'up', label: 'Released (put on UP)' }]);
  const dir = dd('dir', 'Direction', [{ id: 'up', label: 'Up / + / next' }, { id: 'down', label: 'Down / − / previous' }]);
  const ops = X.opChoices(['range', 'list']).concat([{ id: 'shutter', label: 'Shutter step (UE150 step up / down)' }]);
  const turn = async (a, ctx) => { let v = a.options.delta; if (ctx && typeof ctx.parseVariablesInString === 'function' && /\$\(/.test(String(v))) v = await ctx.parseVariablesInString(String(v)); return X.deltaOf(v, a.options.fallback); };
  return {
    deck_recall: {
      name: 'PTZ deck: recall preset, guarded on a live camera (DOWN and UP; hold in HOLD mode, refused in LOCK)',
      options: [camOpt, { type: 'number', id: 'preset', label: 'Preset (1-100)', default: 1, min: 1, max: 100 }, phase],
      callback: (a) => D.recall(a.options.cam, a.options.preset, a.options.phase),
    },
    deck_repeat: {
      name: 'PTZ deck: value up / down, repeats while held (DOWN and UP)',
      options: [camOpt, dd('op', 'Value', ops), dir, phase, { type: 'number', id: 'steps', label: 'Codes per step (levels)', default: 1, min: 1, max: 100 }],
      callback: (a) => D.repeat(a.options.cam, a.options.op, a.options.dir === 'down' ? -1 : 1, a.options.phase, Number(a.options.steps) || 1),
    },
    deck_cycle: {
      name: 'PTZ deck: next value of a setting (WB mode, ND, DRS, D.EXT, gamma mode …), or flip an on/off one',
      options: [camOpt, dd('op', 'Setting', X.opChoices(['list', 'toggle']).concat([{ id: 'tallyRed', label: 'Red tally' }, { id: 'power', label: 'Power' }])), { type: 'textinput', id: 'values', label: 'Only these codes, in order (comma list; empty = all)', default: '' }],
      callback: (a) => D.cycle(a.options.cam, a.options.op, a.options.values),
    },
    deck_dial: {
      name: 'PTZ deck: dial turn (fine / coarse; Stream Deck + / + XL)',
      options: [camOpt, dd('dial', 'Dial', DIAL_IDS.map((k) => ({ id: k, label: DIALS[k].long }))), { type: 'textinput', id: 'delta', label: 'Detents (signed; the fork\'s $(this:delta))', default: '$(this:delta)', useVariables: true }, { type: 'number', id: 'fallback', label: 'When the detents are empty', default: 1, min: -10, max: 10 }],
      callback: async (a, ctx) => D.dial(a.options.cam, a.options.dial, await turn(a, ctx)),
    },
    deck_fine: {
      name: 'PTZ deck: dial fine / coarse, or next multi-step on a paired bias dial (R/B gain, R/B ped)',
      options: [dd('dial', 'Dial', [{ id: 'all', label: 'Every dial' }, ...DIAL_IDS.map((k) => ({ id: k, label: DIALS[k].long }))]), dd('mode', 'Mode', [{ id: 'toggle', label: 'Toggle / next multi-step' }, { id: 'fine', label: 'Fine' }, { id: 'coarse', label: 'Coarse' }, { id: 'r', label: 'Axis R (paired dials)' }, { id: 'b', label: 'Axis B (paired dials)' }])],
      callback: (a) => D.setFine(a.options.dial, a.options.mode),
    },
    deck_ramp: {
      name: 'PTZ deck: pan / tilt, zoom or focus while held, speed ramps up (DOWN and UP)',
      options: [camOpt, dd('axis', 'Axis', [{ id: 'pt', label: 'Pan / tilt' }, { id: 'zoom', label: 'Zoom' }, { id: 'focus', label: 'Focus' }]),
        dd('dir', 'Direction', [...X.DIR_CHOICES, { id: 'tele', label: 'Zoom tele' }, { id: 'wide', label: 'Zoom wide' }, { id: 'far', label: 'Focus far' }, { id: 'near', label: 'Focus near' }]), phase],
      callback: (a) => D.ramp(a.options.cam, a.options.axis, a.options.dir, a.options.phase),
    },
    deck_guard: {
      name: 'PTZ deck: live recall guard (the app setting, shared by every deck)',
      options: [dd('mode', 'Mode', [{ id: 'cycle', label: 'Cycle OFF → HOLD → LOCK' }, { id: 'off', label: 'OFF' }, { id: 'hold', label: 'HOLD' }, { id: 'lock', label: 'LOCK' }])],
      callback: (a) => D.guard(a.options.mode),
    },
    deck_select_next: { name: 'PTZ deck: select the next / previous camera', options: [dd('dir', 'Direction', [{ id: 'next', label: 'Next' }, { id: 'prev', label: 'Previous' }])], callback: (a) => D.selectNext(a.options.dir === 'prev' ? -1 : 1) },
  };
}
function deckFeedbacks(inst) {
  const g = () => inst.sys; const S = g();
  const dd = (id, label, choices, extra = {}) => ({ type: 'dropdown', id, label, default: choices[0] && choices[0].id, choices, ...extra });
  const camOpt = dd('cam', 'Camera', X.camChoices(S), { allowCustom: true });
  // Feature ON: app .mode.active accent fill (graphics brandOverrides.featureOn) — never PGM red.
  const FEATURE_ON = { featureOn: true, color: BRAND.text };
  const PGM = { bgcolor: BRAND.pgm, color: BRAND.onPgm };
  const ARMED = { bgcolor: BRAND.armed, color: BRAND.onArmed };
  const bool = (name, defaultStyle, options, callback) => ({ type: 'boolean', name, defaultStyle, options, callback });
  return {
    ptz_active: bool('PTZ deck: function is ON (on/off setting on, or a list setting not OFF: DRS, D.EXT …)', FEATURE_ON,
      [camOpt, dd('op', 'Setting', X.opChoices(['toggle', 'list']).concat([{ id: 'tallyRed', label: 'Red tally' }, { id: 'power', label: 'Power' }]))], (f) => isActive(g(), inst.ptzCats, f.options.cam, f.options.op)),
    deck_live_guarded: bool('PTZ deck: camera is live and the recall guard is on', { frame: BRAND.armed }, [camOpt], (f) => { const c = X.camOf(g(), f.options.cam); return !!(c && c.tally) && guardOf(g()).mode !== 'off'; }),
    deck_arming: bool('PTZ deck: this preset key is being held to recall', ARMED, [camOpt, { type: 'number', id: 'preset', label: 'Preset', default: 1, min: 1, max: 100 }], (f) => inst.deck.isArming(f.options.cam, f.options.preset)),
    deck_guard_is: bool('PTZ deck: live recall guard is', FEATURE_ON, [dd('mode', 'Mode', [{ id: 'hold', label: 'HOLD' }, { id: 'lock', label: 'LOCK' }, { id: 'off', label: 'OFF' }, { id: 'on', label: 'HOLD or LOCK' }])], (f) => { const m = guardOf(g()).mode; return f.options.mode === 'on' ? m !== 'off' : m === f.options.mode; }),
    deck_fine: bool('PTZ deck: dial is in COARSE', { color: BRAND.focus }, [dd('dial', 'Dial', DIAL_IDS.map((k) => ({ id: k, label: DIALS[k].long })))], (f) => inst.deck.fine[f.options.dial] === false),
  };
}

// ---------- presets (brand) ----------
// classic.brand drives graphics.js (brandLayered): kind, cap, main, value; feedback styles may carry frame / strike
const SEL_FRAME = { frame: 0xffffff }; // thick white selected ring
const OFFLINE = { color: BRAND.grey, strike: true };
const PGM_FILL = { bgcolor: BRAND.pgm, color: BRAND.onPgm };
const FEATURE_ON = { featureOn: true, color: BRAND.text };
const ARMED_FILL = { bgcolor: BRAND.armed, color: BRAND.onArmed };
function key(category, name, brand, down, up = [], feedbacks = [], extra = {}) {
  const text = [brand.cap, brand.main, brand.value].filter((x) => x !== undefined && x !== null && x !== '').join('\\n');
  return { type: 'button', category, name, brand, style: { text, size: 'auto', color: BRAND.text, bgcolor: BRAND.bg }, steps: [{ down, up }], feedbacks, ...extra };
}
const fb = (feedbackId, options, style) => ({ feedbackId, options, style });
const camFbs = (cam) => [fb('ptz_tally', { cam, color: 'red' }, PGM_FILL), fb('ptz_selected', { cam }, SEL_FRAME), fb('ptz_online', { cam, invert: true }, OFFLINE)];

function presets(S) {
  const out = {}; if (!X.ptz(S)) return out;
  const sel = 'selected'; const P = 'ptz_sel';
  // Systems HOME: M4 Viewport mark (flat --text) on panel2. App page sets wire the press to systems home.
  out.deck_nav_home = key('PTZ deck: nav', 'HOME — systems / surface home (M4 Viewport)', { kind: 'home', main: 'HOME' }, []);
  // camera select row
  X.cams(S).forEach((c, i) => {
    const id = X.safeId(c.id); const p = `ptz_${id}`;
    out[`deck_cam_${id}`] = key('PTZ deck: cameras', `Select ${c.name} (red = live, white frame = selected)`,
      { kind: 'cam', cap: `CAM ${i + 1}`, main: T(`${p}_name`), value: T(`${p}_deck_state`) }, [A('ptz_select_camera', { cam: c.id })], [], camFbs(c.id));
    for (let n = 1; n <= DECK_PRESETS; n++) {
      out[`deck_${id}_preset_${n}`] = key(`PTZ deck: ${c.name} presets`, `${c.name} preset ${n} (guarded)`,
        { kind: 'preset', cap: `${c.name.length <= 8 ? c.name.toUpperCase() : `CAM ${i + 1}`} · ${n}`, main: T(`${p}_preset_${n}_name`), value: T(`${p}_recall_hint`) },
        [A('deck_recall', { cam: c.id, preset: n, phase: 'down' })], [A('deck_recall', { cam: c.id, preset: n, phase: 'up' })],
        [fb('deck_live_guarded', { cam: c.id }, { frame: BRAND.armed }), fb('ptz_last_preset', { cam: c.id, preset: n }, SEL_FRAME), fb('deck_arming', { cam: c.id, preset: n }, ARMED_FILL)], { role: 'source' });
    }
  });
  out.deck_cam_next = key('PTZ deck: cameras', 'Next camera', { kind: 'nav', cap: 'CAMERA', main: 'NEXT ▸', value: T('ptz_selected_name') }, [A('deck_select_next', { dir: 'next' })]);
  out.deck_cam_prev = key('PTZ deck: cameras', 'Previous camera', { kind: 'nav', cap: 'CAMERA', main: '◂ PREV', value: T('ptz_selected_name') }, [A('deck_select_next', { dir: 'prev' })]);
  out.deck_sel_readout = key('PTZ deck: cameras', 'Selected camera readout', { kind: 'lcd', cap: 'SELECTED', main: T('ptz_selected_name'), value: `P ${T(`${P}_last_preset`)}` }, [], [], camFbs(sel));
  // selected-camera presets (LIVE grid)
  for (let n = 1; n <= DECK_PRESETS; n++) {
    out[`deck_sel_preset_${n}`] = key('PTZ deck: selected camera presets', `Selected camera preset ${n} (guarded)`,
      { kind: 'preset', cap: `PRESET ${n}`, main: T(`${P}_preset_${n}_name`), value: T(`${P}_recall_hint`) },
      [A('deck_recall', { cam: sel, preset: n, phase: 'down' })], [A('deck_recall', { cam: sel, preset: n, phase: 'up' })],
      [fb('deck_live_guarded', { cam: sel }, { frame: BRAND.armed }), fb('ptz_last_preset', { cam: sel, preset: n }, SEL_FRAME), fb('deck_arming', { cam: sel, preset: n }, ARMED_FILL)], { role: 'source' });
  }
  // paint: -/+ pairs
  for (const [k, [op, long, short, v]] of Object.entries(PAINT_PAIRS)) {
    const cap = pick(long, short, 15, 1);
    for (const [d, glyph] of [['down', '−'], ['up', '+']]) {
      out[`deck_${k}_${d}`] = key('PTZ deck: paint', `${long.toLowerCase()} ${d === 'up' ? '+' : '−'} (selected camera, repeats while held)`,
        { kind: 'step', cap, main: glyph, value: T(`${P}_${v}`) }, [A('deck_repeat', { cam: sel, op, dir: d, phase: 'down', steps: 1 })], [A('deck_repeat', { cam: sel, op, dir: d, phase: 'up', steps: 1 })], [], { role: 'step' });
    }
  }
  for (const [k, [op, long, short, v]] of Object.entries(PAINT_CYCLES)) {
    out[`deck_${k}`] = key('PTZ deck: paint', `${long.toLowerCase()}: next (selected camera)`, { kind: 'value', cap: pick(long, short, 15, 1), main: T(`${P}_${v}`) }, [A('deck_cycle', { cam: sel, op, values: '' })]);
  }
  out.deck_iris_auto = key('PTZ deck: paint', 'Auto iris on/off (selected camera)', { kind: 'value', cap: 'IRIS', main: T(`${P}_iris_mode`) }, [A('ptz_toggle', { cam: sel, op: 'irisMode', mode: 'toggle' })], [], [fb('ptz_active', { cam: sel, op: 'irisMode' }, FEATURE_ON)]);
  out.deck_detail_on = key('PTZ deck: paint', 'Detail on/off (selected camera)', { kind: 'value', cap: 'DETAIL', main: T(`${P}_detail`) }, [A('ptz_toggle', { cam: sel, op: 'detail', mode: 'toggle' })], [], [fb('ptz_active', { cam: sel, op: 'detail' }, FEATURE_ON)]);
  out.deck_awb = key('PTZ deck: paint', 'AWB execute (selected camera)', { kind: 'exec', cap: 'WHITE BAL', main: 'AWB', value: T(`${P}_wb`) }, [A('ptz_exec', { cam: sel, op: 'awb' })]);
  out.deck_abb = key('PTZ deck: paint', 'ABB execute (selected camera)', { kind: 'exec', cap: 'BLACK BAL', main: 'ABB' }, [A('ptz_exec', { cam: sel, op: 'abb' })]);
  // functions
  for (const [k, [op, long, short, kind]] of Object.entries(FUNCS)) {
    const cap = pick(long, short, 15, 1); const v = { tallyRed: 'tally', power: 'power', focusMode: 'focus_mode', irisMode: 'iris_mode', ois: 'ois', colorBars: 'bars', dExtender: 'dext', freezePreset: 'freeze', presetSpeed: 'preset_speed', drs: 'drs', dayNight: 'night' }[op];
    const down = kind === 'exec' ? [A('ptz_exec', { cam: sel, op })] : kind === 'speed' ? [A('deck_cycle', { cam: sel, op, values: PRESET_SPEEDS.join(',') })] : [A('deck_cycle', { cam: sel, op, values: '' })];
    const fbs = kind === 'exec' || kind === 'speed' ? [] : [fb('ptz_active', { cam: sel, op }, FEATURE_ON)];
    out[`deck_fn_${k}`] = key('PTZ deck: functions', `${long.toLowerCase()} (selected camera${kind === 'exec' ? '' : ', ON = outline + tag'})`,
      kind === 'exec' ? { kind: 'exec', cap: 'FOCUS', main: 'PUSH AF' } : { kind: 'value', cap, main: T(`${P}_${v}`) }, down, [], fbs);
  }
  out.deck_guard = key('PTZ deck: functions', 'Live recall guard: OFF → HOLD → LOCK (app setting, every deck)', { kind: 'value', cap: 'LIVE GUARD', main: T('deck_guard') }, [A('deck_guard', { mode: 'cycle' })], [],
    [fb('deck_guard_is', { mode: 'on' }, FEATURE_ON)]);
  out.deck_msg = key('PTZ deck: functions', 'Deck message (HOLD TO RECALL, LOCKED …)', { kind: 'lcd', cap: 'DECK', main: T('deck_msg') }, []);
  // move: ramped holds, home, all stop
  for (const [d, g] of Object.entries({ up: '▲', down: '▼', left: '◀', right: '▶', upLeft: '◤', upRight: '◥', downLeft: '◣', downRight: '◢' })) {
    out[`deck_move_${d}`] = key('PTZ deck: move', `Pan/tilt ${d} while held (ramps 25 → 100 %)`, { kind: 'move', main: g, value: T('ptz_selected_name') },
      [A('deck_ramp', { cam: sel, axis: 'pt', dir: d, phase: 'down' })], [A('deck_ramp', { cam: sel, axis: 'pt', dir: d, phase: 'up' })], [fb('ptz_moving', { cam: sel }, SEL_FRAME)], { role: 'motion' });
  }
  for (const [d, cap, main, axis] of [['tele', 'ZOOM', 'TELE', 'zoom'], ['wide', 'ZOOM', 'WIDE', 'zoom'], ['far', 'FOCUS', 'FAR', 'focus'], ['near', 'FOCUS', 'NEAR', 'focus']]) {
    out[`deck_${d}`] = key('PTZ deck: move', `${cap.toLowerCase()} ${d} while held (ramps)`, { kind: 'move', cap, main, value: T(`${P}_${axis}`) }, [A('deck_ramp', { cam: sel, axis, dir: d, phase: 'down' })], [A('deck_ramp', { cam: sel, axis, dir: d, phase: 'up' })], [], { role: 'motion' });
  }
  out.deck_home = key('PTZ deck: move', 'Camera home (selected camera)', { kind: 'exec', cap: 'CAMERA', main: 'HOME' }, [A('ptz_exec', { cam: sel, op: 'home' })]);
  out.deck_stop_all = key('PTZ deck: move', 'ALL STOP (every camera) — hold; .rcp-allstop fill, not PGM', { kind: 'take', main: 'ALL STOP', danger: true }, [A('ptz_stop_all')]);
  // dials and their strip cells (paired bias dials show the active axis label + value)
  for (const k of DIAL_IDS) {
    const dl = DIALS[k];
    let cap; let val; let pushHint;
    if (dl.axes) {
      // Same idea as the app paint GAIN / PED row: both biases in one readout var; active axis in the step line.
      cap = pick(dl.long, dl.short, 16, 1);
      val = T(`deck_${k}_readout`);
      pushHint = 'push: next R/B · FINE/COARSE step';
    } else {
      val = dl.mode ? `${T(`${P}_${dl.mode}`)} ${T(`${P}_${dl.v}`)}` : `${T(`${P}_${dl.v}`)}${dl.unit || ''}`;
      cap = pick(dl.long, dl.short, 16, 1);
      pushHint = 'push: fine / coarse';
    }
    const stepLine = dl.axes ? `${T(`deck_${k}_axis`)} ${T(`deck_${k}_fine`)}` : T(`deck_${k}_fine`);
    out[`deck_dial_${k}`] = {
      ...key('PTZ deck: dials (Stream Deck + / + XL)', `${dl.long.toLowerCase()} dial (${pushHint})`, { kind: 'lcd', cap, main: val, value: stepLine }, [A('deck_fine', { dial: k, mode: 'toggle' })], [], [fb('deck_fine', { dial: k }, { color: BRAND.focus })]),
      options: { rotaryActions: true },
    };
    out[`deck_dial_${k}`].steps[0].rotate_left = [A('deck_dial', { cam: sel, dial: k, delta: '$(this:delta)', fallback: -1 })];
    out[`deck_dial_${k}`].steps[0].rotate_right = [A('deck_dial', { cam: sel, dial: k, delta: '$(this:delta)', fallback: 1 })];
    out[`deck_strip_${k}`] = key('PTZ deck: dials (Stream Deck + / + XL)', `${dl.long.toLowerCase()} strip (tap: ${dl.tapLabel.toLowerCase()})`, { kind: 'lcd', cap, main: val, value: `${stepLine} · ${dl.tapLabel}` }, dl.tap(sel), [], [fb('deck_fine', { dial: k }, { color: BRAND.focus })]);
  }
  return out;
}

module.exports = {
  BRAND, DIALS, DIAL_IDS, PAINT_PAIRS, PAINT_CYCLES, FUNCS, VALUE_VARS, DECK_PRESETS, PRESET_SPEEDS,
  fits, pick, isActive, guardOf, recallHint, deckState, variableDefinitions, variableValues, DeckRuntime, deckActions, deckFeedbacks, presets,
};

'use strict';
const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require('@companion-module/base');
const { AppApi } = require('./api');
const L = require('./logic');
const UpgradeScripts = require('./upgrades');

const FEEDBACK_IDS = ['preset_pvw', 'preset_pgm', 'dest_selected', 'auto_take_on', 'device_connected', 'input_pgm', 'input_pvw', 'dest_memory', 'master_memory', 'input_frozen', 'input_problem', 'backup_active', 'audio_muted'];
const TRI = { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] };
const SIDE_TARGET = { type: 'dropdown', id: 'target', label: 'To', default: 'preview', choices: [{ id: 'preview', label: 'Preview' }, { id: 'program', label: 'Program (no transition)' }] };
const tri = (m) => (m === 'toggle' || m === undefined ? undefined : m === 'on');
const BACKUP_TARGET = [
  { type: 'dropdown', id: 'kind', label: 'Backup of', default: 'input', choices: [{ id: 'input', label: 'Input' }, { id: 'bg', label: 'Background set' }, { id: 'group', label: 'Backup group' }] },
  { type: 'textinput', id: 'id', label: 'Input number / screen+set as S1/2 / group number', default: '1' },
];
const AUDIO_TARGET = [
  { type: 'dropdown', id: 'dir', label: 'Direction', default: 'inputs', choices: [{ id: 'inputs', label: 'Audio input (rx)' }, { id: 'outputs', label: 'Audio output (tx)' }] },
  { type: 'number', id: 'id', label: 'Input / output number', default: 1, min: 1, max: 256 },
  { type: 'number', id: 'channel', label: 'Channel', default: 1, min: 1, max: 64 },
];

class RS6PresetsInstance extends InstanceBase {
  async init(config) {
    this.config = config; this.state = null; this.sig = null; this.failures = 0;
    this.setActionDefinitions(this.actions());
    this.setFeedbackDefinitions(this.feedbacks());
    this.applyState(null, true);
    this.start();
  }

  async destroy() { this.stop(); }

  async configUpdated(config) { this.config = config; this.stop(); this.sig = null; this.start(); }

  getConfigFields() {
    return [
      { type: 'static-text', id: 'info', width: 12, label: 'About', value: 'Connects to the RS6 Presets app (not to the Aquilon itself). Enter the Mac running the app and its port (default 8080).' },
      { type: 'textinput', id: 'host', label: 'App host / IP', width: 8, default: '127.0.0.1', regex: Regex.HOSTNAME },
      { type: 'number', id: 'port', label: 'App port', width: 4, default: 8080, min: 1, max: 65535 },
      { type: 'dropdown', id: 'updates', label: 'Updates', width: 8, default: 'longpoll', choices: [{ id: 'longpoll', label: 'Long-poll (instant, app 0.2.0+; falls back to polling)' }, { id: 'poll', label: 'Poll only' }] },
      { type: 'number', id: 'poll', label: 'Poll interval (ms)', width: 4, default: 300, min: 100, max: 5000 },
    ];
  }

  // ---------- updates: long-poll on /api/state?since=rev, with plain polling as fallback ----------
  start() {
    const host = (this.config.host || '').trim();
    if (!host) { this.updateStatus(InstanceStatus.BadConfig, 'Set the app host'); return; }
    this.api = new AppApi(host, this.config.port || 8080);
    this.updateStatus(InstanceStatus.Connecting);
    this.running = true; this.ctrl = new AbortController();
    this.longPoll = this.config.updates !== 'poll';
    this.loop(this.ctrl.signal);
  }

  stop() { this.running = false; if (this.ctrl) this.ctrl.abort(); this.ctrl = null; }

  sleep(ms, signal) { return new Promise((r) => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); }); }

  async loop(signal) {
    const pollMs = Math.max(100, Number(this.config.poll) || 300);
    while (this.running && !signal.aborted) {
      const useLong = this.longPoll && this.state && typeof this.state.rev === 'number';
      try {
        const st = useLong ? await this.api.stateSince(this.state.rev, 20000, signal) : await this.api.state({ signal });
        if (signal.aborted) break;
        this.failures = 0;
        if (this.longPoll && typeof st.rev !== 'number' && !this.warnedNoRev) { this.warnedNoRev = true; this.log('info', 'App has no long-poll support (pre-0.2.0); polling instead'); }
        this.applyState(st);
        if (st.connected) this.updateStatus(InstanceStatus.Ok);
        else this.updateStatus(InstanceStatus.UnknownWarning, 'App reachable, but it is not connected to the RS6');
        if (!(this.longPoll && typeof st.rev === 'number')) await this.sleep(pollMs, signal);
      } catch (e) {
        if (signal.aborted) break;
        if (++this.failures === 1) this.log('warn', `RS6 Presets app unreachable: ${e.message}`);
        this.updateStatus(InstanceStatus.ConnectionFailure, e.message);
        if (this.state) this.applyState(null);
        await this.sleep(pollMs, signal);
      }
    }
  }

  applyState(st, force = false) {
    this.state = st;
    const sig = L.presetSignature(st);
    if (force || sig !== this.sig) {
      this.sig = sig;
      this.setVariableDefinitions(L.variableDefinitions(st));
      this.setPresetDefinitions(L.buttonPresets(st));
      this.setActionDefinitions(this.actions()); // refresh destination dropdowns
      this.setFeedbackDefinitions(this.feedbacks());
    }
    this.setVariableValues(L.variableValues(st));
    this.checkFeedbacks(...FEEDBACK_IDS);
  }

  async run(label, fn) {
    if (!this.api) return;
    try { await fn(); }
    catch (e) { this.log('error', `${label} failed: ${e.message}`); }
    try { this.applyState(await this.api.state()); } catch { /* next update will retry */ }
  }

  inputChoices() { return L.inputChoices(this.state); }
  destChoicesAny() { return [{ id: 'any', label: 'Any destination' }, ...this.destChoices()]; }
  inputOpt() { const c = this.inputChoices(); return { type: 'dropdown', id: 'input', label: 'Input', default: c[0].id, choices: c, allowCustom: true, regex: '/^\\d+$/' }; }

  // Preset dropdown built from the app's combined presets; custom numbers still allowed.
  presetOpt() { const c = L.presetChoices(this.state); return { type: 'dropdown', id: 'preset', label: 'Preset', default: c[0].id, choices: c, allowCustom: true, regex: '/^\\d+$/' }; }

  destChoices() {
    const ds = (this.state && this.state.destinations) || [];
    return ds.length ? ds.map((d) => ({ id: d.key, label: `${d.key} ${d.label}` })) : [{ id: 'S1', label: 'S1' }];
  }

  // ---------- actions ----------
  actions() {
    return {
      recall_preset: {
        name: 'Recall preset to Preview (combined: Master + per-screen memories + Multiviewer)',
        options: [this.presetOpt()],
        callback: (a) => this.run('Recall', () => this.api.recall(a.options.preset)),
      },
      load_screen_memory: {
        name: 'Load a Screen memory to ONE destination',
        options: [
          { type: 'dropdown', id: 'dest', label: 'Destination', default: this.destChoices()[0].id, choices: this.destChoices(), allowCustom: true, regex: '/^[SAsa]\\d+$/' },
          { type: 'dropdown', id: 'memory', label: 'Screen memory (imported from the RS6)', default: L.memoryChoices(this.state, 'screen')[0].id, choices: L.memoryChoices(this.state, 'screen'), allowCustom: true, regex: '/^\\d+$/' },
          SIDE_TARGET,
        ],
        callback: (a) => this.run('Load Screen memory', () => this.api.loadMemory('screen', a.options.memory, String(a.options.dest).toUpperCase(), a.options.target)),
      },
      load_master_memory: {
        name: 'Load a Master memory',
        options: [
          { type: 'dropdown', id: 'memory', label: 'Master memory (imported from the RS6)', default: L.memoryChoices(this.state, 'master')[0].id, choices: L.memoryChoices(this.state, 'master'), allowCustom: true, regex: '/^\\d+$/' },
          SIDE_TARGET,
        ],
        callback: (a) => this.run('Load Master memory', () => this.api.loadMemory('master', a.options.memory, undefined, a.options.target)),
      },
      load_mv_memory: {
        name: 'Load a Multiviewer memory',
        options: [
          { type: 'dropdown', id: 'mv', label: 'Multiviewer output', default: L.mvChoices(this.state)[0].id, choices: L.mvChoices(this.state), allowCustom: true, regex: '/^[Mm]\\d+$/' },
          { type: 'number', id: 'memory', label: 'Multiviewer memory (1-50)', default: 1, min: 1, max: 50 },
        ],
        callback: (a) => this.run('Load Multiviewer memory', () => this.api.loadMemory('multiviewer', a.options.memory, String(a.options.mv).toUpperCase())),
      },
      refresh_memories: { name: 'Re-import memories from the RS6', options: [], callback: () => this.run('Refresh memories', () => this.api.refreshMemories()) },
      take: { name: 'TAKE (selected destinations)', options: [], callback: () => this.run('Take', () => this.api.take()) },
      cut: { name: 'CUT (selected destinations)', options: [], callback: () => this.run('Cut', () => this.api.cut()) },
      toggle_destination: {
        name: 'Toggle destination',
        options: [{ type: 'dropdown', id: 'dest', label: 'Destination (S<n> screen / A<n> aux)', default: this.destChoices()[0].id, choices: this.destChoices(), allowCustom: true, regex: '/^[SAsa]\\d+$/' }],
        callback: (a) => this.run('Toggle destination', () => this.api.toggleDestination(String(a.options.dest).toUpperCase())),
      },
      auto_take: {
        name: 'Auto take on recall',
        options: [{ type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] }],
        callback: (a) => this.run('Auto take', () => this.api.autoTake(a.options.mode === 'toggle' ? undefined : a.options.mode === 'on')),
      },
      input_freeze: {
        name: 'Input freeze',
        options: [this.inputOpt(), TRI],
        callback: (a) => this.run('Freeze', () => this.api.freeze(a.options.input, tri(a.options.mode))),
      },
      backup_trigger: {
        name: 'Backup: select primary / backup slot',
        options: [...BACKUP_TARGET, { type: 'dropdown', id: 'slot', label: 'Slot', default: '1', choices: [{ id: 'NONE', label: 'Primary (NONE)' }, { id: '1', label: 'Backup 1' }, { id: '2', label: 'Backup 2' }] }],
        callback: (a) => this.run('Backup', () => this.api.backup(a.options.kind, a.options.id, a.options.slot)),
      },
      backup_mode: {
        name: 'Backup: automatic switching mode',
        options: [...BACKUP_TARGET, { type: 'dropdown', id: 'auto', label: 'Mode', default: 'on', choices: [{ id: 'on', label: 'Automatic' }, { id: 'off', label: 'Manual' }] }],
        callback: (a) => this.run('Backup mode', () => this.api.backupMode(a.options.kind, a.options.id, a.options.auto === 'on')),
      },
      audio_mute: {
        name: 'Audio channel mute',
        options: [...AUDIO_TARGET, TRI],
        callback: (a) => this.run('Audio mute', () => this.api.audioMute(a.options.dir, a.options.id, a.options.channel, tri(a.options.mode))),
      },
    };
  }

  // ---------- feedbacks ----------
  feedbacks() {
    const presetOpts = [
      this.presetOpt(),
      { type: 'checkbox', id: 'partial', label: 'Also light when only some of its destinations match', default: false },
    ];
    return {
      preset_pvw: {
        type: 'boolean', name: 'Preset on Preview (green tally)', defaultStyle: { bgcolor: L.COLORS.green, color: L.COLORS.white }, options: presetOpts,
        callback: (f) => L.presetTally(this.state, f.options.preset, 'pvw', f.options.partial),
      },
      preset_pgm: {
        type: 'boolean', name: 'Preset on Program (red tally)', defaultStyle: { bgcolor: L.COLORS.red, color: L.COLORS.white }, options: presetOpts,
        callback: (f) => L.presetTally(this.state, f.options.preset, 'pgm', f.options.partial),
      },
      dest_selected: {
        type: 'boolean', name: 'Destination selected', defaultStyle: { bgcolor: L.COLORS.amber, color: L.COLORS.black },
        options: [{ type: 'dropdown', id: 'dest', label: 'Destination', default: this.destChoices()[0].id, choices: this.destChoices(), allowCustom: true }],
        callback: (f) => L.destSelected(this.state, f.options.dest),
      },
      auto_take_on: {
        type: 'boolean', name: 'Auto take is ON', defaultStyle: { bgcolor: L.COLORS.amber, color: L.COLORS.black }, options: [],
        callback: () => !!(this.state && this.state.autoTake),
      },
      device_connected: {
        type: 'boolean', name: 'App connected to the RS6', defaultStyle: { bgcolor: L.COLORS.green, color: L.COLORS.white }, options: [],
        callback: () => !!(this.state && this.state.connected),
      },
      input_pgm: {
        type: 'boolean', name: 'Input on Program (red tally, from the device)', defaultStyle: { bgcolor: L.COLORS.red, color: L.COLORS.white },
        options: [this.inputOpt(), { type: 'dropdown', id: 'dest', label: 'On destination', default: 'any', choices: this.destChoicesAny() }],
        callback: (f) => L.inputTally(this.state, f.options.input, 'pgm', f.options.dest),
      },
      input_pvw: {
        type: 'boolean', name: 'Input on Preview (green tally, from the device)', defaultStyle: { bgcolor: L.COLORS.green, color: L.COLORS.white },
        options: [this.inputOpt(), { type: 'dropdown', id: 'dest', label: 'On destination', default: 'any', choices: this.destChoicesAny() }],
        callback: (f) => L.inputTally(this.state, f.options.input, 'pvw', f.options.dest),
      },
      dest_memory: {
        type: 'boolean', name: 'Destination last Screen memory is X', defaultStyle: { bgcolor: L.COLORS.amber, color: L.COLORS.black },
        options: [
          { type: 'dropdown', id: 'dest', label: 'Destination', default: this.destChoices()[0].id, choices: this.destChoices(), allowCustom: true },
          { type: 'dropdown', id: 'side', label: 'Side', default: 'pgm', choices: [{ id: 'pgm', label: 'Program' }, { id: 'pvw', label: 'Preview' }] },
          { type: 'dropdown', id: 'memory', label: 'Screen memory', default: L.memoryChoices(this.state, 'screen')[0].id, choices: L.memoryChoices(this.state, 'screen'), allowCustom: true, regex: '/^\\d+$/' },
        ],
        callback: (f) => L.destMemoryIs(this.state, f.options.dest, f.options.side, f.options.memory),
      },
      master_memory: {
        type: 'boolean', name: 'Last Master memory is X', defaultStyle: { bgcolor: L.COLORS.amber, color: L.COLORS.black },
        options: [
          { type: 'dropdown', id: 'side', label: 'Side', default: 'pgm', choices: [{ id: 'pgm', label: 'Program' }, { id: 'pvw', label: 'Preview' }] },
          { type: 'dropdown', id: 'memory', label: 'Master memory', default: L.memoryChoices(this.state, 'master')[0].id, choices: L.memoryChoices(this.state, 'master'), allowCustom: true, regex: '/^\\d+$/' },
        ],
        callback: (f) => L.masterIs(this.state, f.options.side, f.options.memory),
      },
      input_frozen: {
        type: 'boolean', name: 'Input frozen', defaultStyle: { bgcolor: L.COLORS.blue, color: L.COLORS.white }, options: [this.inputOpt()],
        callback: (f) => L.inputFrozen(this.state, f.options.input),
      },
      input_problem: {
        type: 'boolean', name: 'Input unavailable / disabled', defaultStyle: { bgcolor: L.COLORS.yellow, color: L.COLORS.black },
        options: [this.inputOpt(), { type: 'dropdown', id: 'what', label: 'Condition', default: 'either', choices: [{ id: 'either', label: 'Unavailable or disabled' }, { id: 'unavailable', label: 'Unavailable (no valid signal)' }, { id: 'disabled', label: 'Disabled' }] }],
        callback: (f) => L.inputProblem(this.state, f.options.input, f.options.what),
      },
      backup_active: {
        type: 'boolean', name: 'Backup active', defaultStyle: { bgcolor: L.COLORS.amber, color: L.COLORS.black },
        options: [...BACKUP_TARGET, { type: 'dropdown', id: 'slot', label: 'Slot', default: 'any', choices: [{ id: 'any', label: 'Any backup slot (1 or 2)' }, { id: '1', label: 'Backup 1' }, { id: '2', label: 'Backup 2' }, { id: 'NONE', label: 'Primary (NONE)' }] }],
        callback: (f) => L.backupActive(this.state, f.options.kind, f.options.id, f.options.slot),
      },
      audio_muted: {
        type: 'boolean', name: 'Audio channel muted', defaultStyle: { bgcolor: L.COLORS.red, color: L.COLORS.white }, options: AUDIO_TARGET,
        callback: (f) => L.audioMuted(this.state, f.options.dir, f.options.id, f.options.channel),
      },
    };
  }
}

runEntrypoint(RS6PresetsInstance, UpgradeScripts);

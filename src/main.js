'use strict';
const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require('@companion-module/base');
const { AppApi } = require('./api');
const L = require('./logic');
const UpgradeScripts = require('./upgrades');

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
      { type: 'number', id: 'poll', label: 'Poll interval (ms)', width: 4, default: 300, min: 100, max: 5000 },
    ];
  }

  // ---------- polling ----------
  start() {
    const host = (this.config.host || '').trim();
    if (!host) { this.updateStatus(InstanceStatus.BadConfig, 'Set the app host'); return; }
    this.api = new AppApi(host, this.config.port || 8080);
    this.updateStatus(InstanceStatus.Connecting);
    const tick = async () => {
      if (this.polling) return; this.polling = true;
      try {
        const st = await this.api.state();
        this.failures = 0;
        this.applyState(st);
        if (st.connected) this.updateStatus(InstanceStatus.Ok);
        else this.updateStatus(InstanceStatus.UnknownWarning, 'App reachable, but it is not connected to the RS6');
      } catch (e) {
        if (++this.failures === 1) this.log('warn', `RS6 Presets app unreachable: ${e.message}`);
        this.updateStatus(InstanceStatus.ConnectionFailure, e.message);
        if (this.state) this.applyState(null);
      } finally { this.polling = false; }
    };
    tick();
    this.timer = setInterval(tick, Math.max(100, Number(this.config.poll) || 300));
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

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
    this.checkFeedbacks('preset_pvw', 'preset_pgm', 'dest_selected', 'auto_take_on', 'device_connected');
  }

  async run(label, fn) {
    if (!this.api) return;
    try { await fn(); }
    catch (e) { this.log('error', `${label} failed: ${e.message}`); }
    try { this.applyState(await this.api.state()); } catch { /* next poll will retry */ }
  }

  destChoices() {
    const ds = (this.state && this.state.destinations) || [];
    return ds.length ? ds.map((d) => ({ id: d.key, label: `${d.key} ${d.label}` })) : [{ id: 'S1', label: 'S1' }];
  }

  // ---------- actions ----------
  actions() {
    return {
      recall_preset: {
        name: 'Recall preset to Preview',
        options: [{ type: 'number', id: 'preset', label: 'Preset number', default: 1, min: 1, max: 9999 }],
        callback: (a) => this.run('Recall', () => this.api.recall(a.options.preset)),
      },
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
    };
  }

  // ---------- feedbacks ----------
  feedbacks() {
    const presetOpts = [
      { type: 'number', id: 'preset', label: 'Preset number', default: 1, min: 1, max: 9999 },
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
    };
  }
}

runEntrypoint(RS6PresetsInstance, UpgradeScripts);

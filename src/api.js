'use strict';
// Tiny client for the RS6 Presets app HTTP API (see the app README, "HTTP control API").
class AppApi {
  constructor(host, port, timeoutMs = 2000) { this.base = `http://${host}:${port}`; this.timeoutMs = timeoutMs; }
  async _req(method, path, body, { timeoutMs = this.timeoutMs, signal } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const res = await fetch(this.base + path, {
        method, signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
      return json;
    } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
  }
  state(opts) { return this._req('GET', '/api/state', undefined, opts); }
  // Long-poll: the app holds the request until its state revision passes `rev` or `waitMs` elapses (app >= 0.2.0).
  stateSince(rev, waitMs, signal) { return this._req('GET', `/api/state?since=${Number(rev)}&timeout=${Number(waitMs)}`, undefined, { timeoutMs: waitMs + 5000, signal }); }
  recall(n) { return this._req('POST', `/api/presets/${Number(n)}/recall`, undefined, { timeoutMs: 30000 }); }
  take() { return this._req('POST', '/api/take'); }
  cut() { return this._req('POST', '/api/cut'); }
  toggleDestination(key) { return this._req('POST', `/api/destinations/${encodeURIComponent(key)}/toggle`); }
  setSelection(keys) { return this._req('POST', '/api/selection', { destinations: keys }); }
  autoTake(value) { return this._req('POST', '/api/autotake', value === undefined ? {} : { value }); }
  // ---- imported device memories (app >= 0.3.0) ----
  loadMemory(type, slot, dest, target) { return this._req('POST', '/api/memories/load', { type, slot: Number(slot), dest, target }); }
  refreshMemories() { return this._req('POST', '/api/memories/refresh', undefined, { timeoutMs: 15000 }); }
  stageLoad(target) { return this._req('POST', '/api/stage/load', { target }); }
  // ---- live device controls (app >= 0.2.0) ----
  freeze(n, value) { return this._req('POST', `/api/inputs/${Number(n)}/freeze`, value === undefined ? {} : { value }); }
  backupPath(kind, id) {
    if (kind === 'input') return `/api/inputs/${Number(id)}/backup`;
    if (kind === 'group') return `/api/groups/${Number(id)}/backup`;
    const [screen, set] = String(id).split('/'); // "S1/2"
    return `/api/backgrounds/${encodeURIComponent(String(screen).toUpperCase())}/${Number(set)}/backup`;
  }
  backup(kind, id, slot) { return this._req('POST', this.backupPath(kind, id), { slot: String(slot) }); }
  backupMode(kind, id, auto) { return this._req('POST', this.backupPath(kind, id) + '/mode', { auto: !!auto }); }
  audioMute(dir, n, ch, value) { return this._req('POST', `/api/audio/${dir === 'outputs' ? 'outputs' : 'inputs'}/${Number(n)}/channels/${Number(ch)}/mute`, value === undefined ? {} : { value }); }
}
module.exports = { AppApi };

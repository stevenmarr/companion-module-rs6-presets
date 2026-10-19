'use strict';
// Tiny client for the RS6 Presets app HTTP API (see the app README, "HTTP control API").
class AppApi {
  constructor(host, port, timeoutMs = 2000) { this.base = `http://${host}:${port}`; this.timeoutMs = timeoutMs; }
  async _req(method, path, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.base + path, {
        method, signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
      return json;
    } finally { clearTimeout(t); }
  }
  state() { return this._req('GET', '/api/state'); }
  recall(n) { return this._req('POST', `/api/presets/${Number(n)}/recall`); }
  take() { return this._req('POST', '/api/take'); }
  cut() { return this._req('POST', '/api/cut'); }
  toggleDestination(key) { return this._req('POST', `/api/destinations/${encodeURIComponent(key)}/toggle`); }
  setSelection(keys) { return this._req('POST', '/api/selection', { destinations: keys }); }
  autoTake(value) { return this._req('POST', '/api/autotake', value === undefined ? {} : { value }); }
}
module.exports = { AppApi };

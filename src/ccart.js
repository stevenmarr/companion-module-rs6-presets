'use strict';
// 0.15.0: Control Center's own pictures on Companion buttons. Control Center 0.35.0 (feature "companionDeckArt") gives
// every key, strip cell and knob in GET /api/companion/deck an "img" id: a hash of the picture it draws there (the same
// picture as its DECKS page and a USB Stream Deck: color bar, small header, big label, PVW / PGM frame, guard border,
// round knob readouts). GET /api/companion/deck/art/<id>.png is that picture. An id never changes its picture, so each
// one is fetched once and kept while the deck model still uses it. cc_deck_look / cc_dial_look then return it as png64.

const FEATURE = 'companionDeckArt';
const RETRY_MS = 10000;

// Every picture id the model uses for the chosen deck sizes. What the decks show now first, then the PTZ dial
// displays, then every page (so the visible buttons are drawn first).
function artIds(model, surfaces) {
  const first = []; const rest = [];
  if (!model || !model.art) return [];
  const want = new Set(surfaces && surfaces.length ? surfaces : []);
  const slots = (face, into) => {
    for (const k of (face && face.keys) || []) if (k.img) into.push(k.img);
    for (const d of (face && face.dials) || []) { if (d.img) into.push(d.img); if (d.knobImg) into.push(d.knobImg); }
  };
  if (model.art.blank) first.push(model.art.blank);
  for (const s of model.surfaces || []) {
    if (want.size && !want.has(s.id)) continue;
    slots(s.live, first);
    for (const p of s.pages || []) slots(p, rest);
  }
  for (const w of Object.values(model.widgets || {})) { if (w.img) first.push(w.img); if (w.knobImg) first.push(w.knobImg); }
  return [...new Set([...first, ...rest])];
}

class ArtCache {
  // fetchPng(id, signal) -> Promise<base64 PNG>. The signal aborts when the cache is cleared or stopped.
  // concurrency is for the whole cache, across want() calls. Default 1: Control Center 0.35.0 draws each picture on
  // its main thread (about 3 ms with its fonts found, about 150 ms when it has to load every system font), so asking
  // for several at once queued camera / switcher commands behind the drawing (e2e under load: PTZ stop timed out).
  constructor(fetchPng, { concurrency = 1, now = () => Date.now() } = {}) {
    this.fetchPng = fetchPng;
    this.concurrency = Math.max(1, concurrency);
    this.active = 0;
    this.queue = []; // resolvers waiting for a fetch slot
    this.now = now;
    this.images = new Map(); // id -> base64
    this.failed = new Map(); // id -> time of the failure
    this.inflight = new Map(); // id -> Promise
    this.ctrl = new AbortController();
    this.stopped = false;
  }

  get(id) { return (id && this.images.get(id)) || null; }

  _acquire() {
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    return new Promise((r) => this.queue.push(r));
  }

  _release() {
    const next = this.queue.shift();
    if (next) next(); else this.active--;
  }

  // Forget everything and abort the fetches still running (new app host / port). Later want() calls fetch again.
  clear() {
    this.ctrl.abort();
    this.ctrl = new AbortController();
    this.images.clear(); this.failed.clear(); this.inflight.clear();
  }

  // The instance is going away: abort what is running and never fetch again (nothing outlives destroy()).
  stop() { this.stopped = true; this.clear(); }

  // Fetch the ids not held yet (and wait for ones another call is already fetching). Resolves with how many new
  // pictures this call brought in (0 = nothing to redraw).
  async want(ids) {
    if (this.stopped) return 0;
    const t = this.now();
    const ctrl = this.ctrl;
    const list = [...new Set((ids || []).filter(Boolean))];
    const others = list.filter((id) => this.inflight.has(id)).map((id) => this.inflight.get(id).catch(() => null));
    const todo = list.filter((id) => !this.images.has(id) && !this.inflight.has(id) && !(this.failed.has(id) && t - this.failed.get(id) < RETRY_MS));
    // reserve every id now, so a call made meanwhile waits for these instead of fetching them again
    const slots = new Map();
    for (const id of todo) {
      let done;
      const p = new Promise((r) => { done = r; });
      slots.set(id, { p, done });
      this.inflight.set(id, p);
    }
    let got = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        try {
          if (ctrl.signal.aborted) continue; // cleared or stopped meanwhile: start no new fetch
          await this._acquire();
          let b64;
          try { b64 = ctrl.signal.aborted ? null : await this.fetchPng(id, ctrl.signal); } finally { this._release(); }
          if (ctrl.signal.aborted) continue; // an answer for the old host, or after stop(): drop it
          if (typeof b64 === 'string' && b64.length) { this.images.set(id, b64); this.failed.delete(id); got++; }
        } catch (e) {
          if (!ctrl.signal.aborted) this.failed.set(id, this.now());
        } finally {
          if (this.inflight.get(id) === slots.get(id).p) this.inflight.delete(id);
          slots.get(id).done();
        }
      }
    };
    await Promise.all([...Array.from({ length: Math.min(this.concurrency, todo.length) }, worker), ...others]);
    return ctrl.signal.aborted ? 0 : got;
  }

  // Drop pictures the model no longer uses (an old value, a page that is gone).
  keepOnly(ids) {
    const keep = new Set(ids || []);
    for (const id of [...this.images.keys()]) if (!keep.has(id)) this.images.delete(id);
    for (const id of [...this.failed.keys()]) if (!keep.has(id)) this.failed.delete(id);
  }
}

module.exports = { FEATURE, ArtCache, artIds };

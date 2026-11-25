// Rate-limited JSON fetch with a disk cache that serves stale data when the network fails.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Remote {
  constructor({ cacheDir, minIntervalMs = 1100, log = () => {} }) {
    this.cacheDir = cacheDir;
    this.minIntervalMs = minIntervalMs;
    this.log = log;
    this.queue = Promise.resolve();
    this.lastAt = 0;
    this.memory = new Map();
    this.inflight = new Map();
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  fileFor(key) {
    const safe = key.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
    return path.join(this.cacheDir, `${safe}-${hash}.json`);
  }

  readCache(key) {
    if (this.memory.has(key)) return this.memory.get(key);
    try {
      const entry = JSON.parse(fs.readFileSync(this.fileFor(key), 'utf8'));
      this.memory.set(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  writeCache(key, data) {
    const entry = { ts: Date.now(), data };
    this.memory.set(key, entry);
    try { fs.writeFileSync(this.fileFor(key), JSON.stringify(entry)); } catch {}
    return entry;
  }

  // Serialises network calls so the free OpenDota tier (60/min) is never exceeded.
  throttled(fn) {
    const run = this.queue.then(async () => {
      const wait = this.lastAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      return fn();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async fetchJson(url, timeoutMs) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.throttled(() => fetch(url, { signal: AbortSignal.timeout(timeoutMs) }));
      if (res.status === 429 && attempt === 0) {
        this.log('warn', 'remote 429, backing off', { url: url.split('?')[0] });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    throw new Error('HTTP 429');
  }

  // Fire-and-forget POST through the same queue (OpenDota parse requests).
  async post(url, timeoutMs = 15000) {
    const res = await this.throttled(() => fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }

  // Returns { data, ts, stale }. Throws only when nothing is cached and the fetch fails.
  async get(key, url, { ttlMs, timeoutMs = 20000, validate } = {}) {
    const cached = this.readCache(key);
    if (cached && Date.now() - cached.ts < ttlMs) return { data: cached.data, ts: cached.ts, stale: false };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = (async () => {
      try {
        const data = await this.fetchJson(url, timeoutMs);
        if (validate) validate(data);
        const entry = this.writeCache(key, data);
        return { data: entry.data, ts: entry.ts, stale: false };
      } catch (e) {
        this.log('warn', 'remote fetch failed', { key, err: String(e.message || e).slice(0, 120) });
        if (cached) return { data: cached.data, ts: cached.ts, stale: true };
        throw e;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }
}

module.exports = { Remote };

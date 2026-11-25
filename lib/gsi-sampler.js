// Records what the real client sends: last payload per game state, every key seen, every event.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['previously', 'added', 'auth']);

// slot0..slot8, ability3, pick4_id: one entry per kind of key, not per index.
const norm = (k) => (/^team[23]$/.test(k) ? k : k.replace(/\d+/g, '#'));

function collectKeys(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (!prefix && SKIP.has(k)) continue;
    const p = prefix ? prefix + '.' + norm(k) : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, p, out);
    else if (!(p in out)) out[p] = v;
  }
  return out;
}

class GsiSampler {
  constructor(dir, { every = 5000 } = {}) {
    this.dir = dir;
    this.every = every;
    this.keys = {};
    this.lastWrite = {};
    this.dirty = false;
    this.seenEvents = new Set();
    fs.mkdirSync(dir, { recursive: true });
    try { this.keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8')); } catch {}
  }

  add(payload, now = Date.now()) {
    if (!payload || typeof payload !== 'object' || (payload.auth && payload.auth.token === 'simulator')) return;
    const before = Object.keys(this.keys).length;
    collectKeys(payload, '', this.keys);
    if (Object.keys(this.keys).length !== before) this.dirty = true;

    const ev = payload.events;
    const events = Array.isArray(ev) ? ev : (ev && Array.isArray(ev.events) ? ev.events : []);
    // the client repeats recent events in later payloads
    const fresh = events.filter((e) => { const k = JSON.stringify(e); if (this.seenEvents.has(k)) return false; this.seenEvents.add(k); return true; });
    if (this.seenEvents.size > 2000) this.seenEvents = new Set([...this.seenEvents].slice(-500));
    if (fresh.length) {
      const clock = payload.map && payload.map.clock_time;
      fs.appendFileSync(path.join(this.dir, 'events.jsonl'), fresh.map((e) => JSON.stringify({ clock, ...e })).join('\n') + '\n');
    }

    const state = String((payload.map && payload.map.game_state) || 'no_map').replace(/^DOTA_GAMERULES_STATE_/, '').toLowerCase();
    if (now - (this.lastWrite[state] || 0) >= this.every) {
      this.lastWrite[state] = now;
      const { auth, ...rest } = payload;
      fs.writeFileSync(path.join(this.dir, `state-${state}.json`), JSON.stringify(rest, null, 1));
    }
    if (this.dirty && now - (this.lastWrite.keys || 0) >= this.every) this.flush(now);
  }

  flush(now = Date.now()) {
    this.lastWrite.keys = now;
    this.dirty = false;
    const sorted = Object.fromEntries(Object.keys(this.keys).sort().map((k) => [k, this.keys[k]]));
    fs.writeFileSync(path.join(this.dir, 'keys.json'), JSON.stringify(sorted, null, 1));
  }
}

module.exports = { GsiSampler, collectKeys };

// OpenDota access: public endpoints plus the SQL explorer (pro matches only).
const DAY = 864e5;

class OpenDota {
  constructor({ remote, base = 'https://api.opendota.com/api', getApiKey = () => '' }) {
    this.remote = remote;
    this.base = base.replace(/\/$/, '');
    this.getApiKey = getApiKey;
  }

  url(path, params = {}) {
    const q = new URLSearchParams(params);
    const key = this.getApiKey();
    if (key) q.set('api_key', key);
    const qs = q.toString();
    return this.base + path + (qs ? '?' + qs : '');
  }

  heroStats() {
    return this.remote.get('heroStats', this.url('/heroStats'), {
      ttlMs: DAY,
      validate: (d) => { if (!Array.isArray(d) || d.length < 100) throw new Error('heroStats incomplete'); },
    });
  }

  patches() {
    return this.remote.get('patches', this.url('/constants/patch'), {
      ttlMs: DAY,
      validate: (d) => { if (!Array.isArray(d) || !d.length) throw new Error('patches empty'); },
    });
  }

  matchups(heroId) {
    return this.remote.get(`matchups-${heroId}`, this.url(`/heroes/${heroId}/matchups`), {
      ttlMs: DAY,
      validate: (d) => { if (!Array.isArray(d)) throw new Error('matchups not an array'); },
    });
  }

  itemPopularity(heroId) {
    return this.remote.get(`itempop-${heroId}`, this.url(`/heroes/${heroId}/itemPopularity`), { ttlMs: DAY });
  }

  playerHeroes(accountId) {
    return this.remote.get(`player-heroes-${accountId}`, this.url(`/players/${accountId}/heroes`, { date: 180 }), {
      ttlMs: DAY,
      validate: (d) => { if (!Array.isArray(d)) throw new Error('player heroes not an array'); },
    });
  }

  match(matchId) {
    return this.remote.get(`match-${matchId}`, this.url(`/matches/${matchId}`), {
      ttlMs: 5 * 60e3,
      validate: (d) => { if (!d || !Array.isArray(d.players)) throw new Error('match not available'); },
    });
  }

  requestParse(matchId) {
    return this.remote.post(this.url(`/request/${matchId}`));
  }

  explorer(key, sql) {
    return this.remote.get(key, this.url('/explorer', { sql }), {
      ttlMs: DAY,
      timeoutMs: 45000,
      validate: (d) => {
        if (!d || d.err) throw new Error('explorer: ' + String((d && d.err) || 'empty').slice(0, 100));
        if (!Array.isArray(d.rows)) throw new Error('explorer: no rows');
      },
    });
  }
}

module.exports = { OpenDota };

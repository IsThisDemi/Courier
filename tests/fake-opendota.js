// Fake OpenDota for tests and screenshots: deterministic answers, no network.
const http = require('http');

const HEROES = Object.values(require('../renderer/data/heroes.json'));

const explorerSql = [];
function fakeOpenDota() {
  const heroStats = HEROES.map((h) => ({ ...h, pro_pick: 50 + (h.id % 40), pro_win: 25 + (h.id % 20), pro_ban: h.id % 30, pub_pick: 10000, pub_win: 4800 + (h.id % 50) * 8 }));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname.endsWith('/heroStats')) return json(heroStats);
    const mu = /\/heroes\/(\d+)\/matchups$/.exec(url.pathname);
    if (mu) return json(HEROES.filter((h) => h.id !== Number(mu[1])).map((h) => ({ hero_id: h.id, games_played: 200, wins: 100 + ((h.id * 7 + Number(mu[1])) % 41) - 20 })));
    if (url.pathname.endsWith('/constants/patch')) return json([{ name: '7.41', date: '2026-03-24T00:50:59Z' }, { name: '7.42', date: '2026-11-18T21:28:07Z' }]);
    if (url.pathname.endsWith('/explorer')) {
      const sql = url.searchParams.get('sql') || '';
      explorerSql.push(sql);
      if (sql.includes('SELECT position, count(*)')) return json({ rows: [{ position: 1, games: 10 }, { position: 3, games: 40 }, { position: 4, games: 5 }] });
      if (sql.includes('neutral_item_history')) {
        const row = (kind, item, games) => ({ kind, item, games, total: 60 });
        return json({ rows: [row('a', 'chipped_vest', 30), row('a', 'pogo_stick', 14), row('a', 'brick', 33), row('a', 'stormcrafter', 20), row('a', 'ceremonial_robe', 12),
          row('e', 'enhancement_tough', 25), row('e', 'enhancement_brawny', 8), row('r1', null, 60), row('r2', null, 58), row('r3', null, 40), row('r4', null, 4)] });
      }
      if (sql.includes('ability_upgrades_arr')) {
        const arr = [5008, 5009, 5009, 5007, 5009, 5010, 5009, 5008, 5007, 5008, 9401, 5008, 5010, 5007, 5007, 6102];
        return json({ rows: Array.from({ length: 20 }, () => ({ arr })) });
      }
      if (sql.includes('ORDER BY start_time DESC LIMIT 6000')) {
        return json({ rows: [135, 116, 1, 63].map((id) => ({ item_id: id, games: 3000, wins: 1500, players: 60000 })) });
      }
      if (sql.includes('WITH opp AS')) {
        return json({ rows: [{ item_id: 135, games: 80, wins: 50, players: 1000 }, { item_id: 116, games: 50, wins: 25, players: 1000 }] });
      }
      if (sql.includes('purchase_log')) {
        const r = (item, games, med_t, sg = 0, st = 0) => ({ item, games, med_t, start_games: sg, start_total: st, total: 100, oldest: 1790000000 });
        return json({ rows: [r('tango', 90, -89, 80, 80), r('branches', 70, -89, 70, 140), r('phase_boots', 98, 400), r('blink', 95, 900), r('black_king_bar', 70, 1500), r('heart', 20, 2200), r('monkey_king_bar', 15, 2000)] });
      }
      return json({ rows: HEROES.slice(0, 60).map((h) => ({ hero_id: h.id, games: 80, wins: 40 + (h.id % 9) - 4 })) });
    }
    if (/\/players\/\d+\/heroes$/.test(url.pathname)) return json([{ hero_id: 32, games: 40, win: 22 }, ...HEROES.slice(0, 30).map((h) => ({ hero_id: h.id, games: 6, win: 4 }))]);
    if (/\/matches\/\d+$/.test(url.pathname)) {
      return json({ match_id: 1, duration: 2400, radiant_win: true, players: [{
        account_id: 39734272, hero_id: 2, player_slot: 2, kills: 7, deaths: 3, assists: 12, last_hits: 210, denies: 12,
        gold_per_min: 520, xp_per_min: 610, net_worth: 21000, hero_damage: 18000,
        benchmarks: { gold_per_min: { raw: 520, pct: 0.71 }, xp_per_min: { raw: 610, pct: 0.64 }, last_hits_per_min: { raw: 5.2, pct: 0.55 } },
        purchase_log: [{ time: 380, key: 'phase_boots' }, { time: 1020, key: 'blink' }, { time: 1700, key: 'black_king_bar' }],
      }] });
    }
    return json([]);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

module.exports = { fakeOpenDota, explorerSql };


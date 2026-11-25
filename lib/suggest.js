// Pick suggestions: counter value against the enemy lineup plus synergy with the allies.
const { load } = require('./constants');

const PRIOR = 30; // virtual games at 50% that pull small samples towards neutral

const smoothed = (wins, games) => (Number(wins) + PRIOR * 0.5) / (Number(games) + PRIOR);

function synergySql(heroId, since) {
  const id = Number(heroId) | 0;
  const t = Number(since) | 0;
  return `SELECT b.hero_id, count(*) AS games,
  sum(CASE WHEN (b.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) AS wins
FROM player_matches a
JOIN player_matches b ON b.match_id = a.match_id AND b.hero_id <> a.hero_id AND (b.player_slot < 128) = (a.player_slot < 128)
JOIN matches m ON m.match_id = a.match_id
WHERE a.hero_id = ${id} AND m.start_time >= ${t}
GROUP BY b.hero_id`;
}

// matchupsByEnemy: { enemyId: rows of /heroes/{enemy}/matchups } where wins are the enemy's wins.
// synergyByAlly: { allyId: explorer rows {hero_id, games, wins} for heroes on the ally's team }.
function rankPicks({ enemies = [], allies = [], bans = [], matchupsByEnemy = {}, synergyByAlly = {}, heroStats = [], myHeroes = null }) {
  const { heroesById } = load();
  const excluded = new Set([...enemies, ...allies, ...bans].map(Number));
  const meta = new Map();
  for (const h of heroStats) {
    const games = Number(h.pub_pick) || 0;
    meta.set(h.id, games ? smoothed(h.pub_win, games) : 0.5);
  }
  const out = [];
  for (const hero of heroesById.values()) {
    if (excluded.has(hero.id)) continue;
    const vs = [];
    for (const e of enemies) {
      const row = (matchupsByEnemy[e] || []).find((r) => r.hero_id === hero.id);
      if (!row || !row.games_played) continue;
      vs.push({ id: Number(e), adv: (0.5 - smoothed(row.wins, row.games_played)) * 100, games: row.games_played });
    }
    const withAllies = [];
    for (const a of allies) {
      const row = (synergyByAlly[a] || []).find((r) => Number(r.hero_id) === hero.id);
      if (!row || !Number(row.games)) continue;
      withAllies.push({ id: Number(a), adv: (smoothed(row.wins, row.games) - 0.5) * 100, games: Number(row.games) });
    }
    const counter = vs.reduce((s, x) => s + x.adv, 0);
    const synergy = withAllies.reduce((s, x) => s + x.adv, 0);
    const metaAdv = ((meta.get(hero.id) ?? 0.5) - 0.5) * 100;
    const score = counter + 0.6 * synergy + 0.5 * metaAdv;
    out.push({
      id: hero.id,
      score: Math.round(score * 10) / 10,
      counter: Math.round(counter * 10) / 10,
      synergy: Math.round(synergy * 10) / 10,
      meta: Math.round(metaAdv * 10) / 10,
      vs: vs.sort((a, b) => b.adv - a.adv).map((x) => ({ ...x, adv: Math.round(x.adv * 10) / 10 })),
      with: withAllies.sort((a, b) => b.adv - a.adv).map((x) => ({ ...x, adv: Math.round(x.adv * 10) / 10 })),
      roles: hero.roles,
      mine: myHeroes && myHeroes.get(hero.id) ? myHeroes.get(hero.id) : null,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Bans: heroes that beat our current picks, plus overall strength and pro contest rate.
// matchupsByAlly: { allyId: /heroes/{ally}/matchups rows } where wins are the ally's wins.
function rankBans({ allies = [], excluded = [], matchupsByAlly = {}, heroStats = [] }) {
  const { heroesById } = load();
  const skip = new Set([...allies, ...excluded].map(Number));
  const stats = new Map(heroStats.map((h) => [h.id, h]));
  const maxContest = Math.max(1, ...heroStats.map((h) => (Number(h.pro_pick) || 0) + (Number(h.pro_ban) || 0)));
  const out = [];
  for (const hero of heroesById.values()) {
    if (skip.has(hero.id)) continue;
    const beats = [];
    for (const a of allies) {
      const row = (matchupsByAlly[a] || []).find((r) => r.hero_id === hero.id);
      if (!row || !row.games_played) continue;
      beats.push({ id: Number(a), adv: (0.5 - smoothed(row.wins, row.games_played)) * 100, games: row.games_played });
    }
    const h = stats.get(hero.id) || {};
    const metaAdv = Number(h.pub_pick) ? (smoothed(h.pub_win, h.pub_pick) - 0.5) * 100 : 0;
    const contest = ((Number(h.pro_pick) || 0) + (Number(h.pro_ban) || 0)) / maxContest;
    const threat = beats.reduce((sum, b) => sum + b.adv, 0);
    out.push({
      id: hero.id,
      score: Math.round((threat + 0.5 * metaAdv + 4 * contest) * 10) / 10,
      beats: beats.filter((b) => b.adv > 0).sort((a, b) => b.adv - a.adv).map((b) => ({ ...b, adv: Math.round(b.adv * 10) / 10 })),
      contest: Math.round(contest * 100),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 6);
}

function metaList(heroStats, limit = 16) {
  return heroStats
    .map((h) => ({
      id: h.id,
      contest: (Number(h.pro_pick) || 0) + (Number(h.pro_ban) || 0),
      proWin: Number(h.pro_pick) ? Number(h.pro_win) / Number(h.pro_pick) : null,
      pubWin: Number(h.pub_pick) ? Number(h.pub_win) / Number(h.pub_pick) : null,
    }))
    .sort((a, b) => b.contest - a.contest)
    .slice(0, limit);
}

module.exports = { rankPicks, rankBans, metaList, synergySql, smoothed };

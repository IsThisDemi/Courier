// Pro item builds aggregated from recent professional matches (OpenDota explorer).
const { load } = require('./constants');
const { positionCte, validPos } = require('./positions');

const MATCHES = 120;

// opts.since: unix time of the oldest game (patch start); opts.pos: position 1-5 or null for all.
function buildSql(heroId, opts = {}) {
  const pos = validPos(opts.pos);
  return `WITH ${positionCte(heroId, opts.since)}, g AS (
  SELECT pm.match_id, pm.purchase_log, m.start_time, m.duration FROM pos JOIN player_matches pm USING (match_id, player_slot) JOIN matches m USING (match_id)
  WHERE pm.purchase_log IS NOT NULL${pos ? ` AND pos.position = ${pos}` : ''}
  ORDER BY m.start_time DESC LIMIT ${MATCHES}
), f AS (
  SELECT g.match_id, x->>'key' AS item, min((x->>'time')::int) AS first_t,
         count(*) FILTER (WHERE (x->>'time')::int <= 0) AS start_n
  FROM g, unnest(g.purchase_log) x GROUP BY 1, 2
), s AS (
  SELECT item, count(*) AS games, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY first_t)) AS med_t,
         count(*) FILTER (WHERE start_n > 0) AS start_games, sum(start_n) AS start_total
  FROM f GROUP BY item
)
SELECT s.*, (SELECT count(*) FROM g WHERE g.duration >= s.med_t) AS alive,
       (SELECT count(*) FROM g) AS total, (SELECT min(start_time) FROM g) AS oldest
FROM s ORDER BY games DESC LIMIT 160`;
}

const EXTRA_CONSUMABLES = new Set(['tpscroll', 'ward_observer', 'ward_sentry', 'ward_dispenser', 'smoke_of_deceit',
  'dust', 'tango', 'tango_single', 'flask', 'clarity', 'faerie_fire', 'enchanted_mango', 'blood_grenade', 'famango',
  'great_famango', 'greater_famango', 'cheese', 'refresher_shard', 'aegis', 'tome_of_knowledge']);

function isConsumable(item, key) {
  return EXTRA_CONSUMABLES.has(key) || (item && /consumable/.test(item.qual || ''));
}

// A "finished" item is something a player plans for: crafted, or expensive on its own (Blink, Shard).
function isFinished(item, key) {
  if (!item || /^recipe_/.test(key) || isConsumable(item, key)) return false;
  return !!item.components || item.cost >= 1800 || key === 'aghanims_shard';
}

function classify(rows) {
  const { items } = load();
  const total = rows.length ? Number(rows[0].total) || 0 : 0;
  const oldest = rows.length ? Number(rows[0].oldest) || null : null;
  const starting = [];
  const core = [];
  const situational = [];
  if (!total) return { games: 0, oldest, starting, core, situational };
  // Intermediate items (Yasha before Manta, Reaver before Heart) are hidden when the item they
  // build into is bought in at least half as many games.
  const gamesByItem = new Map(rows.map((r) => [r.item, Number(r.games)]));
  const upgradedLater = (key, games) => {
    for (const [other, otherGames] of gamesByItem) {
      const it = items.get(other);
      if (it && it.components && it.components.includes(key) && otherGames >= games * 0.5) return true;
    }
    return false;
  };
  for (const r of rows) {
    const key = r.item;
    const item = items.get(key);
    if (!item) continue;
    const pct = Number(r.games) / total;
    const startPct = Number(r.start_games) / total;
    if (startPct >= 0.25) {
      starting.push({
        key, name: item.name, pct: startPct,
        qty: Math.max(1, Math.round(Number(r.start_total) / Math.max(1, Number(r.start_games)))),
      });
    }
    const time = Number(r.med_t);
    if (time <= 0 || !isFinished(item, key) || upgradedLater(key, Number(r.games))) continue;
    // Late items: share of the games still running at that minute, not of all games.
    const alive = Number(r.alive) || total;
    const share = Number(r.games) / Math.max(alive, total * 0.2);
    const entry = { key, name: item.name, pct: share, time, late: alive < total * 0.9 };
    if (share >= 0.35) core.push(entry);
    else if (share >= 0.1 && Number(r.games) >= 3) situational.push(entry);
  }
  starting.sort((a, b) => b.pct - a.pct);
  core.sort((a, b) => a.time - b.time);
  situational.sort((a, b) => a.time - b.time);
  return { games: total, oldest, starting: starting.slice(0, 8), core: core.slice(0, 10), situational: situational.slice(0, 10) };
}

// Public-match fallback when the hero has almost no pro games.
function classifyPopularity(pop) {
  const { items, itemsById } = load();
  const phases = [['early_game_items', 300], ['mid_game_items', 1200], ['late_game_items', 2400]];
  const starting = Object.entries((pop && pop.start_game_items) || {})
    .map(([id, n]) => ({ item: itemsById.get(Number(id)) || items.get(id), n: Number(n) }))
    .filter((e) => e.item)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((e) => ({ key: e.item.key, name: e.item.name, qty: 1, pct: null }));
  const seen = new Set();
  const core = [];
  for (const [phase, time] of phases) {
    const list = Object.entries((pop && pop[phase]) || {})
      .map(([id, n]) => ({ item: itemsById.get(Number(id)) || items.get(id), n: Number(n) }))
      .filter((e) => e.item && isFinished(e.item, e.item.key) && !seen.has(e.item.key))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    for (const e of list) { seen.add(e.item.key); core.push({ key: e.item.key, name: e.item.name, pct: null, time }); }
  }
  return { games: null, oldest: null, starting, core, situational: [] };
}

// Finished items the hero buys in at least `min` of the games: what makes sense to suggest for it.
function itemPool(rows, min = 0.05) {
  const { items } = load();
  const total = rows.length ? Number(rows[0].total) || 0 : 0;
  const pool = new Set();
  if (!total) return pool;
  for (const r of rows) {
    const it = items.get(r.item);
    if (it && Number(r.games) / total >= min && (isFinished(it, r.item) || r.item === 'gem')) pool.add(r.item);
  }
  return pool;
}

module.exports = { buildSql, classify, classifyPopularity, isFinished, itemPool };

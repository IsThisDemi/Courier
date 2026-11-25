// Neutral artifacts and enchantments pros pick at each tier of the current patch.
const fs = require('fs');
const path = require('path');
const { load } = require('./constants');
const { positionCte, validPos } = require('./positions');

const TIERS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'data', 'neutral-tiers.json'), 'utf8')).tiers;
const ATTR = { str: 'strength', agi: 'agility', int: 'intelligence', all: 'universal' };

// Tier of an artifact, from the bundled tier list (picks can come before the tier time with madstones).
function tierCase(col) {
  const safe = (k) => `'${String(k).replace(/[^a-z0-9_]/g, '')}'`;
  return `CASE ${TIERS.map((t) => `WHEN ${col} IN (${t.artifacts.map(safe).join(', ')}) THEN ${t.tier}`).join(' ')} END`;
}

// From neutral_item_history (every pick with its time). Kinds: a = artifact, e = enchantment, r = games with an artifact of that tier.
function neutralsSql(heroId, opts = {}) {
  const pos = validPos(opts.pos);
  return `WITH ${positionCte(heroId, opts.since)}, g AS (
  SELECT pm.match_id, pm.neutral_item_history AS h FROM pos JOIN player_matches pm USING (match_id, player_slot) JOIN matches m USING (match_id)
  WHERE pm.neutral_item_history IS NOT NULL${pos ? ` AND pos.position = ${pos}` : ''}
  ORDER BY m.start_time DESC LIMIT 200
), x AS (
  SELECT g.match_id, e->>'item_neutral' AS art, e->>'item_neutral_enhancement' AS ench FROM g, unnest(g.h) e
), t AS (
  SELECT match_id, ${tierCase('art')} AS tier FROM x WHERE art IS NOT NULL
)
SELECT 'a' AS kind, art AS item, count(DISTINCT match_id) AS games, (SELECT count(*) FROM g) AS total FROM x WHERE art IS NOT NULL AND art <> '' GROUP BY art
UNION ALL
SELECT 'e', ench, count(DISTINCT match_id), (SELECT count(*) FROM g) FROM x WHERE ench IS NOT NULL AND ench <> '' GROUP BY ench
UNION ALL
SELECT 'r' || tier, NULL, count(DISTINCT match_id), (SELECT count(*) FROM g) FROM t WHERE tier IS NOT NULL GROUP BY tier`;
}

// Fallback when the history is missing: the neutral held at the end of the game.
function finalNeutralSql(heroId, opts = {}) {
  const pos = validPos(opts.pos);
  return `WITH ${positionCte(heroId, opts.since)}, g AS (
  SELECT pm.item_neutral FROM pos JOIN player_matches pm USING (match_id, player_slot) JOIN matches m USING (match_id)
  WHERE true${pos ? ` AND pos.position = ${pos}` : ''}
  ORDER BY m.start_time DESC LIMIT 200
)
SELECT 'a' AS kind, item_neutral AS item_id, count(*) AS games, (SELECT count(*) FROM g) AS total FROM g WHERE item_neutral > 0 GROUP BY item_neutral`;
}

const keyOf = (s) => String(s || '').replace(/^item_/, '');

function neutralPicks(rows, heroAttr) {
  const { itemsById, items } = load();
  const total = rows.length ? Number(rows[0].total) || 0 : 0;
  const fromHistory = rows.some((r) => /^r/.test(r.kind));
  const tierOf = new Map(TIERS.flatMap((t) => t.artifacts.map((k) => [k, t.tier])));
  const arts = new Map();
  const ench = new Map();
  const reached = new Map();
  for (const r of rows) {
    const games = Number(r.games) || 0;
    if (/^r\d$/.test(r.kind)) { reached.set(Number(r.kind.slice(1)), games); continue; }
    const key = r.item_id != null ? (itemsById.get(Number(r.item_id)) || {}).key : keyOf(r.item);
    if (!key || !items.has(key)) continue;
    if (r.kind === 'a') arts.set(key, (arts.get(key) || 0) + games);
    if (r.kind === 'e') ench.set(key, (ench.get(key) || 0) + games);
  }
  const attr = ATTR[heroAttr] || null;
  const byGames = (a, b) => b.games - a.games;
  const entry = (key, games, base) => ({ key, name: items.get(key) ? items.get(key).name : key, games, share: base ? games / base : 0 });
  const tiers = TIERS.map((t) => {
    // with the history, an artifact's share is over the games where an artifact of its tier was picked
    const base = fromHistory ? reached.get(t.tier) || 0 : total;
    return {
      tier: t.tier,
      start: t.start,
      games: base,
      artifacts: t.artifacts.filter((k) => tierOf.get(k) === t.tier).map((k) => entry(k, arts.get(k) || 0, base)).sort(byGames),
    };
  });
  // Enchantments offered to the hero's attribute, any tier.
  const offered = new Set(TIERS.flatMap((t) => [...(t.enhancements.global || []), ...((attr && t.enhancements[attr]) || [])].map((e) => e.key)));
  const picks = [...offered].map((k) => entry(k, ench.get(k) || 0, total)).filter((e) => e.games).sort(byGames);
  return { games: total, fromHistory, tiers, enchantments: picks };
}

module.exports = { neutralsSql, finalNeutralSql, neutralPicks, TIERS, tierCase };

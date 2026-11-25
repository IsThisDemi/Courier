// Item answers to the enemy lineup, from pro data, plus counters to the items enemies usually build.
const { load } = require('./constants');
const { isFinished } = require('./probuild');

const PRIOR = 20;
const MIN_GAMES = 12;

// Baseline: how often each item is held and wins in the most recent pro matches.
function globalItemsSql() {
  return `WITH recent AS (SELECT match_id, radiant_win FROM matches ORDER BY start_time DESC LIMIT 6000),
p AS (SELECT (pm.player_slot < 128) = r.radiant_win AS won, ARRAY[pm.item_0, pm.item_1, pm.item_2, pm.item_3, pm.item_4, pm.item_5] AS items
      FROM recent r JOIN player_matches pm USING (match_id))
SELECT it AS item_id, count(*) AS games, sum(CASE WHEN won THEN 1 ELSE 0 END) AS wins, (SELECT count(*) FROM p) AS players
FROM p, unnest(items) it WHERE it > 0 GROUP BY it`;
}

// Final inventories of the players who faced a given hero, with their result.
function vsItemsSql(heroId, since) {
  const id = Number(heroId) | 0;
  const t = Number(since) | 0;
  return `WITH opp AS (
  SELECT (b.player_slot < 128) = m.radiant_win AS won, ARRAY[b.item_0, b.item_1, b.item_2, b.item_3, b.item_4, b.item_5] AS items
  FROM player_matches a
  JOIN player_matches b ON b.match_id = a.match_id AND (b.player_slot < 128) <> (a.player_slot < 128)
  JOIN matches m ON m.match_id = a.match_id
  WHERE a.hero_id = ${id} AND m.start_time >= ${t}
)
SELECT it AS item_id, count(*) AS games, sum(CASE WHEN won THEN 1 ELSE 0 END) AS wins, (SELECT count(*) FROM opp) AS players
FROM opp, unnest(items) it WHERE it > 0 GROUP BY it`;
}

// Items that only say "the game went long or was already won", not "this answers that hero".
const NOT_ANSWERS = new Set(['hand_of_midas', 'refresher', 'rapier', 'moon_shard', 'travel_boots', 'travel_boots_2',
  'ultimate_scepter', 'aghanims_shard', 'bottle', 'tpscroll', 'aegis', 'cheese']);
const KEEP_COMPONENTS = new Set(['blink', 'gem']);
const ALWAYS_USEFUL = new Set(['gem']);

let componentSet = null;
function components() {
  if (componentSet) return componentSet;
  componentSet = new Set();
  for (const it of load().items.values()) for (const c of it.components || []) componentSet.add(c);
  return componentSet;
}

// Two signals: pros buy the item more often against this hero (buy ratio), and it wins more than
// usual against this hero (win lift, corrected for how often the hero's opponents win anyway).
function itemLifts(vsRows, globalRows) {
  const { itemsById } = load();
  const global = new Map(globalRows.map((r) => [Number(r.item_id), r]));
  const vsPlayers = Number((vsRows[0] || {}).players) || 0;
  const globalPlayers = Number((globalRows[0] || {}).players) || 0;
  const games = vsRows.reduce((s, r) => s + Number(r.games), 0);
  const wins = vsRows.reduce((s, r) => s + Number(r.wins), 0);
  const baseline = games ? wins / games - 0.5 : 0;
  const out = [];
  for (const r of vsRows) {
    const item = itemsById.get(Number(r.item_id));
    const g = global.get(Number(r.item_id));
    if (!item || !g || Number(r.games) < MIN_GAMES || Number(g.games) < 50) continue;
    if (NOT_ANSWERS.has(item.key) || (components().has(item.key) && !KEEP_COMPONENTS.has(item.key))) continue;
    if (!ALWAYS_USEFUL.has(item.key) && (!isFinished(item, item.key) || item.cost < 1200)) continue;
    const globalWr = Number(g.wins) / Number(g.games);
    const vsWr = (Number(r.wins) + PRIOR * globalWr) / (Number(r.games) + PRIOR);
    const lift = (vsWr - globalWr - baseline) * 100;
    const ratio = vsPlayers && globalPlayers ? (Number(r.games) / vsPlayers) / (Number(g.games) / globalPlayers) : 1;
    if (ratio < 1.15 && lift < 6) continue;
    out.push({ key: item.key, name: item.name, score: 8 * Math.log2(ratio) + lift, lift, ratio, games: Number(r.games) });
  }
  return out.sort((a, b) => b.score - a.score);
}

// pool: items the player's hero actually builds; without it the answers are generic.
function counterItems(enemies, vsRowsByEnemy, globalRows, pool = null) {
  const merged = new Map();
  for (const e of enemies) {
    const lifts = itemLifts(vsRowsByEnemy[e] || [], globalRows).filter((x) => x.score > 4 && (!pool || pool.has(x.key))).slice(0, 6);
    for (const x of lifts) {
      if (!merged.has(x.key)) merged.set(x.key, { key: x.key, name: x.name, score: 0, vs: [] });
      const m = merged.get(x.key);
      m.score += x.score;
      m.vs.push({ id: Number(e), ratio: Math.round(x.ratio * 10) / 10, lift: Math.round(x.lift * 10) / 10, games: x.games });
    }
  }
  return [...merged.values()]
    .map((m) => ({ ...m, score: Math.round(m.score * 10) / 10, vs: m.vs.sort((a, b) => b.ratio - a.ratio) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

// Answers to items that enemies commonly build. Only well-established interactions.
const ITEM_ANSWERS = {
  butterfly: { answer: ['monkey_king_bar', 'bloodthorn'], why: 'evasione' },
  heavens_halberd: { answer: ['monkey_king_bar'], why: 'evasione' },
  invis_sword: { answer: ['dust', 'ward_sentry', 'gem'], why: 'invisibilità' },
  silver_edge: { answer: ['dust', 'ward_sentry', 'gem'], why: 'invisibilità' },
  glimmer_cape: { answer: ['dust', 'ward_sentry', 'nullifier'], why: 'invisibilità e protezione magica' },
  satanic: { answer: ['spirit_vessel', 'shivas_guard'], why: 'cure' },
  holy_locket: { answer: ['spirit_vessel', 'shivas_guard'], why: 'cure' },
  guardian_greaves: { answer: ['spirit_vessel'], why: 'cure' },
  heart: { answer: ['spirit_vessel', 'skadi'], why: 'rigenerazione' },
  ghost: { answer: ['nullifier'], why: 'forma eterea' },
  ethereal_blade: { answer: ['nullifier'], why: 'forma eterea' },
  force_staff: { answer: ['nullifier'], why: 'fughe' },
  cyclone: { answer: ['nullifier'], why: 'fughe' },
  wind_waker: { answer: ['nullifier'], why: 'fughe' },
  aeon_disk: { answer: ['nullifier'], why: 'protezione dalle combo' },
  sphere: { answer: ['orchid', 'nullifier'], why: 'blocco degli incantesimi' },
  desolator: { answer: ['assault', 'solar_crest'], why: 'riduzione di armatura' },
  radiance: { answer: ['pipe', 'eternal_shroud'], why: 'danno magico continuo' },
  mjollnir: { answer: ['pipe'], why: 'danno magico ad area' },
  manta: { answer: ['mjollnir', 'shivas_guard'], why: 'illusioni' },
};

function enemyPredictions(enemyBuilds) {
  const { items } = load();
  return enemyBuilds.map(({ hero, build }) => {
    const core = ((build && build.core) || []).filter((c) => c.pct == null || c.pct >= 0.3).slice(0, 6);
    return {
      hero,
      source: build ? build.source : null,
      items: core.map((c) => {
        const a = ITEM_ANSWERS[c.key];
        return {
          key: c.key, name: c.name, time: c.time, pct: c.pct,
          answer: a ? { why: a.why, items: a.answer.filter((k) => items.has(k)).map((k) => ({ key: k, name: items.get(k).name })) } : null,
        };
      }),
    };
  });
}

module.exports = { globalItemsSql, vsItemsSql, itemLifts, counterItems, enemyPredictions, ITEM_ANSWERS };

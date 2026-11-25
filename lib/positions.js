// Positions 1-5 in pro matches: the lane a player was in plus their farm rank within the team.
const POSITIONS = [
  { pos: 1, name: 'Carry' },
  { pos: 2, name: 'Mid' },
  { pos: 3, name: 'Offlane' },
  { pos: 4, name: 'Support 4' },
  { pos: 5, name: 'Support 5' },
];

const validPos = (p) => (Number(p) >= 1 && Number(p) <= 5 ? Number(p) : null);

// CTE "pos (match_id, player_slot, position)" for every pro game of the hero since `since`.
function positionCte(heroId, since) {
  const id = Number(heroId) | 0;
  const t = Number(since) | 0;
  return `hm AS (
  SELECT pm.match_id FROM player_matches pm JOIN matches m USING (match_id)
  WHERE pm.hero_id = ${id} AND m.start_time >= ${t}
), team AS (
  SELECT p.match_id, p.player_slot, p.hero_id, p.lane_role,
         rank() OVER (PARTITION BY p.match_id, p.player_slot < 128 ORDER BY p.gold_per_min DESC, p.player_slot) AS farm
  FROM player_matches p WHERE p.match_id IN (SELECT match_id FROM hm)
), pos AS (
  SELECT match_id, player_slot, CASE
    WHEN lane_role IS NULL THEN farm
    WHEN farm <= 3 AND lane_role = 2 THEN 2
    WHEN farm <= 3 AND lane_role = 3 THEN 3
    WHEN farm <= 3 THEN 1
    WHEN lane_role = 3 THEN 4
    WHEN lane_role = 1 THEN 5
    ELSE farm END AS position
  FROM team WHERE hero_id = ${id}
)`;
}

function positionsSql(heroId, since) {
  return `WITH ${positionCte(heroId, since)}
SELECT position, count(*) AS games FROM pos GROUP BY position ORDER BY position`;
}

// Share of games per position; the most played one is the default.
function positionShares(rows) {
  const total = rows.reduce((s, r) => s + Number(r.games), 0);
  const list = POSITIONS.map((p) => {
    const r = rows.find((x) => Number(x.position) === p.pos);
    const games = r ? Number(r.games) : 0;
    return { ...p, games, share: total ? games / total : 0 };
  });
  const best = [...list].sort((a, b) => b.games - a.games)[0];
  return { games: total, positions: list, main: total ? best.pos : null };
}

module.exports = { POSITIONS, validPos, positionCte, positionsSql, positionShares };

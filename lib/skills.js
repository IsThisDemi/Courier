// Pro skill order: the most common ability at each level across recent pro games.
const fs = require('fs');
const path = require('path');
const { positionCte, validPos } = require('./positions');

const NAMES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'data', 'ability-names.json'), 'utf8'));

function skillSql(heroId, opts = {}) {
  const pos = validPos(opts.pos);
  return `WITH ${positionCte(heroId, opts.since)}
SELECT pm.ability_upgrades_arr AS arr FROM pos JOIN player_matches pm USING (match_id, player_slot) JOIN matches m USING (match_id)
WHERE pm.ability_upgrades_arr IS NOT NULL${pos ? ` AND pos.position = ${pos}` : ''}
ORDER BY m.start_time DESC LIMIT 120`;
}

const cleanName = (s) => String(s || '').replace(/\{s:[^}]+\}/g, '').replace(/^\+\s*%?\s*/, '+').replace(/\s+/g, ' ').trim();

// Picks the commonest ability per level, but never more often than any pro levelled it.
function skillBuild(rows) {
  const arrays = rows.map((r) => (Array.isArray(r.arr) ? r.arr.map(Number) : [])).filter((a) => a.length);
  if (arrays.length < 5) return { games: arrays.length, sequence: [] };
  const cap = new Map();
  for (const a of arrays) {
    const counts = new Map();
    for (const id of a) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, n] of counts) cap.set(id, Math.max(cap.get(id) || 0, n));
  }
  const used = new Map();
  const sequence = [];
  for (let pos = 0; pos < 30; pos++) {
    const reaching = arrays.filter((a) => a.length > pos);
    if (reaching.length < arrays.length * 0.3) break;
    const votes = new Map();
    for (const a of reaching) votes.set(a[pos], (votes.get(a[pos]) || 0) + 1);
    const ranked = [...votes.entries()].sort((x, y) => y[1] - x[1]);
    const pick = ranked.find(([id]) => (used.get(id) || 0) < (cap.get(id) || 1) && NAMES[id]);
    if (!pick) break;
    used.set(pick[0], (used.get(pick[0]) || 0) + 1);
    const [name, dname] = NAMES[pick[0]];
    sequence.push({ level: pos + 1, id: pick[0], name, label: cleanName(dname), talent: name.startsWith('special_bonus'), share: pick[1] / reaching.length });
  }
  return { games: arrays.length, sequence };
}

module.exports = { skillSql, skillBuild, cleanName };

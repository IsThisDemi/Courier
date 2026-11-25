// Game patches: pro data is read from the current patch, widened to older ones only when it is too thin.
const fs = require('fs');
const path = require('path');

const BUNDLED = path.join(__dirname, '..', 'renderer', 'data', 'patch.json');

function patchList(raw) {
  let list = Array.isArray(raw) && raw.length ? raw : [];
  if (!list.length) { try { list = JSON.parse(fs.readFileSync(BUNDLED, 'utf8')); } catch {} }
  return list
    .map((p) => ({ name: String(p.name), since: Math.floor(Date.parse(p.date) / 1000) }))
    .filter((p) => p.name && Number.isFinite(p.since))
    .sort((a, b) => b.since - a.since);
}

// Current patch first, then the current plus one and two older patches.
function windows(list, depth = 3) {
  const out = [];
  for (let i = 0; i < Math.min(depth, list.length); i++) {
    out.push({ latest: list[0].name, name: i ? `${list[i].name}–${list[0].name}` : list[0].name, since: list[i].since, widened: i > 0 });
  }
  return out;
}

// Runs query(since) on wider windows until it has enough games; returns the result with its window.
async function withPatch(wins, minGames, query) {
  let last = null;
  for (const w of wins) {
    const res = await query(w.since);
    last = { ...res, patch: w };
    if ((Number(res.games) || 0) >= minGames) return last;
  }
  return last;
}

module.exports = { patchList, windows, withPatch };

// Writes renderer/data/neutral-tiers.json from the game's neutral_items.txt (SteamDatabase mirror).
// Usage: node scripts/fetch-neutral-tiers.js [path/to/neutral_items.txt]
const fs = require('fs');
const path = require('path');

const URL = 'https://raw.githubusercontent.com/SteamDatabase/GameTracking-Dota2/master/game/dota/pak01_dir/scripts/npc/neutral_items.txt';
const OUT = path.join(__dirname, '..', 'renderer', 'data', 'neutral-tiers.json');

// Minimal Valve KeyValues reader: quoted keys, quoted values, nested blocks.
function parseKv(text) {
  const tokens = [...text.replace(/\/\/[^\n]*/g, '').matchAll(/"([^"]*)"|([{}])/g)].map((m) => m[2] || { s: m[1] });
  let i = 0;
  const block = () => {
    const obj = {};
    while (i < tokens.length && tokens[i] !== '}') {
      const key = tokens[i++].s;
      if (tokens[i] === '{') { i++; obj[key] = block(); i++; } else obj[key] = tokens[i++].s;
    }
    return obj;
  };
  return block();
}

function tiersFrom(kv) {
  const tiers = (kv.neutral_items || kv).neutral_tiers || {};
  const out = { tiers: [] };
  for (const [n, t] of Object.entries(tiers)) {
    const artifacts = [];
    for (const pool of Object.values(t.item_pools || {})) for (const k of Object.keys(pool.items || {})) artifacts.push(k.replace(/^item_/, ''));
    const enhancements = {};
    for (const [attr, list] of Object.entries(t.enhancements || {})) {
      enhancements[attr] = Object.entries(list).map(([k, lvl]) => ({ key: k.replace(/^item_/, ''), level: Number(lvl) }));
    }
    out.tiers.push({ tier: Number(n), start: t.start_time || null, artifacts: [...new Set(artifacts)], enhancements });
  }
  out.tiers.sort((a, b) => a.tier - b.tier);
  return out;
}

(async () => {
  const text = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await (await fetch(URL)).text();
  const out = tiersFrom(parseKv(text));
  if (!out.tiers.length) throw new Error('no neutral tiers found');
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`[neutral] ${out.tiers.length} tiers, ${out.tiers.reduce((s, t) => s + t.artifacts.length, 0)} artifacts -> ${OUT}`);
})().catch((e) => { console.error('[neutral] ' + e.message); process.exit(1); });

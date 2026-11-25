// Scarica i ritratti 256x144 in renderer/data/portraits/ (SOLO per verifica visiva).
// Uso: node scripts/fetch-portraits.js
const fs = require('fs');
const path = require('path');

const CDN = 'https://cdn.cloudflare.steamstatic.com';
const ROOT = path.join(__dirname, '..');
const HEROES = require(path.join(ROOT, 'renderer', 'data', 'heroes.json'));
const DIR = path.join(ROOT, 'renderer', 'data', 'portraits');
fs.mkdirSync(DIR, { recursive: true });

(async () => {
  let ok = 0, skip = 0; const ko = [];
  for (const [k, v] of Object.entries(HEROES)) {
    if (!v || typeof v !== 'object') continue;
    const npc = v.name || k;
    if (typeof npc !== 'string' || !npc.startsWith('npc_dota_hero_')) continue;
    const short = npc.replace('npc_dota_hero_', '');
    const file = path.join(DIR, short + '.png');
    if (fs.existsSync(file) && fs.statSync(file).size > 2000) { skip++; continue; }
    const url = CDN + (v.img || `/apps/dota2/images/dota_react/heroes/${short}.png`);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('http ' + r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      ok++;
    } catch (e) { ko.push(short); }
  }
  console.log(`ritratti: ${ok} scaricati, ${skip} gia' presenti, ${ko.length} ko ${ko.slice(0, 8).join(',')}`);
})().catch((e) => { console.error('ERRORE:', e.message); process.exit(1); });

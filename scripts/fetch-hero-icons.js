// Scarica UNA VOLTA le icone eroe piccole (4 KB l'una) in renderer/data/hero-icons/.
// Cosi' l'app non fa nessuna richiesta esterna per le immagini.
// Uso: node scripts/fetch-hero-icons.js
const fs = require('fs');
const path = require('path');

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons';
const ROOT = path.join(__dirname, '..');
const HEROES = require(path.join(ROOT, 'renderer', 'data', 'heroes.json'));
const DIR = path.join(ROOT, 'renderer', 'data', 'hero-icons');
fs.mkdirSync(DIR, { recursive: true });

(async () => {
  let ok = 0, skip = 0, ko = [];
  const entries = Object.entries(HEROES);
  for (const [k, v] of entries) {
    const npc = (v && v.name) || k;
    if (!npc.startsWith('npc_dota_hero_')) continue;
    const short = npc.replace('npc_dota_hero_', '');
    const file = path.join(DIR, short + '.png');
    if (fs.existsSync(file) && fs.statSync(file).size > 500) { skip++; continue; }
    try {
      const r = await fetch(`${CDN}/${short}.png`);
      if (!r.ok) throw new Error('http ' + r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      ok++;
    } catch (e) { ko.push(short); }
  }
  console.log(`icone: ${ok} scaricate, ${skip} gia' presenti, ${ko.length} ko ${ko.slice(0, 5).join(',')}`);
  const tot = fs.readdirSync(DIR).reduce((s, f) => s + fs.statSync(path.join(DIR, f)).size, 0);
  console.log(`cartella: ${(tot / 1024).toFixed(0)} KB`);
})().catch((e) => { console.error('ERRORE:', e.message); process.exit(1); });

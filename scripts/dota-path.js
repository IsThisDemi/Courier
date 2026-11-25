// Risolve il percorso di installazione di Dota 2 su Windows.
// Cerca in ordine: librerie Steam note, poi variabili d'ambiente.
const fs = require('fs');
const os = require('os');
const path = require('path');

const KNOWN = [
  'F:\\SteamLibrary\\steamapps\\common\\dota 2 beta',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta',
  'C:\\Program Files\\Steam\\steamapps\\common\\dota 2 beta',
  'G:\\SteamLibrary\\steamapps\\common\\dota 2 beta',
  path.join(os.homedir(), 'Library', 'Application Support', 'Steam', 'steamapps', 'common', 'dota 2 beta'),
  path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'common', 'dota 2 beta'),
  path.join(os.homedir(), '.local', 'share', 'Steam', 'steamapps', 'common', 'dota 2 beta'),
];

function extraFromVdf() {
  const vdfs = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf',
    'C:\\Program Files\\Steam\\steamapps\\libraryfolders.vdf',
    path.join(os.homedir(), 'Library', 'Application Support', 'Steam', 'steamapps', 'libraryfolders.vdf'),
    path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'libraryfolders.vdf'),
  ];
  const out = [];
  for (const vdf of vdfs) {
    try {
      const txt = fs.readFileSync(vdf, 'utf8');
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(txt))) {
        const base = m[1].replace(/\\\\/g, '\\');
        out.push(path.join(base, 'steamapps', 'common', 'dota 2 beta'));
      }
    } catch {}
  }
  return out;
}

function resolveDotaPath(hint) {
  const candidates = [];
  if (hint) candidates.push(hint);
  if (process.env.DOTA_PATH) candidates.push(process.env.DOTA_PATH);
  candidates.push(...extraFromVdf(), ...KNOWN);
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(path.join(c, 'game', 'dota'))) return c;
    } catch {}
  }
  return null;
}

module.exports = { resolveDotaPath, KNOWN };

// Scrive/rimuove il file gamestate_integration di Courier (l'app lo fa anche da sola al primo avvio).
// Uso: node scripts/install-gsi.js [--remove] [--port 51234] [--path "F:\..."]
const { install, remove } = require('../lib/gsi-install');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const pathIdx = args.indexOf('--path');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) || 51234 : Number(process.env.COURIER_PORT || process.env.DOTA_COMPANION_PORT || 51234);
const hint = pathIdx >= 0 ? args[pathIdx + 1] : null;

if (args.includes('--remove')) {
  const r = remove({ hint });
  if (!r.ok) { console.error('[gsi] Cartella Dota 2 non trovata.'); process.exit(1); }
  console.log(r.removed.length ? '[gsi] Rimosso ' + r.removed.join(', ') : '[gsi] Niente da rimuovere.');
  process.exit(0);
}

const r = install({ port, hint });
if (!r.ok) {
  console.error('[gsi] Cartella Dota 2 non trovata.');
  console.error('      Passa il percorso a mano: node scripts/install-gsi.js --path "F:\\SteamLibrary\\steamapps\\common\\dota 2 beta"');
  process.exit(1);
}
console.log('[gsi] Installato: ' + r.file);
console.log('[gsi] Dota trovata in: ' + r.dota);
console.log('[gsi] IMPORTANTE: nelle opzioni di avvio di Dota 2 su Steam aggiungi: -gamestateintegration');
console.log('[gsi] Poi avvia prima Courier e dopo Dota 2.');

// Il file gamestate_integration che dice a Dota dove mandare lo stato della partita.
// Lo usano sia l'app (al primo avvio e dal menu dell'icona) sia scripts/install-gsi.js.
const fs = require('fs');
const path = require('path');
const { resolveDotaPath } = require('../scripts/dota-path');

const FILE_NAME = 'gamestate_integration_courier.cfg';
// Il nome che aveva quando l'app si chiamava Dota Companion: si toglie, se no Dota manda tutto due volte.
const LEGACY_NAMES = ['gamestate_integration_dotacompanion.cfg'];
const BLOCKS = ['provider', 'map', 'player', 'hero', 'abilities', 'items', 'events', 'draft', 'buildings',
  'roshan', 'couriers', 'neutralitems', 'minimap', 'wearables', 'league'];

function configText(port) {
  const data = BLOCKS.map((b) => `    "${b}"${' '.repeat(Math.max(1, 13 - b.length))}"1"`).join('\n');
  return `"Courier GSI v1.0"
{
  "uri"       "http://127.0.0.1:${port}/gsi"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.2"
  "heartbeat" "10.0"
  "data"
  {
${data}
  }
}
`;
}

function cfgDir(dota) {
  return path.join(dota, 'game', 'dota', 'cfg', 'gamestate_integration');
}

/** Dove sta Dota e se il file c'e' gia' ed e' aggiornato. */
function status({ port, hint } = {}) {
  const dota = resolveDotaPath(hint);
  if (!dota) return { dota: null, installed: false, current: false };
  const file = path.join(cfgDir(dota), FILE_NAME);
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  return { dota, file, installed: text !== null, current: text === configText(port) };
}

function install({ port, hint } = {}) {
  const dota = resolveDotaPath(hint);
  if (!dota) return { ok: false, error: 'Dota 2 folder not found' };
  const dir = cfgDir(dota);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE_NAME);
  fs.writeFileSync(file, configText(port), 'utf8');
  for (const old of LEGACY_NAMES) {
    try { fs.unlinkSync(path.join(dir, old)); } catch {}
  }
  return { ok: true, dota, file };
}

function remove({ hint } = {}) {
  const dota = resolveDotaPath(hint);
  if (!dota) return { ok: false, error: 'Dota 2 folder not found' };
  const removed = [];
  for (const name of [FILE_NAME, ...LEGACY_NAMES]) {
    const file = path.join(cfgDir(dota), name);
    try { fs.unlinkSync(file); removed.push(file); } catch {}
  }
  return { ok: true, dota, removed };
}

module.exports = { status, install, remove, configText, FILE_NAME };

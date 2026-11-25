// Hero and item constants from the bundled dotaconstants snapshot.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'renderer', 'data');

let cache = null;

function load() {
  if (cache) return cache;
  const rawHeroes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf8'));
  const rawItems = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json'), 'utf8'));
  const heroesById = new Map();
  const heroesByNpc = new Map();
  for (const h of Object.values(rawHeroes)) {
    if (!h || !h.id || typeof h.name !== 'string') continue;
    const hero = {
      id: h.id,
      npc: h.name,
      short: h.name.replace('npc_dota_hero_', ''),
      name: h.localized_name || h.name,
      attr: h.primary_attr || null,
      roles: h.roles || [],
      attack: h.attack_type || null,
    };
    heroesById.set(hero.id, hero);
    heroesByNpc.set(hero.npc, hero);
  }
  const items = new Map();
  const itemsById = new Map();
  for (const [key, v] of Object.entries(rawItems)) {
    if (!v || typeof v !== 'object') continue;
    const item = {
      key,
      id: v.id || null,
      name: v.dname || key.replace(/_/g, ' '),
      cost: v.cost || 0,
      qual: v.qual || null,
      components: Array.isArray(v.components) ? v.components : null,
    };
    items.set(key, item);
    if (item.id) itemsById.set(item.id, item);
  }
  cache = { heroesById, heroesByNpc, items, itemsById };
  return cache;
}

function heroByAny(value) {
  const { heroesById, heroesByNpc } = load();
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) return heroesById.get(Number(value)) || null;
  const s = String(value).trim().toLowerCase();
  if (heroesByNpc.has(s)) return heroesByNpc.get(s);
  if (heroesByNpc.has('npc_dota_hero_' + s)) return heroesByNpc.get('npc_dota_hero_' + s);
  for (const h of heroesById.values()) {
    if (h.name.toLowerCase() === s || h.short.replace(/_/g, ' ') === s) return h;
  }
  return null;
}

module.exports = { load, heroByAny };

// Static hero and item data shared by every view.
const heroes = new Map();
const heroesByNpc = new Map();
const items = new Map();
const itemsByName = new Map();

export async function loadData() {
  const [h, it] = await Promise.all([
    fetch('data/heroes.json').then((r) => r.json()),
    fetch('data/items.json').then((r) => r.json()),
  ]);
  for (const v of Object.values(h)) {
    if (!v || !v.id || typeof v.name !== 'string') continue;
    const hero = { id: v.id, npc: v.name, short: v.name.replace('npc_dota_hero_', ''), name: v.localized_name, attr: v.primary_attr, roles: v.roles || [] };
    heroes.set(hero.id, hero);
    heroesByNpc.set(hero.npc, hero);
  }
  for (const [key, v] of Object.entries(it)) {
    if (!v || !v.dname) continue;
    const item = { key, name: v.dname, cost: v.cost || 0 };
    items.set(key, item);
    itemsByName.set(v.dname.toLowerCase(), item);
  }
}

export const hero = (id) => heroes.get(Number(id)) || null;
export const heroByNpc = (npc) => heroesByNpc.get(npc) || null;
export const allHeroes = () => [...heroes.values()].sort((a, b) => a.name.localeCompare(b.name));
export const heroName = (id) => (hero(id) ? hero(id).name : `#${id}`);
export const portrait = (id) => (hero(id) ? `data/portraits/${hero(id).short}.png` : '');
export const item = (key) => items.get(key) || null;
export const itemByName = (name) => itemsByName.get(String(name).toLowerCase()) || null;
export const itemImg = (key) => `/img/item/${key}.png`;
export const abilityImg = (name) => `/img/ability/${name}.png`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fmtClock = (s) => {
  const v = Math.round(Math.abs(s));
  return `${s < 0 ? '-' : ''}${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
export const fmtSigned = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

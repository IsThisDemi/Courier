// Items tab: pro build for the player's hero and answers to the enemy lineup.
import { heroName, portrait, itemImg, itemByName, abilityImg, esc } from './data.js';

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const minutes = (s) => `${Math.max(1, Math.round(s / 60))}′`;

export function ownedKeys(snap) {
  const owned = new Set();
  const it = (snap && snap.items) || {};
  for (const s of [...(it.inventory || []), ...(it.backpack || [])]) if (s) owned.add(s.key);
  if (snap && snap.hero) {
    if (snap.hero.scepter) owned.add('ultimate_scepter');
    if (snap.hero.shard) owned.add('aghanims_shard');
  }
  return owned;
}

const POS_NAMES = { 1: 'Carry', 2: 'Mid', 3: 'Offlane', 4: 'Support 4', 5: 'Support 5' };
export const posName = (p) => (p ? `pos ${p} ${POS_NAMES[p]}` : '');

export function patchText(patch) {
  if (!patch) return '';
  return patch.widened ? `patch ${patch.name}: sulla ${patch.latest} ci sono ancora poche partite` : `patch ${patch.latest}`;
}

function source(build) {
  if (build.source === 'pro') {
    const d = build.oldest ? new Date(build.oldest * 1000) : null;
    const where = build.pos ? ` in ${posName(build.pos)}` : '';
    return `Ultime ${build.games} partite pro${where}${d ? `, dal ${d.getDate()} ${MONTHS[d.getMonth()]}` : ''}. ${patchText(build.patch).replace(/^./, (c) => c.toUpperCase())}.`;
  }
  return 'Poche partite pro con questo eroe: uso gli acquisti delle partite pubbliche, senza filtro di patch e posizione.';
}

// Position chips: the same hero builds differently as carry or support.
export function renderPosition(el, { heroId, data, chosen }) {
  if (!heroId) { el.innerHTML = ''; return; }
  const list = (data && data.positions) || [1, 2, 3, 4, 5].map((pos) => ({ pos, name: POS_NAMES[pos], games: 0, share: 0 }));
  el.innerHTML = `<div class="pos-pick"><span class="pos-label">La tua posizione</span><div class="chips" role="radiogroup" aria-label="Posizione">
    ${list.map((p) => `<button class="chip pos-chip" role="radio" aria-checked="${p.pos === chosen}" data-pos="${p.pos}"${data && !p.games ? ' data-rare' : ''}
      title="${esc(posName(p.pos))}${data ? `: ${p.games} partite pro (${Math.round(p.share * 100)}%)` : ''}"><b>${p.pos}</b><span>${esc(p.name)}</span><small>${data ? `${Math.round(p.share * 100)}%` : '&nbsp;'}</small></button>`).join('')}
    </div></div>`;
}

export function renderBuild(el, { heroId, build, loading, error, snap, counters }) {
  if (!heroId) {
    el.innerHTML = '<p class="empty" style="margin-top:18px">La build compare quando scegli il tuo eroe. Per provarla senza Dota, aggiungi il tuo eroe come primo alleato nella scheda Draft.</p>';
    return;
  }
  const head = `<div class="build-head"><img class="portrait" src="${portrait(heroId)}" alt="" />
    <div><h2>${esc(heroName(heroId))}</h2><div class="build-source">${build ? source(build) : loading ? 'Carico la build dei pro…' : ''}</div></div></div>`;
  if (!build) {
    el.innerHTML = head + (error ? `<p class="empty">Build non disponibile: ${esc(error)}. Riprovo tra poco.</p>` : '');
    return;
  }
  const owned = ownedKeys(snap);
  const nextKey = (build.core.find((c) => !owned.has(c.key)) || {}).key;
  const start = build.starting.length ? `<div class="section"><div class="section-head"><h2>Si parte con</h2></div><div class="start-items">
    ${build.starting.map((s) => `<div class="start-item" title="${esc(s.name)}"><div class="item"><img src="${itemImg(s.key)}" alt="${esc(s.name)}" /></div>
      ${s.qty > 1 ? `<span class="qty">×${s.qty}</span>` : ''}${s.pct != null ? `${Math.round(s.pct * 100)}%` : ''}</div>`).join('')}</div></div>` : '';
  const core = build.core.length ? `<div class="section"><div class="section-head"><h2>Ordine degli acquisti</h2></div><ol class="timeline">
    ${build.core.map((c) => `<li class="step"${owned.has(c.key) ? ' data-owned' : ''}${c.key === nextKey ? ' data-next' : ''}>
      <span class="step-time">${minutes(c.time)}</span><span class="step-node" aria-hidden="true"></span>
      <div class="item"><img src="${itemImg(c.key)}" alt="" /></div>
      <span class="step-name">${esc(c.name)}${owned.has(c.key) ? '<small>ce l\'hai</small>' : c.key === nextKey ? '<small>il prossimo</small>' : ''}</span>
      <span class="step-pct" title="Comprato nel ${c.pct != null ? Math.round(c.pct * 100) : '?'}% delle partite">${c.pct != null ? `${Math.round(c.pct * 100)}%` : ''}</span>
    </li>`).join('')}</ol></div>` : '';
  const vsOf = counterMap(counters);
  const late = laterChoices(build, owned, counters);
  const sit = late.length ? `<div class="section"><div class="section-head"><h2>Poi, a seconda della partita</h2></div><div class="later">
    ${late.map((s) => `<div class="later-item"${owned.has(s.key) ? ' data-owned' : ''}${vsOf.has(s.key) ? ' data-vs' : ''} title="${esc(s.name)}: comprato nel ${Math.round(s.pct * 100)}% delle partite pro${s.late ? ` arrivate al ${Math.round(s.time / 60)}′` : ''}">
      <span class="step-time">${minutes(s.time)}</span><div class="item"><img src="${itemImg(s.key)}" alt="" /></div>
      <span class="step-name">${esc(s.name)}<small>${owned.has(s.key) ? 'ce l\'hai' : vsOf.has(s.key) ? `utile contro ${esc(vsOf.get(s.key))}` : `${Math.round(s.pct * 100)}%${s.late ? ' delle partite lunghe' : ''}`}</small></span></div>`).join('')}
    </div><p class="fine">Finita la build fissa, i pro scelgono uno o due di questi in base alla partita. In cima quelli utili contro i tuoi nemici.</p></div>` : '';
  el.innerHTML = head + start + core + sit;
}

// Answers to the enemy lineup: pro data first, the hand-written threat table only as a fallback.
// Consumables any hero can buy; everything else must be in the hero's own item pool.
const ANYONE = new Set(['dust', 'ward_sentry', 'ward_observer', 'gem', 'smoke_of_deceit']);
export function renderCounterItems(el, { enemies, data, loading }) {
  if (!enemies.length) { el.innerHTML = '<p class="empty">Aggiungi i nemici nella scheda Draft per sapere cosa comprare contro di loro.</p>'; return; }
  const fromData = (data && data.counters) || [];
  const pool = data && data.pool ? new Set(data.pool) : null;
  const rows = fromData.map((c) => ({
    key: c.key, name: c.name,
    why: c.vs.map((v) => `${heroName(v.id)} ${v.ratio >= 1.15 ? `×${String(v.ratio).replace('.', ',')}` : ''}`.trim()).join(', '),
    data: true,
  }));
  if (rows.length < 3) {
    const rules = window.COUNTER_RULES || [];
    const threats = window.HERO_THREATS || {};
    for (const e of enemies) {
      for (const t of threats[e.npc] || []) {
        const rule = rules.find((r) => r.id === t);
        if (!rule) continue;
        for (const name of rule.items) {
          const it = itemByName(name);
          if (!it || rows.some((r) => r.key === it.key)) continue;
          if (pool && !pool.has(it.key) && !ANYONE.has(it.key)) continue;
          rows.push({ key: it.key, name, why: `${rule.why}: ${heroName(e.id)}`, data: false });
        }
      }
    }
  }
  if (!rows.length) {
    el.innerHTML = `<p class="empty">${loading ? 'Cerco cosa comprano i pro contro questi eroi…' : 'Nessun oggetto spicca contro questa formazione.'}</p>`;
    return;
  }
  el.innerHTML = rows.slice(0, 8).map((r) => `<div class="counter-item"><div class="item"><img src="${itemImg(r.key)}" alt="" /></div>
    <div><b>${esc(r.name)}</b><small>${r.data ? `I pro lo comprano più spesso contro ${esc(r.why)}` : esc(r.why)}</small></div></div>`).join('') +
    (fromData.length ? `<p class="fine">${data.forHero ? `Solo oggetti che i pro comprano su ${esc(heroName(data.forHero))}. ` : 'Scegli il tuo eroe per vedere solo gli oggetti adatti a lui. '}×2,5 vuol dire che contro quell'eroe i pro lo hanno nell'inventario finale 2,5 volte più spesso del solito, nelle ultime patch.</p>` : '');
}

// Neutral artifacts and enchantments per tier, from what pros had at the end of their games.
export function renderNeutrals(section, el, { data, clock }) {
  const tiers = (data && data.tiers) || [];
  section.hidden = !data || !data.games;
  if (section.hidden) { el.innerHTML = ''; return; }
  const startSec = (t) => { const [m, s] = String(t.start || '0:00').split(':').map(Number); return m * 60 + (s || 0); };
  const current = tiers.filter((t) => clock >= startSec(t)).pop();
  const pct = (x) => `${Math.round(x.share * 100)}%`;
  const chip = (x) => `<span class="neu" title="${esc(x.name)}: ${x.games} partite pro"><span class="item"><img src="${itemImg(x.key)}" alt="" /></span><b>${esc(x.name)}</b>${pct(x)}</span>`;
  const ench = (data.enchantments || []).slice(0, 4);
  el.innerHTML = tiers.map((t) => {
    const arts = t.artifacts.filter((x) => x.games).slice(0, 3);
    return `<div class="neu-tier"${current && current.tier === t.tier ? ' data-now' : ''}>
      <div class="neu-head"><b>Livello ${t.tier}</b><small>dal ${esc(t.start || '')}</small></div>
      ${arts.length ? `<div class="neu-row">${arts.map(chip).join('')}</div>`
        : `<p class="fine">${data.fromHistory ? 'Poche partite pro arrivano a questo livello.' : 'Nessun dato: le partite pro di solito finiscono con un neutrale di un altro livello.'}</p>`}
    </div>`;
  }).join('') +
    (ench.length ? `<div class="neu-tier" data-wide><div class="neu-head"><b>Incantamenti</b><small>tra quelli offerti a questo eroe</small></div><div class="neu-row">${ench.map(chip).join('')}</div></div>` : '') +
    `<p class="fine">${data.fromHistory ? 'Cosa scelgono i pro a ogni livello (percentuale sulle partite arrivate a quel livello)' : 'Il neutrale che i pro avevano a fine partita'}, su ${data.games} partite${data.pos ? ` in ${esc(posName(data.pos))}` : ''}, ${esc(patchText(data.patch))}.</p>`;
}

export function renderPredictions(section, el, { data, clock }) {
  const preds = ((data && data.predictions) || []).filter((p) => p.items.length);
  section.hidden = !preds.length;
  el.innerHTML = preds.map((p) => `<div class="prediction">
      <img class="portrait" src="${portrait(p.hero)}" alt="" />
      <div><b>${esc(heroName(p.hero))}</b>
        <div class="pred-items">${p.items.map((i) => `<span class="pred-item"${clock && i.time < clock ? ' data-past' : ''} title="${esc(i.name)}, di solito verso il minuto ${Math.round(i.time / 60)}">
          <span class="item"><img src="${itemImg(i.key)}" alt="" /></span>${minutes(i.time)}</span>`).join('')}</div>
        ${p.items.filter((i) => i.answer && i.answer.items.length).map((i) => `<small>${esc(i.name)} (${esc(i.answer.why)}): rispondi con ${i.answer.items.map((a) => esc(a.name)).join(' o ')}</small>`).join('')}
      </div></div>`).join('') +
    (preds.length ? '<p class="fine">Tempi tipici delle build dei pro per quegli eroi: è una stima, non quello che hanno davvero.</p>' : '');
}

// Next skill point: compares the player's ability levels with the pro order up to the current level.
export function nextSkill(skills, snap) {
  const seq = (skills && skills.sequence) || [];
  const hero = snap && snap.hero;
  if (!seq.length || !hero || !hero.level) return null;
  const mine = new Map(((snap && snap.abilities) || []).map((a) => [a.name, a.level]));
  const upToNow = seq.slice(0, hero.level);
  const expectedTalents = upToNow.filter((s) => s.talent).length;
  const talents = hero.talents != null ? hero.talents : expectedTalents;
  const skillNames = new Set(seq.filter((s) => !s.talent).map((s) => s.name));
  const levelsSpent = [...skillNames].reduce((sum, n) => sum + (mine.get(n) || 0), 0);
  if (Math.min(hero.level, seq.length) - levelsSpent - talents <= 0) return null;
  const seen = new Map();
  let talentSeen = 0;
  for (const step of upToNow) {
    if (step.talent) { if (++talentSeen > talents) return step; continue; }
    seen.set(step.name, (seen.get(step.name) || 0) + 1);
    if (seen.get(step.name) > (mine.get(step.name) || 0)) return step;
  }
  return null;
}

export function renderSkills(section, el, { skills, snap }) {
  const seq = (skills && skills.sequence) || [];
  section.hidden = !seq.length;
  if (!seq.length) { el.innerHTML = ''; return; }
  const next = nextSkill(skills, snap);
  const level = (snap && snap.hero && snap.hero.level) || 0;
  el.innerHTML = `<div class="skill-seq">${seq.map((s) => `<div class="skill-step"${s.level <= level ? ' data-done' : ''}${next && next.level === s.level ? ' data-next' : ''} title="Livello ${s.level}: ${esc(s.label)}">
      <span class="skill-lvl">${s.level}</span>
      ${s.talent ? `<span class="skill-talent">${esc(s.label)}</span>` : `<img src="${abilityImg(s.name)}" alt="${esc(s.label)}" />`}
    </div>`).join('')}</div>
    <p class="fine">L'abilità più scelta a ogni livello nelle ultime ${skills.games} partite pro${skills.pos ? ` in ${esc(posName(skills.pos))}` : ''}, ${esc(patchText(skills.patch))}.${next ? ` Prossimo punto: <b>${esc(next.label)}</b>.` : ''}</p>`;
}

// counters (from /api/enemy-items): item key -> names of the enemies it answers.
function counterMap(counters) {
  return new Map((counters || []).map((c) => [c.key, c.vs.map((v) => heroName(v.id)).slice(0, 2).join(', ')]));
}

// After the fixed build: the situational items, the ones that answer the enemies first.
function laterChoices(build, owned, counters) {
  const vs = counterMap(counters);
  // early situational items (Bracer at 2') are lane choices, not what comes after the build
  const list = (build.situational || []).filter((s) => s.time >= 900 && !(build.core || []).some((c) => c.key === s.key));
  return [...list].sort((a, b) => (vs.has(b.key) - vs.has(a.key)) || a.time - b.time);
}

// clock: a core item more than 10 minutes late was skipped, move on.
export function nextBuy(build, snap, counters, clock = 0) {
  if (!build || !build.core) return null;
  const owned = ownedKeys(snap);
  const core = build.core.find((c) => !owned.has(c.key) && !(clock && clock > c.time + 600));
  if (core) return core;
  const vs = counterMap(counters);
  const pick = laterChoices(build, owned, counters).find((s) => !owned.has(s.key));
  return pick ? { ...pick, choice: true, against: vs.get(pick.key) || null } : null;
}

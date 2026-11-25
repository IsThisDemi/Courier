// Live tab: clock, the next-four-minutes rail, objective timers and the player's hero.
import { heroName, portrait, itemImg, abilityImg, item, esc, fmtClock } from './data.js';
import { upcoming, urgency } from './timers.js';

const PHASES = {
  DOTA_GAMERULES_STATE_INIT: 'Avvio',
  DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: 'Caricamento dei giocatori',
  DOTA_GAMERULES_STATE_HERO_SELECTION: 'Scelta degli eroi',
  DOTA_GAMERULES_STATE_STRATEGY_TIME: 'Tempo di strategia',
  DOTA_GAMERULES_STATE_TEAM_SHOWCASE: 'Presentazione delle squadre',
  DOTA_GAMERULES_STATE_PRE_GAME: 'Prima del corno',
  DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: 'Partita in corso',
  DOTA_GAMERULES_STATE_POST_GAME: 'Partita finita',
  DOTA_GAMERULES_STATE_DISCONNECT: 'Disconnesso',
};

export const inGame = (snap) => !!(snap && snap.connected && /PRE_GAME|GAME_IN_PROGRESS/.test(snap.map.gameState || ''));

export function renderClock(el, snap, clock) {
  if (!snap || !snap.connected) {
    el.innerHTML = '<div class="clock">–:––</div><div class="clock-sub">L\'orologio parte quando Dota manda la partita.</div>';
    return;
  }
  const m = snap.map;
  const night = m.daytime === false || m.nightstalkerNight;
  const running = m.gameState === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
  const phase = !running || m.paused ? `<div class="clock-sub">${PHASES[m.gameState] || 'In attesa'}${m.paused ? ', in pausa' : ''}</div>` : '';
  const score = m.radiantScore != null
    ? `<div class="score" title="Radiant contro Dire"><span class="r">${m.radiantScore}</span><span aria-hidden="true">–</span><span class="d">${m.direScore}</span></div>` : '';
  el.innerHTML = `<div class="clock">${fmtClock(clock)}</div>
    ${running ? `<span class="daynight" data-night="${night}" title="${night ? 'Notte' : 'Giorno'}">${night ? '☾' : '☀'}</span>` : ''}
    ${phase}${score}`;
}

// What to do now: next item, next skill point, a neutral to take. Also the whole compact mode.
export function renderNextUp(el, { next, buy, neutral }) {
  const rows = [];
  if (buy) rows.push(`<div class="next-row"><span class="item"><img src="${itemImg(buy.key)}" alt="" /></span><span><small>${buy.choice ? (buy.against ? `A scelta, contro ${esc(buy.against)}` : 'A scelta, dopo la build') : 'Compra'}</small><b>${esc(buy.name)}</b></span><em>${Math.round(buy.time / 60)}′</em></div>`);
  if (next) rows.push(`<div class="next-row">${next.talent ? '<span class="item talent-dot"></span>' : `<span class="item"><img src="${abilityImg(next.name)}" alt="" /></span>`}<span><small>Punto abilità</small><b>${esc(next.label)}</b></span><em>liv. ${next.level}</em></div>`);
  if (neutral) rows.push(`<div class="next-row"><span class="item" data-neutral><img src="${itemImg(neutral.key)}" alt="" /></span><span><small>Neutrale, livello ${neutral.tier}</small><b>${esc(neutral.name)}</b></span><em>${Math.round(neutral.share * 100)}%</em></div>`);
  el.hidden = !rows.length;
  el.innerHTML = rows.join('');
}

// The artifact pros take most at the newest tier, when the player still holds a lower one.
export function nextNeutral(data, snap, clock) {
  if (!data || !data.tiers || !inGame(snap)) return null;
  const startSec = (t) => { const [m, s] = String(t.start || '0:00').split(':').map(Number); return m * 60 + (s || 0); };
  const open = data.tiers.filter((t) => clock >= startSec(t)).pop();
  if (!open) return null;
  const held = snap.items && snap.items.neutral && snap.items.neutral.key;
  const heldTier = held ? (data.tiers.find((t) => t.artifacts.some((a) => a.key === held)) || {}).tier || 0 : 0;
  const best = open.artifacts.find((a) => a.games);
  return heldTier < open.tier && best ? { ...best, tier: open.tier } : null;
}

// Vertical time column: the gap between rows is proportional to the seconds between events.
export function renderTimeline(el, snap, clock, predictions) {
  if (!inGame(snap)) {
    el.innerHTML = '<li class="empty">Rune, Roshan e oggetti neutrali compaiono qui quando la partita inizia.</li>';
    return;
  }
  // Roshan and Aegis stay visible however far away they are; the rest covers the next five minutes.
  const enemyItems = [];
  for (const p of (predictions || [])) {
    for (const i of p.items) {
      if (i.pct != null && i.pct < 0.5) continue;
      enemyItems.push({ id: `enemy-${p.hero}-${i.key}`, label: `${heroName(p.hero)}: ${i.name}`, item: i.name, hero: heroName(p.hero), enemy: true, left: i.time - clock });
    }
  }
  const all = [...upcoming(clock, snap.roshanKilledAt, snap.roshanKills || 1), ...enemyItems].filter((t) => t.left > -5);
  const pinned = all.filter((t) => t.id === 'roshan' || t.id === 'aegis');
  const near = all.filter((t) => !pinned.includes(t) && t.left <= 330);
  const grouped = (list) => {
    const out = [];
    for (const t of list) {
      const g = out.find((gr) => Math.abs(gr.left - Math.max(0, t.left)) <= 6);
      if (g) g.items.push(t); else out.push({ left: Math.max(0, t.left), items: [t] });
    }
    return out;
  };
  const groups = grouped(near).slice(0, 7);
  for (const p of grouped(pinned)) {
    const g = groups.find((gr) => Math.abs(gr.left - p.left) <= 6);
    if (g) g.items.push(...p.items); else groups.push(p);
  }
  groups.sort((a, b) => a.left - b.left);
  let prev = 0;
  el.innerHTML = '<li class="tl-row tl-now"><span class="tl-when">adesso</span><span class="tl-node" aria-hidden="true"></span><span class="tl-what"></span></li>' + groups.map((g) => {
    const gap = Math.max(2, Math.min(28, (g.left - prev) * 0.2));
    prev = g.left;
    const us = g.items.map(urgency);
    const u = us.includes('now') ? 'now' : us.includes('soon') ? 'soon' : '';
    const when = g.items.some((t) => t.window) || g.left <= 0 ? 'ora' : fmtClock(g.left);
    const notes = g.items.filter((t) => t.note).map((t) => t.note);
    const enemyOnly = g.items.every((t) => t.enemy);
    // the same item for several enemies at the same time is one line
    const lines = [];
    for (const t of g.items) {
      const same = t.enemy && lines.find((x) => x.enemy && x.item === t.item);
      if (same) same.label = `${same.label}, ${t.hero}`;
      else lines.push(t.enemy ? { ...t, label: `${t.item}: ${t.hero}` } : t);
    }
    const short = lines.map((t) => (t.enemy ? t.label : t.short || t.label));
    return `<li class="tl-row" data-urgency="${enemyOnly ? 'enemy' : u}" style="--gap:${gap.toFixed(0)}px">
      <span class="tl-when">${enemyOnly ? '~' : ''}${when}</span><span class="tl-node" aria-hidden="true"></span>
      <span class="tl-what"><span class="tl-long">${lines.map((t) => (t.enemy ? `<span class="tl-enemy">${esc(t.label)}</span>` : esc(t.label))).join('<br>')}${notes.length ? `<small>${esc(notes.join(', '))}</small>` : ''}</span>
      <span class="tl-short">${lines.map((t, i) => (t.enemy ? `<span class="tl-enemy">${esc(short[i])}</span>` : esc(short[i]))).join(', ')}</span></span></li>`;
  }).join('');
}

export function renderRosh(el, snap) {
  if (!inGame(snap)) { el.innerHTML = ''; return; }
  el.innerHTML = snap.roshanKilledAt == null
    ? '<button class="btn" data-rosh="killed">Roshan ucciso adesso</button>'
    : `<button class="btn" data-rosh="killed">Roshan ucciso di nuovo adesso</button><button class="btn" data-rosh="reset">Togli il timer di Roshan</button>`;
}

export function renderHero(el, snap, next) {
  const h = snap && snap.hero;
  if (!h) { el.innerHTML = snap && snap.connected ? '<p class="empty">Il tuo eroe compare qui appena lo scegli.</p>' : ''; return; }
  const p = snap.player || {};
  const pct = (a, b) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
  const bbReady = !h.buybackCooldown && p.gold != null && h.buybackCost != null && p.gold >= h.buybackCost;
  const buyback = h.buybackCooldown ? `Buyback in ricarica, ${fmtClock(h.buybackCooldown)}` : bbReady ? 'Buyback pronto' : `Buyback, ti mancano ${h.buybackCost - (p.gold || 0)}`;
  const abilities = (snap.abilities || []).slice(0, 6).map((a) => `<div class="ability" data-level="${a.level}"${a.ultimate ? ' data-ult' : ''}${next && next.name === a.name ? ' data-next' : ''} title="${esc(a.name)}">
      <img src="${abilityImg(a.name)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
      ${a.cooldown > 0 ? `<span class="cooldown">${Math.ceil(a.cooldown)}</span>` : ''}
      <span class="pips">${Array.from({ length: a.ultimate ? 3 : 4 }, (_, i) => `<i${i < a.level ? ' data-on' : ''}></i>`).join('')}</span></div>`).join('');
  const it = snap.items || { inventory: [] };
  const slot = (s, extra = '') => s
    ? `<div class="item"${extra} title="${esc((item(s.key) || {}).name || s.key)}"><img src="${itemImg(s.key)}" alt="" loading="lazy" />${s.cooldown > 0 ? `<span class="cooldown">${Math.ceil(s.cooldown)}</span>` : ''}${s.charges ? `<span class="charges">${s.charges}</span>` : ''}</div>`
    : `<div class="item" data-empty${extra}></div>`;
  el.innerHTML = `<div class="hero-head">
      <img class="portrait" src="${portrait(h.id)}" alt="" />
      <div>
        <div class="hero-name">${esc(heroName(h.id))}<small>livello ${h.level ?? '?'}</small></div>
        ${h.alive ? '' : `<div class="hero-dead">Morto, rinasci tra ${h.respawn ?? '?'} s</div>`}
        <div class="meter hp" role="img" aria-label="Vita ${h.health ?? 0} su ${h.maxHealth ?? 0}"><span style="width:${pct(h.health, h.maxHealth)}%"></span><b>${h.health ?? 0} / ${h.maxHealth ?? 0}</b></div>
        <div class="meter mp" role="img" aria-label="Mana ${h.mana ?? 0} su ${h.maxMana ?? 0}"><span style="width:${pct(h.mana, h.maxMana)}%"></span><b>${h.mana ?? 0} / ${h.maxMana ?? 0}</b></div>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><b>${p.kills ?? 0}/${p.deaths ?? 0}/${p.assists ?? 0}</b>K/D/A</div>
      <div class="stat"><b>${p.lastHits ?? 0}/${p.denies ?? 0}</b>LH/DN</div>
      <div class="stat"><b class="gold">${p.gold ?? '–'}</b>Oro</div>
      <div class="stat"><b>${p.gpm ?? '–'}</b>GPM</div>
      <div class="stat"><b>${p.xpm ?? '–'}</b>XPM</div>
      <div class="stat" title="${esc(buyback)}"><b class="${bbReady ? 'pos' : h.buybackCooldown ? '' : 'neg'}">${h.buybackCost ?? '–'}</b>${bbReady ? 'Buyback pronto' : h.buybackCooldown ? `BB ${fmtClock(h.buybackCooldown)}` : `BB −${h.buybackCost - (p.gold || 0)}`}</div>
    </div>
    ${abilities ? `<div class="icons-row">${abilities}</div>` : ''}

    <div class="icons-row">${(it.inventory || []).map((s) => slot(s)).join('')}${slot(it.neutral, ' data-neutral')}</div>`;
}

const MIN = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function renderPostgame(section, el, { snap, post }) {
  const over = snap && snap.connected && /POST_GAME/.test(snap.map.gameState || '');
  section.hidden = !over;
  if (!over) { el.innerHTML = ''; return; }
  const head = '<div class="section-head"><h2>Com\'è andata</h2></div>';
  if (snap.simulated) { el.innerHTML = head + '<p class="empty">Partita simulata: OpenDota non ha niente da analizzare.</p>'; return; }
  if (!post || post.status === 'pending') {
    el.innerHTML = head + '<p class="empty">OpenDota sta scaricando la partita: di solito servono pochi minuti. Controllo da solo ogni minuto.</p>';
    return;
  }
  if (post.error || post.status === 'notfound') { el.innerHTML = head + `<p class="empty">Non trovo la partita su OpenDota${post.error ? ` (${esc(post.error)})` : ''}.</p>`; return; }
  const bench = post.benchmarks.map((b) => `<div class="bench"><span>${esc(b.label)}</span>
      <span class="bench-bar"><i style="width:${Math.round(b.pct * 100)}%"></i></span><b>${Math.round(b.pct * 100)}°</b></div>`).join('');
  const items = post.items.map((i) => `<div class="pg-item"><span class="item"><img src="${itemImg(i.key)}" alt="" /></span>
      <span>${esc(i.name)}<small>tu ${MIN(i.time)}, pro ${MIN(i.proTime)}</small></span>
      <b class="${i.delta <= 60 ? 'pos' : 'neg'}">${i.delta > 0 ? '+' : '−'}${MIN(Math.abs(i.delta))}</b></div>`).join('');
  el.innerHTML = head + `<p class="pg-result ${post.win ? 'pos' : 'neg'}">${post.win ? 'Vittoria' : 'Sconfitta'} in ${Math.round(post.duration / 60)} minuti</p>
    <div class="stats">
      <div class="stat"><b>${post.kills} / ${post.deaths} / ${post.assists}</b>Uccisioni, morti, assist</div>
      <div class="stat"><b>${post.gpm}</b>Oro al minuto</div>
      <div class="stat"><b>${post.xpm}</b>Esperienza al minuto</div>
    </div>
    ${bench ? `<h3 class="sub">Rispetto agli altri giocatori con ${esc(heroName(post.hero))}</h3>${bench}<p class="fine">Il numero è il percentile: 70° vuol dire meglio del 70% delle partite con questo eroe.</p>` : ''}
    ${items ? `<h3 class="sub">Tempi degli oggetti contro i pro</h3>${items}` : post.status === 'partial' ? '<p class="empty">I tempi degli oggetti arrivano quando OpenDota finisce di analizzare il replay.</p>' : ''}`;
}

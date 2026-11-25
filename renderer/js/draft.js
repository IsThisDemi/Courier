// Draft tab: the two team rows, pick suggestions, pro meta and known opponents.
import { hero, heroName, portrait, esc, fmtSigned } from './data.js';

const ROLES = [['', 'Tutti'], ['Carry', 'Carry'], ['Support', 'Support'], ['Initiator', 'Iniziatori'], ['Nuker', 'Nuker'], ['Durable', 'Resistenti']];
const SOURCE_LABEL = { me: 'Tu', draft: 'Dalla draft', manual: 'Aggiunto da te', screen: 'Letto dallo schermo' };

export function renderLineup(el, snap) {
  const lineup = (snap && snap.lineup) || { allies: [], enemies: [], bans: [] };
  const row = (side, label, sub) => {
    const list = lineup[side] || [];
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const e = list[i];
      if (!e) {
        slots.push(`<button class="slot" data-side="${side}" data-add aria-label="Aggiungi ${side === 'allies' ? 'un alleato' : 'un nemico'}"><span class="slot-empty">+</span><span class="slot-name">&nbsp;</span></button>`);
        continue;
      }
      const locked = e.source === 'me' || e.source === 'draft';
      slots.push(`<button class="slot" data-side="${side}" data-id="${e.id}" data-source="${e.source}"${locked ? ' data-locked' : ''} title="${esc(heroName(e.id))}: ${SOURCE_LABEL[e.source]}">
        <img class="portrait" src="${portrait(e.id)}" alt="" />${e.source === 'manual' || e.source === 'screen' ? '<span class="slot-tag"></span>' : ''}
        <span class="slot-name">${e.source === 'me' ? 'Tu' : esc(heroName(e.id))}</span></button>`);
    }
    return `<div class="team" data-side="${side}"><div class="team-name">${label}<small>${sub}</small></div><div class="slots">${slots.join('')}</div></div>`;
  };
  const team = snap && snap.player && snap.player.team;
  const enemyTeam = team === 'radiant' ? 'Dire' : team === 'dire' ? 'Radiant' : '';
  const bans = (lineup.bans || []).length
    ? `<div class="bans">Ban ${lineup.bans.map((id) => `<img src="${portrait(id)}" alt="${esc(heroName(id))}" title="${esc(heroName(id))}" />`).join('')}</div>` : '';
  let note;
  if (!snap || !snap.connected) note = 'Con Dota aperto i pick della draft arrivano da soli. Intanto puoi aggiungerli tu.';
  else if (lineup.draftLive) note = 'Draft letta dal gioco in tempo reale.';
  else if (lineup.enemies.length === 0) note = 'Il gioco non ha mandato i pick degli altri: aggiungi i nemici con +.';
  else note = 'Gli eroi con il pallino li hai aggiunti tu o sono stati letti dallo schermo.';
  el.innerHTML = row('allies', 'Alleati', team ? team[0].toUpperCase() + team.slice(1) : '') +
    row('enemies', 'Nemici', enemyTeam) + bans + `<p class="lineup-note">${note}</p>`;
}

export function renderRoleFilter(el, role, hasMine) {
  el.innerHTML = (hasMine ? [...ROLES, ['mine', 'I miei eroi']] : ROLES).map(([k, label]) => `<button class="chip" role="radio" aria-checked="${k === role}" data-role="${k}">${label}</button>`).join('');
}

// Matchup matrix: one row per candidate, one column per enemy, aligned with the lineup above.
export function renderPicks(el, data, { role, lineup, loading, error }) {
  const enemies = ((lineup && lineup.enemies) || []).map((e) => e.id);
  const allies = (lineup && lineup.allies) || [];
  if (error && !data) { el.innerHTML = `<p class="empty">OpenDota non risponde (${esc(error)}). Riprovo tra poco.</p>`; return; }
  if (!data) { el.innerHTML = `<p class="empty">${loading ? 'Calcolo i pick contro i nemici…' : 'In attesa dei dati.'}</p>`; return; }
  let picks = data.picks || [];
  if (role === 'mine') picks = picks.filter((p) => p.mine && p.mine.games >= 3);
  else if (role) picks = picks.filter((p) => (p.roles || []).includes(role));
  if (!enemies.length) {
    picks = [...picks].sort((a, b) => b.meta - a.meta).slice(0, 8);
    el.innerHTML = `<p class="empty">Aggiungi almeno un nemico per vedere i counter. Intanto, gli eroi che vincono di più nelle partite pubbliche:</p>
      <div class="meta-row">${picks.map((p) => `<div class="meta-hero"><img class="portrait" src="${portrait(p.id)}" alt="" /><b>${esc(heroName(p.id))}</b><span class="${p.meta >= 0 ? 'pos' : 'neg'}">${fmtSigned(p.meta)}</span></div>`).join('')}</div>`;
    return;
  }
  picks = picks.slice(0, 7);
  if (!picks.length) { el.innerHTML = `<p class="empty">${role === 'mine' ? 'Nessuno dei tuoi eroi tra i migliori contro questi nemici.' : 'Nessun eroe di questo ruolo tra i migliori. Prova un altro filtro.'}</p>`; return; }
  const cols = enemies.length;
  const groups = `<div class="mx-row mx-groups" style="--cols:${cols}"><span></span>
    <span class="mx-group" style="grid-column:span ${cols}">Counter: contro ogni nemico</span><span class="mx-group">Sinergia</span><span class="mx-group">Totale</span></div>`;
  const head = `<div class="mx-row mx-head" style="--cols:${cols}"><span></span>
    ${enemies.map((id) => `<img class="mx-enemy" src="${portrait(id)}" alt="${esc(heroName(id))}" title="${esc(heroName(id))}" />`).join('')}
    <span class="mx-allies" title="${esc(allies.map((a) => heroName(a.id)).join(', ') || 'Nessun alleato ancora')}">${allies.slice(0, 2).map((a) => `<img src="${portrait(a.id)}" alt="" />`).join('')}</span><span></span></div>`;
  const cell = (p, id) => {
    const v = p.vs.find((x) => x.id === id);
    if (!v) return '<span class="mx-cell" data-empty title="Pochi dati">·</span>';
    const k = Math.min(1, Math.abs(v.adv) / 12);
    const color = v.adv >= 0 ? 'var(--radiant)' : 'var(--dire)';
    return `<span class="mx-cell" style="--k:${k.toFixed(2)};--c:${color}" title="Counter: ${esc(heroName(p.id))} contro ${esc(heroName(id))}, ${fmtSigned(v.adv)} punti di winrate su ${v.games} partite pro">${Math.abs(v.adv) < 0.5 ? '0' : `${v.adv > 0 ? '+' : '−'}${Math.abs(Math.round(v.adv))}`}</span>`;
  };
  const synCell = (p) => {
    if (!p.with.length) return `<span class="mx-syn" data-empty title="${allies.length ? 'Pochi dati con questi alleati' : 'Nessun alleato scelto'}">·</span>`;
    const why = p.with.map((w) => `${heroName(w.id)} ${fmtSigned(w.adv)}`).join(', ');
    return `<span class="mx-syn ${p.synergy >= 0 ? 'pos' : 'neg'}" title="Sinergia: winrate in squadra con ${esc(why)}">${p.synergy >= 0 ? '+' : '−'}${Math.abs(Math.round(p.synergy))}</span>`;
  };
  const rows = picks.map((p) => {
    const mine = p.mine ? `tu: ${p.mine.games} partite, ${Math.round((p.mine.wins / p.mine.games) * 100)}% vinte` : '';
    const sub = mine || (p.roles || []).slice(0, 2).join(', ');
    const breakdown = `Totale ${fmtSigned(p.score)} = counter ${fmtSigned(p.counter)} + sinergia ${fmtSigned(p.synergy)} × 0,6 + meta ${fmtSigned(p.meta)} × 0,5`;
    return `<div class="mx-row" style="--cols:${cols}">
      <span class="mx-hero"><img class="portrait" src="${portrait(p.id)}" alt="" /><span><b>${esc(heroName(p.id))}</b><small>${esc(sub)}</small></span></span>
      ${enemies.map((id) => cell(p, id)).join('')}
      ${synCell(p)}
      <span class="mx-total ${p.score >= 0 ? 'pos' : 'neg'}" title="${esc(breakdown)}">${fmtSigned(p.score)}</span></div>`;
  }).join('');
  el.innerHTML = `<div class="matrix">${groups}${head}${rows}</div>
    <p class="fine"><b>Counter</b>: quanti punti di winrate in più ha l'eroe contro quel nemico nelle partite pro. <b>Sinergia</b>: punti in più quando gioca insieme ai tuoi alleati${allies.length ? '' : ' (compare quando ci sono alleati)'}. <b>Totale</b> = counter + 0,6 × sinergia + 0,5 × forma nel meta.</p>` +
    (data.missing && data.missing.length ? `<p class="empty">Mancano i dati di ${data.missing.map(heroName).join(', ')}: riprovo tra poco.</p>` : '');
}

export function renderBans(section, el, { data, snap }) {
  const gs = snap && snap.map ? snap.map.gameState || '' : '';
  const inDraft = /HERO_SELECTION|STRATEGY_TIME/.test(gs) || !snap || !snap.connected;
  const bans = (data && data.bans) || [];
  section.hidden = !inDraft || !bans.length;
  if (section.hidden) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="ban-row">${bans.map((b) => `<div class="ban" title="${esc(heroName(b.id))}">
      <img class="portrait" src="${portrait(b.id)}" alt="" /><b>${esc(heroName(b.id))}</b>
      <small>${b.beats.length ? `batte ${b.beats.slice(0, 2).map((x) => esc(heroName(x.id))).join(' e ')}` : 'tra i più contesi nel pro'}</small></div>`).join('')}</div>`;
}

export function renderPlayers(section, el, data) {
  const players = (data && data.players) || [];
  section.hidden = !players.length;
  el.innerHTML = players.map((p) => `<div class="player"><b>${esc(p.accountId)}</b>${p.error
    ? ' <span class="empty">profilo privato o non trovato</span>'
    : `<div class="player-heroes">${p.heroes.map((h) => `<span><img src="${portrait(h.id)}" alt="" />${esc(heroName(h.id))}, ${h.games} partite</span>`).join('')}</div>`}</div>`).join('');
}

export const isKnownHero = (id) => !!hero(id);

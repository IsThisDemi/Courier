// Entry point: polls the local server and keeps the three tabs up to date.
import { loadData, heroName, fmtClock, hero } from './data.js';
import { getJson, postJson, clog } from './api.js';
import { initPicker, openPicker } from './picker.js';
import { renderLineup, renderRoleFilter, renderPicks, renderPlayers, renderBans } from './draft.js';
import { renderClock, renderTimeline, renderRosh, renderHero, renderPostgame, renderNextUp, nextNeutral, inGame } from './live.js';
import { renderBuild, renderCounterItems, renderPredictions, renderSkills, renderPosition, renderNeutrals, nextSkill, nextBuy } from './items.js';
import * as screen from './screen.js';
import { initOverlay } from './overlay.js';

const $ = (id) => document.getElementById(id);
const ui = { tab: 'draft', role: localStorage.getItem('dc_role') || '' };
let snap = null;
let snapAt = 0;
let serverDown = false;
let lastGameState = null;
const suggest = { key: null, data: null, loading: false, error: null, failedAt: 0, timer: null };
const build = { hero: null, data: null, loading: false, error: null, failedAt: 0 };
const enemyItems = { key: null, data: null, loading: false, error: null, failedAt: 0 };
const skills = { hero: null, data: null, error: null, failedAt: 0 };
const neutrals = { key: null, data: null, error: null, failedAt: 0 };
// Position of the player's hero: remembered per hero, otherwise the one pros play it in most.
const position = { hero: null, data: null, chosen: null, ready: false, error: null, failedAt: 0 };
const post = { matchId: null, data: null, at: 0, busy: false };
let overlay = null;
let lastPlaying = null;

// Only touch the DOM when the markup actually changes, so images do not flicker on every tick.
const cache = new WeakMap();
function paint(el, fn, ...args) {
  const probe = { innerHTML: el.innerHTML, hidden: el.hidden };
  fn(probe, ...args);
  if (cache.get(el) !== probe.innerHTML) { el.innerHTML = probe.innerHTML; cache.set(el, probe.innerHTML); }
  el.hidden = probe.hidden;
}

function liveClock() {
  if (!snap || !snap.connected) return 0;
  const running = snap.map.gameState === 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' || snap.map.gameState === 'DOTA_GAMERULES_STATE_PRE_GAME';
  const drift = running && !snap.map.paused ? Math.min(1.5, (Date.now() - snapAt) / 1000) : 0;
  return snap.map.clock + drift;
}

// ---------- tabs ----------
function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.view').forEach((v) => { v.toggleAttribute('data-active', v.id === 'view-' + tab); });
  renderTick();
}

// ---------- lineup editing ----------
const lineupOf = () => (snap && snap.lineup) || { allies: [], enemies: [], bans: [] };
const idsBy = (side, source) => lineupOf()[side].filter((e) => e.source === source).map((e) => e.id);

async function postLineup(body) {
  try {
    const lineup = await postJson('/api/lineup', body);
    if (snap) snap.lineup = lineup; else snap = { connected: false, lineup };
    renderDraft();
  } catch (e) { clog('warn', 'lineup update failed', { err: e.message }); }
}

function editSlot(side, id, source) {
  const l = lineupOf();
  const taken = new Set([...l.allies, ...l.enemies].map((e) => e.id).concat(l.bans || []));
  const sideWord = side === 'allies' ? 'alleato' : 'nemico';
  const manual = idsBy(side, 'manual');
  const screenIds = () => ({ allies: idsBy('allies', 'screen'), enemies: idsBy('enemies', 'screen') });
  if (!id) {
    openPicker({ title: `Aggiungi un ${sideWord}`, taken, onPick: (pick) => postLineup({ side, ids: [...manual, pick] }) });
    return;
  }
  const dropScreen = () => { screen.forget(id); const s = screenIds(); s[side] = s[side].filter((x) => x !== id); return s; };
  openPicker({
    title: `Sostituisci ${heroName(id)}`,
    taken,
    onPick: (pick) => (source === 'manual'
      ? postLineup({ side, ids: manual.map((x) => (x === id ? pick : x)) })
      : postLineup({ side, ids: [...manual, pick], screen: dropScreen() })),
    onRemove: () => (source === 'manual'
      ? postLineup({ side, ids: manual.filter((x) => x !== id) })
      : postLineup({ screen: dropScreen() })),
  });
}

// ---------- suggestions and build ----------
function suggestKey() {
  const l = lineupOf();
  return [l.enemies.map((e) => e.id).join(','), l.allies.map((e) => e.id).join(','), (l.bans || []).join(',')].join('|');
}

function refreshSuggestions() {
  const key = suggestKey();
  const retry = suggest.error && Date.now() - suggest.failedAt > 20000;
  if (key === suggest.key && !retry) return;
  suggest.key = key;
  clearTimeout(suggest.timer);
  suggest.timer = setTimeout(async () => {
    const [enemies, allies, bans] = key.split('|');
    suggest.loading = true; renderDraft();
    try {
      suggest.data = await getJson(`/api/suggest?enemies=${enemies}&allies=${allies}&bans=${bans}`);
      suggest.error = null;
    } catch (e) {
      suggest.error = e.message; suggest.failedAt = Date.now();
    } finally {
      suggest.loading = false; renderDraft();
    }
  }, 300);
}

function buildHeroId() {
  if (snap && snap.hero) return snap.hero.id;
  const me = lineupOf().allies[0];
  return me ? me.id : null;
}

const storedPos = (id) => Number(localStorage.getItem('dc_pos_' + id)) || null;

async function refreshPositions() {
  const id = buildHeroId();
  const retry = position.error && Date.now() - position.failedAt > 30000;
  if (id === position.hero && !retry) return;
  if (id !== position.hero) Object.assign(position, { hero: id, data: null, chosen: id ? storedPos(id) : null, ready: false, error: null });
  if (!id) return;
  try {
    const data = await getJson(`/api/positions?hero=${id}`);
    if (position.hero !== id) return;
    position.data = data; position.error = null;
    if (!position.chosen) position.chosen = data.main || null;
  } catch (e) {
    if (position.hero === id) { position.error = e.message; position.failedAt = Date.now(); }
  } finally {
    if (position.hero === id) { position.ready = true; renderDraft(); renderItems(); refreshAll(); }
  }
}

function choosePosition(pos) {
  const id = buildHeroId();
  if (!id || !(pos >= 1 && pos <= 5)) return;
  position.chosen = pos;
  localStorage.setItem('dc_pos_' + id, String(pos));
  renderDraft(); renderItems(); refreshAll();
}

// Build, skills and neutrals wait for the position, so they are not loaded twice.
const heroPosKey = () => { const id = buildHeroId(); return id && position.hero === id && position.ready ? `${id}:${position.chosen || 0}` : null; };
const posParam = () => (position.chosen ? `&pos=${position.chosen}` : '');

async function refreshBuild() {
  const key = heroPosKey();
  const id = buildHeroId();
  const retry = build.error && Date.now() - build.failedAt > 30000;
  if (!key) { if (build.hero && build.hero !== key && !String(build.hero).startsWith(id + ':')) { build.hero = null; build.data = null; renderItems(); } return; }
  if (key === build.hero && !retry) return;
  build.hero = key;
  build.data = null; build.error = null;
  build.loading = true; renderItems();
  try {
    const data = await getJson(`/api/build?hero=${id}${posParam()}`);
    if (build.hero === key) build.data = data;
  } catch (e) {
    if (build.hero === key) { build.error = e.message; build.failedAt = Date.now(); }
  } finally {
    build.loading = false; renderItems();
  }
}

async function refreshNeutrals() {
  const key = heroPosKey();
  const retry = neutrals.error && Date.now() - neutrals.failedAt > 30000;
  if (key === neutrals.key && !retry) return;
  neutrals.key = key; neutrals.data = null;
  if (!key) { renderItems(); return; }
  try {
    const data = await getJson(`/api/neutrals?hero=${buildHeroId()}${posParam()}`);
    if (neutrals.key === key) { neutrals.data = data; neutrals.error = null; }
  } catch (e) {
    if (neutrals.key === key) { neutrals.error = e.message; neutrals.failedAt = Date.now(); }
  }
  renderItems();
}

function refreshAll() {
  refreshBuild();
  refreshEnemyItems();
  refreshSkills();
  refreshNeutrals();
}

async function refreshEnemyItems() {
  const ids = lineupOf().enemies.map((e) => e.id);
  const me = heroPosKey();
  if (buildHeroId() && !me) return;
  const key = ids.join(',') + '|' + (me || '');
  const retry = enemyItems.error && Date.now() - enemyItems.failedAt > 30000;
  if (key === enemyItems.key && !retry) return;
  enemyItems.key = key;
  if (!ids.length) { enemyItems.data = null; renderItems(); return; }
  enemyItems.loading = true; renderItems();
  try {
    const data = await getJson(`/api/enemy-items?heroes=${ids.join(',')}${me ? `&me=${buildHeroId()}${posParam()}` : ''}`);
    if (enemyItems.key === key) { enemyItems.data = data; enemyItems.error = null; }
  } catch (e) {
    if (enemyItems.key === key) { enemyItems.error = e.message; enemyItems.failedAt = Date.now(); }
  } finally { enemyItems.loading = false; renderItems(); }
}

async function refreshSkills() {
  const key = heroPosKey();
  const retry = skills.error && Date.now() - skills.failedAt > 30000;
  if (key === skills.hero && !retry) return;
  skills.hero = key; skills.data = null;
  if (!key) return;
  try {
    const data = await getJson(`/api/skills?hero=${buildHeroId()}${posParam()}`);
    if (skills.hero === key) { skills.data = data; skills.error = null; }
  } catch (e) {
    if (skills.hero === key) { skills.error = e.message; skills.failedAt = Date.now(); }
  }
  renderItems();
}

// After the game OpenDota needs a few minutes to fetch the match: retry once a minute.
async function refreshPostgame() {
  if (!snap || !snap.connected || snap.simulated || !/POST_GAME/.test(snap.map.gameState || '') || !snap.map.matchId || post.busy) return;
  const id = snap.map.matchId;
  const done = post.matchId === id && post.data && post.data.status === 'ready';
  if (done || (post.matchId === id && Date.now() - post.at < 60000)) return;
  post.busy = true;
  post.matchId = id; post.at = Date.now();
  try {
    const q = `match=${id}&hero=${snap.hero ? snap.hero.id : ''}&account=${(snap.player && snap.player.accountId) || ''}${posParam()}`;
    post.data = await getJson('/api/postgame?' + q);
  } catch (e) { post.data = { error: e.message }; }
  finally { post.busy = false; renderTick(); }
}

// ---------- rendering ----------
function renderStatus() {
  const el = $('status');
  let kind = 'waiting';
  let text = 'In attesa di Dota';
  if (serverDown) { kind = 'stale'; text = 'Il server locale non risponde'; }
  else if (snap && snap.connected) {
    const ago = (Date.now() - snap.lastSeen) / 1000;
    if (ago > 30) { kind = 'stale'; text = `Nessun dato da Dota da ${Math.round(ago / 60) || 1} min`; }
    else if (snap.simulated) { kind = 'sim'; text = 'Partita simulata'; }
    else { kind = 'live'; text = 'Collegato a Dota'; }
  }
  el.dataset.kind = kind;
  $('status-text').textContent = text;
  const bc = $('bar-clock');
  bc.hidden = !(ui.tab !== 'live' && inGame(snap));
  if (!bc.hidden) bc.textContent = fmtClock(liveClock());
}

function renderPositions() {
  const args = { heroId: buildHeroId(), data: position.data, chosen: position.chosen };
  paint($('position-draft'), renderPosition, args);
  paint($('position-items'), renderPosition, args);
}

function renderDraft() {
  paint($('lineup'), renderLineup, snap);
  renderPositions();
  paint($('role-filter'), renderRoleFilter, ui.role, !!(suggest.data && suggest.data.hasMine));
  paint($('bans'), (el, data) => renderBans($('bans-section'), el, data), { data: suggest.data, snap });
  paint($('picks'), renderPicks, suggest.data, { role: ui.role, lineup: snap && snap.lineup, loading: suggest.loading, error: suggest.error });
}

function renderItems() {
  renderPositions();
  paint($('build'), renderBuild, { heroId: buildHeroId(), build: build.data, loading: build.loading, error: build.error, snap, counters: enemyItems.data && enemyItems.data.counters });
  paint($('neutrals'), (el, data) => renderNeutrals($('neutrals-section'), el, data), { data: neutrals.data, clock: inGame(snap) ? liveClock() : 0 });
  const enemies = lineupOf().enemies.map((e) => hero(e.id)).filter(Boolean);
  paint($('skills'), (el, data) => renderSkills($('skills-section'), el, data), { skills: skills.data, snap });
  paint($('counter-items'), renderCounterItems, { enemies, data: enemyItems.data, loading: enemyItems.loading });
  paint($('predictions'), (el, data) => renderPredictions($('predictions-section'), el, data), { data: enemyItems.data, clock: inGame(snap) ? liveClock() : 0 });
}

function renderTick() {
  renderStatus();
  if (ui.tab !== 'live') return;
  const clock = liveClock();
  paint($('clockface'), renderClock, snap, clock);
  paint($('timeline'), renderTimeline, snap, clock, enemyItems.data && enemyItems.data.predictions);
  paint($('postgame'), (el, data) => renderPostgame($('postgame-section'), el, data), { snap, post: post.data });
  paint($('rosh'), renderRosh, snap);
  const next = nextSkill(skills.data, snap);
  paint($('next-up'), renderNextUp, { next, buy: inGame(snap) ? nextBuy(build.data, snap, enemyItems.data && enemyItems.data.counters, clock) : null, neutral: nextNeutral(neutrals.data, snap, clock) });
  paint($('hero-panel'), renderHero, snap, next);
}

// ---------- polling ----------
async function poll() {
  try {
    snap = await getJson('/api/state');
    snapAt = Date.now();
    serverDown = false;
  } catch {
    serverDown = true;
  }
  const gs = snap && snap.map ? snap.map.gameState : null;
  if (gs !== lastGameState) {
    if (/HERO_SELECTION|STRATEGY_TIME/.test(gs || '')) setTab('draft');
    else if (/GAME_IN_PROGRESS/.test(gs || '') && lastGameState) setTab('live');
    lastGameState = gs;
  }
  screen.updateSnap(snap);
  renderDraft();
  renderItems();
  renderTick();
  refreshSuggestions();
  refreshPositions();
  refreshAll();
  refreshPostgame();
  if (screen.shouldAutoScan(snap)) screen.scan(false, snap);
  const playing = /GAME_IN_PROGRESS/.test(gs || '');
  if (overlay && playing !== lastPlaying) overlay.reportPhase(playing); // only on change, so Alt+T still wins mid-game
  lastPlaying = playing;
}

async function loadPlayers() {
  try { paint($('players'), (el, data) => renderPlayers($('players-section'), el, data), await getJson('/api/players')); } catch {}
}

// ---------- settings ----------
async function openSettings() {
  try {
    const s = await getJson('/api/settings');
    $('set-key').value = s.apiKey || '';
    $('set-me').value = s.myAccountId || '';
    $('set-enemies').value = (s.enemyAccountIds || []).join(', ');
  } catch {}
  $('settings').hidden = false;
  $('set-key').focus();
}

async function saveSettings() {
  const btn = $('settings-save');
  btn.disabled = true;
  try {
    await postJson('/api/settings', { apiKey: $('set-key').value, myAccountId: $('set-me').value, enemyAccountIds: $('set-enemies').value });
    btn.textContent = 'Salvato';
    setTimeout(() => { btn.textContent = 'Salva'; }, 1500);
    loadPlayers();
  } catch (e) {
    btn.textContent = 'Non salvato, riprova';
  } finally { btn.disabled = false; }
}

async function roshan(action) {
  try {
    const r = await postJson('/api/roshan', { action });
    if (snap) { snap.roshanKilledAt = r.roshanKilledAt; snap.roshanKills = r.roshanKills; }
    renderTick();
  } catch {}
}

// ---------- wiring ----------
function wire() {
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  $('lineup').addEventListener('click', (e) => {
    const b = e.target.closest('.slot');
    if (!b || b.hasAttribute('data-locked')) return;
    editSlot(b.dataset.side, b.dataset.id ? Number(b.dataset.id) : null, b.dataset.source);
  });
  $('role-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    ui.role = b.dataset.role;
    localStorage.setItem('dc_role', ui.role);
    renderDraft();
  });
  for (const id of ['position-draft', 'position-items']) {
    $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-pos]'); if (b) choosePosition(Number(b.dataset.pos)); });
  }
  $('rosh').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rosh]');
    if (b) roshan(b.dataset.rosh);
  });
  $('open-settings').addEventListener('click', openSettings);
  $('open-help').addEventListener('click', () => { $('help').hidden = false; $('help-close').focus(); });
  $('help-close').addEventListener('click', () => { $('help').hidden = true; });
  $('help').addEventListener('click', (e) => { if (e.target.id === 'help') $('help').hidden = true; });
  $('settings-close').addEventListener('click', () => { $('settings').hidden = true; });
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('settings').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('settings').hidden = true; $('help').hidden = true; } });
  $('settings-save').addEventListener('click', saveSettings);
  $('lineup-reset').addEventListener('click', () => { postLineup({ reset: true }); $('settings').hidden = true; });
  window.addEventListener('error', (e) => clog('error', 'js: ' + e.message, { at: String(e.filename || '').split('/').pop() + ':' + e.lineno }));
}

(async function boot() {
  wire();
  initPicker();
  overlay = initOverlay({ setTab, roshanKilled: () => roshan('killed') });
  await loadData();
  screen.initScreen();
  await poll();
  setInterval(poll, 1000);
  setInterval(renderTick, 500);
  loadPlayers();
})();

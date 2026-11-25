// Reads the ten hero icons in Dota's top bar (desktop app only) when the game does not send the picks.
import { heroByNpc, heroName, esc } from './data.js';
import { postJson, clog } from './api.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('dc_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('dc_' + k, JSON.stringify(v)); } catch {} },
};

let prints = null;
let busy = false;
let lastScan = 0;
let matchKey = null;
let seen = { allies: new Set(), enemies: new Set() };
let status = '';
let crops = [];
let frameUrl = null;
let alignPoints = null;
let currentSnap = null;
let lastLayout = 'game';

// The pick screen and the game draw the ten portraits in different places: each has its own geometry.
const GEO_KEY = { game: 'screen_geo', draft: 'screen_geo_draft' };
const draftPhase = (snap) => !!(snap && snap.connected && /HERO_SELECTION|STRATEGY_TIME/.test(snap.map.gameState || ''));
const gamePhase = (snap) => !!(snap && snap.connected && /PRE_GAME|GAME_IN_PROGRESS/.test(snap.map.gameState || ''));

let wasDraft = false;

// A new pick screen starts a new match, even when the game has no match id yet.
export function updateSnap(snap) {
  currentSnap = snap;
  const draft = draftPhase(snap);
  if (draft && !wasDraft) { seen = { allies: new Set(), enemies: new Set() }; crops = []; }
  wasDraft = draft;
}
export const forget = (id) => { seen.allies.delete(id); seen.enemies.delete(id); };

export const screenAvailable = () => !!(window.Detect && window.dotaCapture);
export const autoScan = () => store.get('screen_auto', true);

function setStatus(text) { status = text; render(); }

export function render() {
  const el = $('screen');
  if (!el) return;
  $('screen-note').textContent = screenAvailable() ? (status ? '' : 'pronta') : 'solo nell\'app desktop';
  if (!screenAvailable()) {
    el.innerHTML = '<p class="empty">Questa funzione legge le icone in alto nello schermo di Dota e serve quando il gioco non manda i pick, per esempio con i bot. Funziona solo nell\'app desktop, non nel browser.</p>';
    return;
  }
  el.innerHTML = `<p class="empty">${esc(status || 'Leggo le icone degli eroi in alto nello schermo quando il gioco non manda i pick.')}</p>
    <div class="screen-actions">
      <button class="btn" data-screen="scan">Leggi adesso</button>
      <button class="btn" data-screen="align">Allinea con 3 clic</button>
      <button class="btn" data-screen="reset-align">Allineamento automatico</button>
      <label class="chip" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-screen="auto"${autoScan() ? ' checked' : ''} /> lettura automatica</label>
    </div>
    ${frameUrl ? `<div class="screen-frame"><img id="screen-img" src="${frameUrl}" alt="Ultima schermata letta" />
      ${(alignPoints || []).map((p) => `<span class="screen-mark" style="left:${p.x * 100}%;top:${p.y * 100}%"></span>`).join('')}</div>` : ''}
    ${crops.length ? `<div class="crops">${crops.map((c) => `<figure${c.npc ? ' data-ok' : ''}><img src="${c.src}" alt="" /><figcaption>${c.npc ? esc(heroName(heroByNpc(c.npc).id)) : '?'}</figcaption></figure>`).join('')}</div>` : ''}`;
}

export function initScreen() {
  $('screen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-screen]');
    if (b && b.dataset.screen === 'scan') scan(true, currentSnap);
    if (b && b.dataset.screen === 'reset-align') {
      store.set(GEO_KEY.game, null); store.set(GEO_KEY.draft, null); store.set('screen_draft_layout', null);
      setStatus('Torno all\'allineamento automatico.');
    }
    if (b && b.dataset.screen === 'align') {
      if (!frameUrl) { setStatus('Prima premi "Leggi adesso" con Dota visibile.'); return; }
      alignPoints = [];
      setStatus('Clicca il centro della prima icona a sinistra.');
    }
    if (e.target.id === 'screen-img' && alignPoints) {
      const r = e.target.getBoundingClientRect();
      alignPoints.push({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
      const hints = ['Ora il centro della quinta icona, l\'ultima prima dell\'orologio.', 'Infine il centro dell\'ultima icona a destra.'];
      if (alignPoints.length < 3) { setStatus(hints[alignPoints.length - 1]); return; }
      const [p0, p1, p2] = alignPoints;
      alignPoints = null;
      if (!(p1.x > p0.x && p2.x > p1.x)) { setStatus('Le icone vanno cliccate da sinistra a destra. Riprova.'); return; }
      store.set(GEO_KEY[lastLayout], { p0, p1, p2 });
      setStatus(lastLayout === 'draft' ? 'Allineamento della schermata di pick salvato.' : 'Allineamento della partita salvato.');
      scan(true, currentSnap);
    }
  });
  $('screen').addEventListener('change', (e) => {
    if (e.target.dataset.screen === 'auto') store.set('screen_auto', e.target.checked);
  });
  render();
}

// During the pick heroes appear one at a time, so the screen is read more often.
export function shouldAutoScan(snap) {
  if (!screenAvailable() || !autoScan() || busy) return false;
  const draft = draftPhase(snap);
  if (!draft && !gamePhase(snap)) return false;
  if (Date.now() - lastScan < (draft ? 6000 : 25000)) return false;
  const l = snap.lineup || {};
  return draft ? (l.allies || []).length + (l.enemies || []).length < 10 : (l.enemies || []).length < 5;
}

function calibrated(layout, W, H) {
  const geo = store.get(GEO_KEY[layout], null);
  if (!geo || !geo.p0 || !geo.p1 || !geo.p2) return null;
  return window.Detect.slotsFromPoints(W, H, geo.p0, geo.p1, geo.p2, layout === 'draft' ? window.Detect.DRAFT_FIT : null);
}

function readGame(cv, W, H) {
  const D = window.Detect;
  let slots = calibrated('game', W, H) || D.defaultSlots(W, H);
  try { const al = D.autoAlign(cv, W, H, prints, slots); if (al.ok && al.band) slots = al.slots; } catch {}
  return { layout: 'game', got: D.matchSlots(cv, W, H, prints, slots, { minScore: 0.70, minMargin: 0.03 }) };
}

function readDraft(cv, W, H) {
  const best = window.Detect.matchDraft(cv, W, H, prints, { slots: calibrated('draft', W, H), variant: store.get('screen_draft_layout', null) });
  if (best.v && best.n >= 3) store.set('screen_draft_layout', best.v);
  return { layout: 'draft', got: best.got };
}

const found = (r) => r.got.filter((g) => g.npc).length;

export async function scan(manual, snap) {
  if (!screenAvailable() || busy) return;
  busy = true;
  lastScan = Date.now();
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('tempo scaduto')), ms))]);
  try {
    const key = snap && snap.map && snap.map.matchId;
    if (key && key !== matchKey) { matchKey = key; seen = { allies: new Set(), enemies: new Set() }; }
    if (!prints) prints = await (await fetch('data/prints.json')).json();
    const sources = await timeout(window.dotaCapture.sources(), 12000);
    if (!Array.isArray(sources)) { setStatus('Non riesco a catturare lo schermo: ' + (sources.error || 'errore sconosciuto')); return; }
    const src = sources.find((s) => /dota/i.test(s.name || '')) || sources.find((s) => /schermo intero|entire screen|full screen/i.test(s.name || ''));
    if (!src) { setStatus('Non trovo la finestra di Dota. Mettila in modalità finestra senza bordi.'); return; }
    const shot = await timeout(window.dotaCapture.shot(src.id, 1920), 15000);
    if (!shot || !shot.dataUrl) { setStatus('Screenshot non riuscito: ' + ((shot && shot.error) || 'errore sconosciuto')); return; }
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = shot.dataUrl; });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    const D = window.Detect;
    if (D.isBlack(cv, cv.width, cv.height)) { setStatus('Lo schermo è nero: con lo schermo intero esclusivo non si può leggere. Usa la finestra senza bordi.'); return; }
    const W = cv.width, H = cv.height;
    let read;
    if (draftPhase(snap)) read = readDraft(cv, W, H);
    else if (gamePhase(snap)) {
      if (!D.hudPresent(cv, W, H).ok) { setStatus('Dota non è visibile: portalo in primo piano e riprova.'); return; }
      read = readGame(cv, W, H);
    } else {
      // no phase from the game (no GSI): try both screens and keep the one that reads more heroes
      read = readGame(cv, W, H);
      if (found(read) < 3) { const d = readDraft(cv, W, H); if (found(d) > found(read)) read = d; }
    }
    lastLayout = read.layout;
    const got = read.got;
    const radiantMine = !snap || !snap.player || snap.player.team !== 'dire';
    got.forEach((g, i) => {
      const h = g.npc && heroByNpc(g.npc);
      if (!h) return;
      const left = (g.group || (i < 5 ? 'left' : 'right')) === 'left';
      (left === radiantMine ? seen.allies : seen.enemies).add(h.id);
    });
    crops = got.map((g) => {
      const t = document.createElement('canvas'); t.width = 64; t.height = Math.round((64 * g.h) / g.w);
      t.getContext('2d').drawImage(cv, g.x, g.y, g.w, g.h, 0, 0, t.width, t.height);
      return { src: t.toDataURL('image/jpeg', 0.7), npc: g.npc || null };
    });
    const small = document.createElement('canvas'); small.width = 960; small.height = Math.round((960 * cv.height) / cv.width);
    small.getContext('2d').drawImage(cv, 0, 0, small.width, small.height);
    frameUrl = small.toDataURL('image/jpeg', 0.75);
    await postJson('/api/lineup', { screen: { allies: [...seen.allies], enemies: [...seen.enemies] } });
    const n = got.filter((g) => g.npc).length;
    const at = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const rest = n >= 10 ? '' : read.layout === 'draft' ? ' Continuo a leggere mentre vengono scelti gli altri.' : ' Gli altri aggiungili con + nella formazione.';
    setStatus(`Riconosciuti ${n} eroi su 10 ${read.layout === 'draft' ? 'nella schermata di pick' : 'in partita'} alle ${at}.${rest}`);
    clog('info', 'screen scan', { n, layout: read.layout, manual: !!manual });
  } catch (e) {
    setStatus('Lettura non riuscita: ' + String((e && e.message) || e).slice(0, 100));
    clog('warn', 'screen scan failed', { err: String((e && e.message) || e).slice(0, 150) });
  } finally {
    busy = false;
  }
}

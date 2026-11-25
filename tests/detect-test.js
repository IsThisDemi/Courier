// Test del riconoscimento sulle ICONE ufficiali (le stesse disegnate nella barra in alto),
// in partita e nella schermata di pick.
// Barre sintetiche a geometrie diverse + casi negativi (mai falsi positivi).
// Uso: node tests/detect-test.js   (app in esecuzione su :51234)
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://127.0.0.1:51234';
const PICK = ['antimage', 'axe', 'crystal_maiden', 'pudge', 'sniper', 'riki', 'invoker', 'earthshaker', 'drow_ranger', 'ogre_magi'];

// Costruisce un frame con le 10 icone e verifica il match. opts: {W,H,pitch,w,h,x0,y,jitter,noise}
async function frameCase(page, name, opts, expect) {
  const res = await page.evaluate(async ({ PICK, opts }) => {
    const prints = await (await fetch('data/prints.json')).json();
    const { W, H } = opts;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#0a0d14'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1b2436'; c.fillRect(0, 0, W, Math.round(H * 0.05)); // barra HUD
    const rnd = (seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(7);
    const pos = [];
    for (let i = 0; i < 10; i++) pos.push(opts.x0 + i * opts.pitch + (i >= 5 ? opts.centerGap : 0));
    for (let i = 0; i < 10; i++) {
      // ritratti ufficiali (dataset verificato), come li disegna la barra in alto di Dota
      const im = await new Promise((r, j) => { const m = new Image(); m.onload = () => r(m); m.onerror = j; m.src = 'data/portraits/' + PICK[i] + '.png'; });
      const jx = opts.jitter ? Math.round((rnd() - 0.5) * opts.jitter * 2) : 0;
      const jy = opts.jitter ? Math.round((rnd() - 0.5) * opts.jitter * 2) : 0;
      c.imageSmoothingEnabled = true;
      c.drawImage(im, pos[i] + jx, opts.y + jy, opts.w, opts.h);
    }
    if (opts.noise) { // pannello sbagliato: solo rumore colorato
      c.clearRect(0, 0, W, H);
      for (let k = 0; k < 9000; k++) {
        c.fillStyle = `hsl(${Math.floor(rnd() * 360)},70%,${30 + Math.floor(rnd() * 40)}%)`;
        c.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H * 0.05), 3, 3);
      }
    }
    // come la cattura vera: leggera sfocatura di scala + JPEG
    let frame = cv;
    if (opts.jpeg) {
      const src = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = cv.toDataURL('image/jpeg', opts.jpeg); });
      frame = document.createElement('canvas'); frame.width = W; frame.height = H;
      const fx = frame.getContext('2d');
      fx.filter = 'blur(0.4px)';
      fx.drawImage(src, 0, 0);
    }
    const geo = {
      p0: { x: (pos[0] + opts.w / 2) / W, y: (opts.y + opts.h / 2) / H },
      p1: { x: (pos[4] + opts.w / 2) / W, y: (opts.y + opts.h / 2) / H },
      p2: { x: (pos[9] + opts.w / 2) / W, y: (opts.y + opts.h / 2) / H },
    };
    const slots = window.Detect.slotsFromPoints(W, H, geo.p0, geo.p1, geo.p2);
    const hud = window.Detect.hudPresent(frame, W, H);
    let use = slots, aligned = null;
    if (opts.autoAlign) {
      const al = window.Detect.autoAlign(frame, W, H, prints, slots);
      aligned = { dy: al.dy, h: al.h, banda: al.band ? [al.band.y0, al.band.y1] : null, ok: al.ok };
      use = al.slots;
    }
    const got = window.Detect.matchSlots(frame, W, H, prints, use); // soglie di produzione
    return {
      hud: hud.ok,
      attesi: PICK.map((p) => 'npc_dota_hero_' + p),
      trovati: got.map((g) => g.npc),
      best: got.map((g) => g.best),
      punteggi: got.map((g) => `${g.best ? g.best.replace('npc_dota_hero_', '') : '?'} ${g.score}/${g.margin}${g.npc ? '✓' : '·'}`),
      aligned,
    };
  }, { PICK, opts });

  let ok = 0; const bad = [];
  res.attesi.forEach((e, i) => { if (res.trovati[i] === e) ok++; else if (res.trovati[i]) bad.push(`${i}:FALSO ${e.split('_').pop()}→${res.trovati[i].split('_').pop()}`); });
  const falsi = res.trovati.filter((t, i) => t && t !== res.attesi[i]).length;
  const pass = expect === 'none' ? res.trovati.filter(Boolean).length === 0 : ok === 10 && falsi === 0;
  const extra = expect === 'none' ? `auto=${res.trovati.filter(Boolean).length}` : `${ok}/10 (falsi ${falsi})`;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${extra}${res.aligned ? ' | auto-allinea ' + JSON.stringify(res.aligned) : ''}${bad.length ? ' | ' + bad.join('; ') : ''}`);
  if (!pass) console.log('      punteggi:', res.punteggi.join(' '));
  return pass;
}

// Pick screen: portraits drawn where Valve's hero selection puts them. opts: {W,H,scale,gap,skew,picked,grey,jpeg}
// picked: indexes with a locked hero; grey: indexes with a hovered (desaturated) hero that must NOT count.
async function draftCase(page, name, opts) {
  const res = await page.evaluate(async ({ PICK, opts }) => {
    const prints = await (await fetch('data/prints.json')).json();
    const { W, H } = opts;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1d232c'); bg.addColorStop(1, '#2b3340');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const real = window.Detect.draftSlots(W, H, { scale: opts.scale || 1, gap: opts.gap });
    for (let i = 0; i < 10; i++) {
      const s = real[i];
      c.fillStyle = '#151a21'; c.fillRect(s.x, s.y, s.w, s.h); // empty slot
      c.fillStyle = ['#3b6bd8', '#5ee6b0', '#a13bd8', '#d8d43b', '#d8833b'][i % 5]; c.fillRect(s.x, s.y + s.h - 4, s.w, 4); // player colour
      if (!opts.picked.includes(i) && !(opts.grey || []).includes(i)) continue;
      const im = await new Promise((r, j) => { const m = new Image(); m.onload = () => r(m); m.onerror = j; m.src = 'data/portraits/' + PICK[i] + '.png'; });
      c.save();
      if ((opts.grey || []).includes(i)) c.filter = 'grayscale(1) brightness(0.8)';
      if (opts.skew) { c.translate(s.x + s.w / 2, s.y + s.h / 2); c.transform(1, 0, -opts.skew, 1, 0, 0); c.drawImage(im, -s.w / 2, -s.h / 2, s.w, s.h - 4); }
      else c.drawImage(im, s.x, s.y, s.w, s.h - 4);
      c.restore();
    }
    // the hero grid below the bar
    for (let k = 0; k < 40; k++) {
      const im = await new Promise((r) => { const m = new Image(); m.onload = () => r(m); m.src = 'data/portraits/' + PICK[k % 10] + '.png'; });
      c.drawImage(im, 60 + (k % 20) * (W * 0.032), H * 0.16 + Math.floor(k / 20) * H * 0.06, W * 0.03, H * 0.05);
    }
    let frame = cv;
    if (opts.jpeg) {
      const src = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = cv.toDataURL('image/jpeg', opts.jpeg); });
      frame = document.createElement('canvas'); frame.width = W; frame.height = H;
      frame.getContext('2d').drawImage(src, 0, 0);
    }
    const best = window.Detect.matchDraft(frame, W, H, prints);
    return { trovati: best.got.map((g) => g.npc), punteggi: best.got.map((g) => `${g.best ? g.best.replace('npc_dota_hero_', '') : '?'} ${g.score}/${g.margin}${g.npc ? '✓' : '·'}`), v: best.v };
  }, { PICK, opts });
  let ok = 0, falsi = 0;
  res.trovati.forEach((t, i) => {
    const want = opts.picked.includes(i) ? 'npc_dota_hero_' + PICK[i] : null;
    if (t === want && want) ok++;
    else if (t && t !== want) falsi++;
  });
  const pass = ok === opts.picked.length && falsi === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${ok}/${opts.picked.length} (falsi ${falsi}) layout ${JSON.stringify(res.v)}`);
  if (!pass) console.log('      punteggi:', res.punteggi.join(' '));
  return pass;
}

// The pick-screen reader on an in-game frame must not invent heroes.
async function draftOnGameBar(page) {
  const n = await page.evaluate(async ({ PICK }) => {
    const prints = await (await fetch('data/prints.json')).json();
    const W = 1920, H = 1080;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#2f5a2a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1b2436'; c.fillRect(420, 0, 1080, 48);
    for (let i = 0; i < 10; i++) {
      const im = await new Promise((r) => { const m = new Image(); m.onload = () => r(m); m.src = 'data/portraits/' + PICK[i] + '.png'; });
      c.drawImage(im, 543 + i * 62 + (i >= 5 ? 96 : 0), 7, 61, 34);
    }
    return window.Detect.matchDraft(cv, W, H, prints).got.filter((g) => g.npc).length;
  }, { PICK });
  console.log(`${n === 0 ? 'PASS' : 'FAIL'}  pick reader sulla barra di gioco — auto=${n}`);
  return n === 0;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.addScriptTag({ path: path.join(__dirname, '..', 'renderer', 'detect.js') });
  let all = true;
  // geometria reale calibrata dall'utente a 1080p: icone 61x34, passo 62
  all = await frameCase(page, '1080p geometria reale', { W: 1920, H: 1080, x0: 543, pitch: 62, centerGap: 0, w: 61, h: 34, y: 7 }, 'all') && all;
  // stesso frame con click imperfetti e HUD leggermente diverso
  all = await frameCase(page, '1080p con jitter ±3px', { W: 1920, H: 1080, x0: 543, pitch: 62, centerGap: 0, w: 61, h: 34, y: 7, jitter: 3 }, 'all') && all;
  all = await frameCase(page, '1440p', { W: 2560, H: 1440, x0: 724, pitch: 83, centerGap: 0, w: 81, h: 45, y: 9 }, 'all') && all;
  // cattura reale: JPEG 0.85 + sfocatura da ridimensionamento
  all = await frameCase(page, '1080p JPEG+sfocatura', { W: 1920, H: 1080, x0: 543, pitch: 62, centerGap: 0, w: 61, h: 34, y: 7, jpeg: 0.85 }, 'all') && all;
  all = await frameCase(page, '720p con gap centrale', { W: 1280, H: 720, x0: 362, pitch: 41, centerGap: 12, w: 40, h: 23, y: 5 }, 'all') && all;
  // altezza sbagliata: deve recuperarla con l'auto-allineamento
  all = await frameCase(page, 'auto-allinea (icone 61x26)', { W: 1920, H: 1080, x0: 543, pitch: 62, centerGap: 0, w: 61, h: 26, y: 12, autoAlign: true }, 'all') && all;
  // negativo: nessuna icona vera a schermo -> zero auto
  all = await frameCase(page, 'rumore (nessun eroe)', { W: 1920, H: 1080, x0: 543, pitch: 62, centerGap: 0, w: 61, h: 34, y: 7, noise: true }, 'none') && all;
  // schermata di pick
  all = await draftCase(page, 'pick 1080p, 10 scelti', { W: 1920, H: 1080, picked: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }) && all;
  all = await draftCase(page, 'pick 1080p a metà, JPEG', { W: 1920, H: 1080, picked: [0, 3, 5, 8], jpeg: 0.85 }) && all;
  all = await draftCase(page, 'pick ritratti inclinati', { W: 1920, H: 1080, picked: [1, 2, 6, 7, 9], skew: 0.12 }) && all;
  all = await draftCase(page, 'pick eroe solo evidenziato (grigio)', { W: 1920, H: 1080, picked: [4, 9], grey: [0, 5] }) && all;
  all = await draftCase(page, 'pick 1440p', { W: 2560, H: 1440, picked: [0, 2, 4, 6, 8] }) && all;
  all = await draftCase(page, 'pick 1080p scala 0.94', { W: 1920, H: 1080, scale: 0.94, picked: [0, 1, 7, 8] }) && all;
  all = await draftCase(page, 'pick con spazio centrale largo', { W: 1920, H: 1080, gap: 0.171, picked: [0, 4, 5, 9] }) && all;
  all = await draftCase(page, 'pick 1366x768', { W: 1366, H: 768, gap: 0.171, picked: [1, 3, 6, 8], jpeg: 0.85 }) && all;
  all = await draftCase(page, 'pick nessuno scelto', { W: 1920, H: 1080, picked: [] }) && all;
  all = await draftOnGameBar(page) && all;
  await browser.close();
  console.log(all ? 'RISULTATO: riconoscimento icone ok' : 'RISULTATO: da ritarare');
  process.exit(all ? 0 : 1);
})().catch((e) => { console.error('ERRORE:', e.message); process.exit(2); });

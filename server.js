// Courier local server: receives GSI, serves the UI and a small JSON API.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { load: loadConstants, heroByAny } = require('./lib/constants');
const { MatchState } = require('./lib/gsi-state');
const { GsiSampler } = require('./lib/gsi-sampler');
const { Remote } = require('./lib/remote');
const { OpenDota } = require('./lib/opendota');
const { buildSql, classify, classifyPopularity, itemPool } = require('./lib/probuild');
const { patchList, windows, withPatch } = require('./lib/patches');
const { positionsSql, positionShares, validPos } = require('./lib/positions');
const { neutralsSql, finalNeutralSql, neutralPicks } = require('./lib/neutrals');
const { rankPicks, rankBans, metaList, synergySql } = require('./lib/suggest');
const { globalItemsSql, vsItemsSql, counterItems, enemyPredictions } = require('./lib/counters');
const { skillSql, skillBuild } = require('./lib/skills');

const env = (name) => process.env['COURIER_' + name] ?? process.env['DOTA_COMPANION_' + name];
const PORT = Number(env('PORT') || 51234);
const ROOT = __dirname;
const RENDERER_DIR = path.join(ROOT, 'renderer');
const DATA_DIR = env('DATA') || path.join(os.homedir(), '.courier');
// Impostazioni, cache e log di quando l'app si chiamava Dota Companion: si spostano qui la prima volta.
const LEGACY_DIR = path.join(os.homedir(), '.dota-companion');
if (!env('DATA') && !fs.existsSync(DATA_DIR) && fs.existsSync(LEGACY_DIR)) {
  try { fs.renameSync(LEGACY_DIR, DATA_DIR); } catch {}
}
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'courier.log');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const IMG_DIR = path.join(DATA_DIR, 'img');
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com';
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

function log(level, msg, data) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${data !== undefined ? ' ' + JSON.stringify(data).slice(0, 500) : ''}\n`;
  try {
    const st = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null;
    if (st && st.size > 500_000) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
  if (level === 'error' || level === 'warn') console.error(line.trim());
}

// ---------- settings ----------
const DEFAULT_SETTINGS = { apiKey: '', myAccountId: '', enemyAccountIds: [] };
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
let settings = readSettings();
function saveSettings(next) {
  // Accepts both the 32-bit account ID and the Steam64 ID shown in Steam profile links.
  const accountId = (v) => {
    const digits = String(v || '').replace(/\D/g, '').slice(0, 20);
    if (digits.length >= 16) return String(BigInt(digits) - 76561197960265728n);
    return digits.slice(0, 12);
  };
  settings = {
    apiKey: String(next.apiKey || '').trim().slice(0, 80),
    myAccountId: accountId(next.myAccountId),
    enemyAccountIds: (Array.isArray(next.enemyAccountIds) ? next.enemyAccountIds : String(next.enemyAccountIds || '').split(','))
      .map(accountId).filter(Boolean).slice(0, 10),
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return settings;
}

// ---------- services ----------
loadConstants();
const state = new MatchState({ log });
const sampler = new GsiSampler(path.join(LOG_DIR, 'gsi'));
process.on('exit', () => { if (sampler.dirty) try { sampler.flush(); } catch {} });
const remote = new Remote({
  cacheDir: path.join(DATA_DIR, 'cache'),
  minIntervalMs: Number(env('MIN_INTERVAL') ?? 1100),
  log,
});
const od = new OpenDota({ remote, base: process.env.OPENDOTA_BASE, getApiKey: () => settings.apiKey });

// Patch windows from OpenDota, the bundled list when it is down.
async function patchWindows() {
  const r = await od.patches().catch(() => null);
  return windows(patchList(r && r.data));
}
// Wide window (current patch plus two older) for data that needs many games: synergy, items against a hero.
const wideSince = async () => { const w = await patchWindows(); return w[w.length - 1].since; };

async function buildRows(heroId, since, pos) {
  const r = await od.explorer(`probuild2-${heroId}-${since}-${pos || 0}`, buildSql(heroId, { since, pos }));
  return r;
}

async function proBuild(heroId, pos = null) {
  const wins = await patchWindows();
  const res = await withPatch(wins, 20, async (since) => {
    const r = await buildRows(heroId, since, pos).catch((e) => ({ error: e }));
    if (r.error) return { games: 0, error: r.error };
    return { stale: r.stale, ts: r.ts, rows: r.data.rows, ...classify(r.data.rows) };
  }).catch((e) => ({ error: e }));
  if (res && !res.error && res.games >= 8 && res.core.length) {
    const { rows, ...build } = res;
    return { source: 'pro', pos: validPos(pos), ...build };
  }
  const pop = await od.itemPopularity(heroId);
  return { source: 'popularity', pos: null, stale: pop.stale, ts: pop.ts, patch: null, ...classifyPopularity(pop.data) };
}

async function positions(heroId) {
  const wins = await patchWindows();
  return withPatch(wins, 20, async (since) => {
    const r = await od.explorer(`positions-${heroId}-${since}`, positionsSql(heroId, since));
    return positionShares(r.data.rows);
  });
}

// Items the hero (at that position) builds in the current patch, to keep the answers to the enemies on it.
async function heroPool(heroId, pos) {
  const wins = await patchWindows();
  const res = await withPatch(wins, 20, async (since) => {
    const r = await buildRows(heroId, since, pos);
    return { games: classify(r.data.rows).games, rows: r.data.rows };
  });
  return res && res.games ? itemPool(res.rows) : null;
}

async function neutrals(heroId, pos) {
  const wins = await patchWindows();
  const h = heroByAny(heroId);
  return withPatch(wins, 20, async (since) => {
    let rows = [];
    try { rows = (await od.explorer(`neutrals-h2-${heroId}-${since}-${pos || 0}`, neutralsSql(heroId, { since, pos }))).data.rows; }
    catch (e) { log('warn', 'neutral history failed', { err: String(e.message || e).slice(0, 120) }); }
    if (!rows.length) rows = (await od.explorer(`neutrals-f-${heroId}-${since}-${pos || 0}`, finalNeutralSql(heroId, { since, pos }))).data.rows;
    return { pos: validPos(pos), ...neutralPicks(rows, h && h.attr) };
  });
}

async function myHeroes() {
  if (!settings.myAccountId) return null;
  try {
    const r = await od.playerHeroes(settings.myAccountId);
    return new Map(r.data.filter((h) => h.games > 0).map((h) => [Number(h.hero_id), { games: h.games, wins: h.win }]));
  } catch { return null; }
}

async function suggestions(enemies, allies, bans) {
  const since = await wideSince();
  const stats = await od.heroStats().catch(() => ({ data: [] }));
  const matchupsByEnemy = {};
  const matchupsByAlly = {};
  const synergyByAlly = {};
  const missing = new Set();
  await Promise.all([
    ...enemies.map((id) => od.matchups(id).then((r) => { matchupsByEnemy[id] = r.data; }, () => missing.add(id))),
    ...allies.map((id) => od.matchups(id).then((r) => { matchupsByAlly[id] = r.data; }, () => missing.add(id))),
    ...allies.map((id) => od.explorer(`synergy-${id}-${since}`, synergySql(id, since)).then((r) => { synergyByAlly[id] = r.data.rows; }, () => missing.add(id))),
  ]);
  const mine = await myHeroes();
  const ranked = rankPicks({ enemies, allies, bans, matchupsByEnemy, synergyByAlly, heroStats: stats.data, myHeroes: mine });
  const banList = rankBans({ allies, excluded: [...enemies, ...bans], matchupsByAlly, heroStats: stats.data });
  return { picks: ranked.slice(0, 40), bans: banList, missing: [...missing], meta: metaList(stats.data), hasMine: !!mine };
}

async function enemyItems(enemies, me = null, pos = null) {
  const missing = [];
  let counters = [];
  let pool = null;
  if (me) { try { pool = await heroPool(me, pos); } catch {} }
  try {
    const since = await wideSince();
    const global = await od.explorer('items-global', globalItemsSql());
    const vsRowsByEnemy = {};
    for (const id of enemies) {
      try { vsRowsByEnemy[id] = (await od.explorer(`items-vs-${id}-${since}`, vsItemsSql(id, since))).data.rows; } catch { missing.push(id); }
    }
    counters = counterItems(enemies, vsRowsByEnemy, global.data.rows, pool);
  } catch (e) {
    log('warn', 'counter items failed', { err: String(e.message || e).slice(0, 150) });
    missing.push(...enemies);
  }
  const builds = [];
  for (const id of enemies) {
    try { builds.push({ hero: id, build: await proBuild(id) }); } catch { builds.push({ hero: id, build: null }); }
  }
  return { counters, forHero: pool ? me : null, pool: pool ? [...pool] : null, predictions: enemyPredictions(builds), missing: [...new Set(missing)] };
}

async function skills(heroId, pos = null) {
  const wins = await patchWindows();
  return withPatch(wins, 20, async (since) => {
    const r = await od.explorer(`skills-${heroId}-${since}-${pos || 0}`, skillSql(heroId, { since, pos }));
    return { stale: r.stale, pos: validPos(pos), ...skillBuild(r.data.rows) };
  });
}

const parseRequested = new Map();
async function requestParseOnce(matchId) {
  const last = parseRequested.get(matchId) || 0;
  if (Date.now() - last < 10 * 60e3) return;
  parseRequested.set(matchId, Date.now());
  try { await od.requestParse(matchId); log('info', 'opendota parse requested', { matchId }); }
  catch (e) { log('warn', 'parse request failed', { matchId, err: String(e.message || e) }); }
}

const BENCHMARKS = [
  ['gold_per_min', 'Oro al minuto'], ['xp_per_min', 'Esperienza al minuto'], ['last_hits_per_min', 'Last hit al minuto'],
  ['hero_damage_per_min', 'Danni agli eroi al minuto'], ['kills_per_min', 'Uccisioni al minuto'], ['tower_damage', 'Danni alle strutture'],
];

async function postGame(matchId, heroId, accountId, pos) {
  let res;
  try { res = await od.match(matchId); }
  catch { await requestParseOnce(matchId); return { status: 'pending' }; }
  const m = res.data;
  const p = (accountId && m.players.find((x) => String(x.account_id) === String(accountId))) || m.players.find((x) => x.hero_id === heroId);
  if (!p) return { status: 'notfound' };
  if (!p.purchase_log) await requestParseOnce(matchId);
  const radiant = p.player_slot < 128;
  const out = {
    status: p.purchase_log ? 'ready' : 'partial',
    matchId, hero: p.hero_id, win: radiant === !!m.radiant_win, duration: m.duration,
    kills: p.kills, deaths: p.deaths, assists: p.assists, lastHits: p.last_hits, denies: p.denies,
    gpm: p.gold_per_min, xpm: p.xp_per_min, netWorth: p.net_worth, heroDamage: p.hero_damage,
    benchmarks: BENCHMARKS.filter(([k]) => p.benchmarks && p.benchmarks[k]).map(([k, label]) => ({ key: k, label, raw: p.benchmarks[k].raw, pct: p.benchmarks[k].pct })),
    items: [],
  };
  if (p.purchase_log) {
    const first = new Map();
    for (const e of p.purchase_log) if (!first.has(e.key)) first.set(e.key, e.time);
    let pro = null;
    try { pro = await proBuild(p.hero_id, pos); } catch {}
    const core = pro ? pro.core : [];
    for (const c of core) {
      if (!first.has(c.key)) continue;
      out.items.push({ key: c.key, name: c.name, time: first.get(c.key), proTime: c.time, delta: first.get(c.key) - c.time });
    }
  }
  return out;
}

// ---------- http helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 50_000) {
  const body = await readBody(req, limit);
  return body ? JSON.parse(body) : {};
}

function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(RENDERER_DIR, rel));
  if (!file.startsWith(RENDERER_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// Item icons are fetched once from the Steam CDN and then served from disk.
const ITEM_IMG = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(RENDERER_DIR, 'data', 'items.json'), 'utf8')))
  .filter(([, v]) => v && v.img).map(([k, v]) => [k, v.img]));
const imgInflight = new Map();
async function serveCdnImage(name, cdnPath, res) {
  const file = path.join(IMG_DIR, name + '.png');
  if (!fs.existsSync(file)) {
    if (!imgInflight.has(name)) {
      imgInflight.set(name, (async () => {
        const r = await fetch(STEAM_CDN + cdnPath, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('cdn ' + r.status);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      })().finally(() => imgInflight.delete(name)));
    }
    try { await imgInflight.get(name); } catch { res.writeHead(404); res.end(); return; }
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=604800' });
  fs.createReadStream(file).pipe(res);
}

function serveImage(p, res) {
  const m = /^\/img\/(item|ability)\/([a-z0-9_]{1,64})\.png$/.exec(p);
  if (!m) { res.writeHead(404); res.end(); return; }
  if (m[1] === 'item') {
    if (!ITEM_IMG[m[2]]) { res.writeHead(404); res.end(); return; }
    return serveCdnImage('item-' + m[2], ITEM_IMG[m[2]], res);
  }
  return serveCdnImage('ability-' + m[2], `/apps/dota2/images/dota_react/abilities/${m[2]}.png`, res);
}

const idList = (s) => String(s || '').split(',').map((x) => Number(x)).filter((x) => x > 0 && heroByAny(x)).slice(0, 5);

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (req.method === 'POST' && (p === '/' || p === '/gsi')) {
    let payload;
    try { payload = JSON.parse(await readBody(req, 2_000_000) || '{}'); state.ingest(payload); }
    catch (e) { log('warn', 'gsi bad payload', { err: String(e.message || e).slice(0, 100) }); res.writeHead(400); res.end(); return; }
    try { sampler.add(payload); } catch (e) { log('warn', 'gsi sample failed', { err: String(e.message || e).slice(0, 100) }); }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return;
  }

  if (p === '/api/state' && req.method === 'GET') return sendJson(res, { ...state.snapshot(), serverTime: Date.now() });

  if (p === '/api/suggest' && req.method === 'GET') {
    const q = (k) => idList(url.searchParams.get(k));
    try { return sendJson(res, await suggestions(q('enemies'), q('allies'), q('bans'))); }
    catch (e) { return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if (p === '/api/enemy-items' && req.method === 'GET') {
    const me = heroByAny(url.searchParams.get('me'));
    try { return sendJson(res, await enemyItems(idList(url.searchParams.get('heroes')), me ? me.id : null, validPos(url.searchParams.get('pos')))); }
    catch (e) { return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if (p === '/api/skills' && req.method === 'GET') {
    const hero = heroByAny(url.searchParams.get('hero'));
    if (!hero) return sendJson(res, { error: 'unknown hero' }, 400);
    try { return sendJson(res, { hero: hero.id, ...(await skills(hero.id, validPos(url.searchParams.get('pos')))) }); }
    catch (e) { return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if (p === '/api/postgame' && req.method === 'GET') {
    const matchId = String(url.searchParams.get('match') || '').replace(/\D/g, '');
    if (!matchId) return sendJson(res, { error: 'missing match' }, 400);
    const hero = heroByAny(url.searchParams.get('hero'));
    try { return sendJson(res, await postGame(matchId, hero ? hero.id : null, String(url.searchParams.get('account') || '').replace(/\D/g, ''), validPos(url.searchParams.get('pos')))); }
    catch (e) { return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if (p === '/api/build' && req.method === 'GET') {
    const hero = heroByAny(url.searchParams.get('hero'));
    if (!hero) return sendJson(res, { error: 'unknown hero' }, 400);
    try { return sendJson(res, { hero: hero.id, ...(await proBuild(hero.id, validPos(url.searchParams.get('pos')))) }); }
    catch (e) { log('warn', 'build failed', { hero: hero.id, err: String(e.message || e) }); return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if ((p === '/api/positions' || p === '/api/neutrals') && req.method === 'GET') {
    const hero = heroByAny(url.searchParams.get('hero'));
    if (!hero) return sendJson(res, { error: 'unknown hero' }, 400);
    try {
      const data = p === '/api/positions' ? await positions(hero.id) : await neutrals(hero.id, validPos(url.searchParams.get('pos')));
      return sendJson(res, { hero: hero.id, ...data });
    } catch (e) { return sendJson(res, { error: String(e.message || e) }, 502); }
  }

  if (p === '/api/players' && req.method === 'GET') {
    const out = [];
    for (const id of settings.enemyAccountIds) {
      try {
        const r = await od.playerHeroes(id);
        out.push({ accountId: id, heroes: r.data.filter((h) => h.games > 0).slice(0, 4).map((h) => ({ id: Number(h.hero_id), games: h.games, wins: h.win })) });
      } catch { out.push({ accountId: id, error: 'not available' }); }
    }
    return sendJson(res, { players: out });
  }

  if (p === '/api/lineup' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      if (body.reset) state.resetLineup();
      if (body.side) state.setManual(body.side, Array.isArray(body.ids) ? body.ids : []);
      if (body.screen) state.setScreen(body.screen.allies, body.screen.enemies);
      return sendJson(res, state.lineup());
    } catch { return sendJson(res, { error: 'bad request' }, 400); }
  }

  if (p === '/api/roshan' && req.method === 'POST') {
    try { const body = await readJson(req); state.setRoshan(body.action); return sendJson(res, { roshanKilledAt: state.roshanKilledAt, roshanKills: state.roshanKills }); }
    catch { return sendJson(res, { error: 'bad request' }, 400); }
  }

  if (p === '/api/settings') {
    if (req.method === 'GET') return sendJson(res, settings);
    if (req.method === 'POST') {
      try { return sendJson(res, saveSettings(await readJson(req))); }
      catch { return sendJson(res, { error: 'bad request' }, 400); }
    }
  }

  if (p.startsWith('/img/') && req.method === 'GET') return serveImage(p, res);

  if (p === '/log' && req.method === 'POST') {
    try { const e = await readJson(req); log('client-' + String(e.level || 'info').slice(0, 8), String(e.msg || '').slice(0, 300), e.data); } catch {}
    res.writeHead(204); res.end(); return;
  }

  if (p === '/debug-frame' && req.method === 'POST') {
    try {
      const e = await readJson(req, 6_000_000);
      const m = /^data:image\/(jpeg|png);base64,(.+)$/.exec(e.dataUrl || '');
      if (m) {
        const name = /^[a-z0-9_-]{1,24}$/i.test(String(e.name || '')) ? e.name : 'frame';
        fs.writeFileSync(path.join(LOG_DIR, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`), Buffer.from(m[2], 'base64'));
      }
    } catch {}
    res.writeHead(204); res.end(); return;
  }

  if (p === '/logs' && req.method === 'GET') {
    const n = Math.min(Math.max(Number(url.searchParams.get('lines')) || 200, 1), 1000);
    let text = '(empty log)\n';
    try { text = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-n).join('\n') + '\n'; } catch {}
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); return;
  }

  if (p === '/health') return sendJson(res, { ok: true, port: PORT, updates: state.updates });

  if (req.method === 'GET') return serveStatic(p, res);
  res.writeHead(404); res.end();
}

function start(port = PORT) {
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      log('error', 'unhandled', { url: req.url, err: String(e.stack || e).slice(0, 300) });
      if (!res.headersSent) sendJson(res, { error: 'internal error' }, 500);
    });
  });
  server.listen(port, '127.0.0.1', () => {
    log('info', `server listening on ${port}`, { dataDir: DATA_DIR });
    console.log(`[courier] UI + GSI on http://127.0.0.1:${port}/  (data: ${DATA_DIR})`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { start };

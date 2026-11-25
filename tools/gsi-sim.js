#!/usr/bin/env node
// Dota 2 GSI simulator: posts realistic payloads to Courier so it can be tested without the game.
//
//   node tools/gsi-sim.js                       full match (draft -> game -> end) at 10x speed
//   node tools/gsi-sim.js --scenario game --clock 600 --speed 1
//   node tools/gsi-sim.js --scenario snapshot --clock 754 --hero axe --enemies riki,sniper
//   node tools/gsi-sim.js --draft none          like bot games: no draft block, heroes must be entered by hand
//
// Options: --port --hero --team radiant|dire --allies a,b --enemies a,b,c --scenario full|draft|game|snapshot
//          --draft live|none --speed N --clock S --interval MS --duration S --seed N --quiet
const path = require('path');
const { load, heroByAny } = require('../lib/constants');

const ABILITIES = require(path.join(__dirname, '..', 'renderer', 'data', 'hero-abilities.json'));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const XP_TABLE = [0, 240, 640, 1160, 1760, 2440, 3200, 4000, 4900, 5900, 7000, 8200, 9500, 10900, 12400, 14000,
  15700, 17500, 19400, 21400, 23600, 26000, 28600, 31400, 34400, 38400, 43400, 49400, 56400, 63900];

const BUILDS = {
  str: ['tango', 'branches', 'branches', 'gauntlets', 'magic_stick', 'boots', 'bracer', 'phase_boots', 'magic_wand', 'blink', 'blade_mail', 'black_king_bar', 'aghanims_shard', 'ultimate_scepter', 'shivas_guard', 'heart'],
  agi: ['tango', 'branches', 'slippers', 'circlet', 'magic_stick', 'wraith_band', 'boots', 'power_treads', 'magic_wand', 'maelstrom', 'manta', 'black_king_bar', 'mjollnir', 'butterfly', 'satanic', 'skadi'],
  int: ['tango', 'branches', 'mantle', 'circlet', 'faerie_fire', 'null_talisman', 'boots', 'arcane_boots', 'magic_wand', 'glimmer_cape', 'force_staff', 'aether_lens', 'ultimate_scepter', 'black_king_bar', 'sheepstick', 'octarine_core'],
  all: ['tango', 'branches', 'branches', 'circlet', 'magic_stick', 'boots', 'bracer', 'power_treads', 'magic_wand', 'kaya', 'yasha', 'black_king_bar', 'aghanims_shard', 'ultimate_scepter', 'sheepstick', 'refresher'],
};
const CONSUMABLE_ONCE = new Set(['tango', 'faerie_fire', 'magic_stick']);
// 7.42 neutral tiers unlock at 0:00, 15:00, 30:00 and 50:00; a crafted artifact shows up shortly after.
const NEUTRALS = [[90, 'occult_bracelet'], [960, 'mysterious_hat'], [1860, 'trusty_shovel']];

class Match {
  constructor(opts) {
    const { heroesById } = load();
    this.rand = rng(Number(opts.seed) || 7);
    const all = [...heroesById.values()];
    const pickRandom = (taken) => {
      for (;;) {
        const h = all[Math.floor(this.rand() * all.length)];
        if (!taken.has(h.id)) { taken.add(h.id); return h; }
      }
    };
    const taken = new Set();
    const named = (list) => String(list || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const h = heroByAny(s);
      if (!h) throw new Error(`unknown hero "${s}"`);
      taken.add(h.id);
      return h;
    });
    this.me = opts.hero ? named(opts.hero)[0] : null;
    const allies = named(opts.allies);
    const enemies = named(opts.enemies);
    if (!this.me) this.me = pickRandom(taken);
    while (allies.length < 4) allies.push(pickRandom(taken));
    while (enemies.length < 5) enemies.push(pickRandom(taken));
    this.allies = [this.me, ...allies.slice(0, 4)];
    this.enemies = enemies.slice(0, 5);
    this.bans = [pickRandom(taken), pickRandom(taken), pickRandom(taken), pickRandom(taken)];
    this.team = opts.team === 'dire' ? 'dire' : 'radiant';
    this.draftMode = opts.draft === 'none' ? 'none' : 'live';
    this.matchId = String(8000000000 + Math.floor(this.rand() * 1e9));
    this.build = (BUILDS[this.me.attr] || BUILDS.all).filter((k) => load().items.has(k));
    this.abilities = (ABILITIES[this.me.npc] || []).slice(0, 6);
    // Deterministic life events so any clock value gives the same snapshot.
    this.deaths = [430, 1210, 1985, 2590].map((t) => t + Math.floor(this.rand() * 90));
    this.kills = [310, 760, 980, 1400, 1720, 2105, 2400].map((t) => t + Math.floor(this.rand() * 60));
    this.roshanKills = [1150 + Math.floor(this.rand() * 120), 2250 + Math.floor(this.rand() * 120)];
    this.sentEvents = new Set();
  }

  draftOrder() {
    const mine = this.team === 'radiant' ? 'team2' : 'team3';
    const theirs = mine === 'team2' ? 'team3' : 'team2';
    const seq = [];
    const ally = [...this.allies];
    const enemy = [...this.enemies];
    // My hero is the third ally pick, as in a normal all pick draft.
    const myIndex = 2;
    ally.splice(0, 1);
    ally.splice(myIndex, 0, this.me);
    for (let i = 0; i < 5; i++) {
      seq.push({ team: i % 2 ? theirs : mine, hero: i % 2 ? enemy[i] : ally[i] });
      seq.push({ team: i % 2 ? mine : theirs, hero: i % 2 ? ally[i] : enemy[i] });
    }
    return seq;
  }

  // Valve's player-side format: team2/team3 with flat pickN_id / pickN_class keys.
  draftBlock(progress) {
    if (this.draftMode === 'none') return {};
    const seq = this.draftOrder();
    const shown = Math.min(seq.length, Math.floor(progress * (seq.length + 1)));
    const block = { activeteam: shown % 2 ? 3 : 2, pick: true, activeteam_time_remaining: 25, radiant_bonus_time: 130, dire_bonus_time: 130 };
    for (const t of ['team2', 'team3']) block[t] = { home_team: t === 'team2' };
    const counters = { team2: 0, team3: 0 };
    for (let i = 0; i < shown; i++) {
      const { team, hero } = seq[i];
      const n = counters[team]++;
      block[team][`pick${n}_id`] = hero.id;
      block[team][`pick${n}_class`] = hero.short;
    }
    this.bans.forEach((h, i) => {
      const t = i % 2 ? 'team3' : 'team2';
      block[t][`ban${Math.floor(i / 2)}_id`] = h.id;
      block[t][`ban${Math.floor(i / 2)}_class`] = h.short;
    });
    return { block, myPicked: seq.slice(0, shown).some((s) => s.hero.id === this.me.id) };
  }

  economy(t) {
    const minutes = Math.max(0, t) / 60;
    const gpm = Math.round(320 + minutes * 9 + Math.sin(t / 97) * 15);
    const xpm = Math.round(380 + minutes * 11 + Math.cos(t / 83) * 18);
    const earned = 600 + gpm * minutes;
    let spent = 0;
    const bought = [];
    for (const key of this.build) {
      const cost = load().items.get(key).cost || 0;
      if (spent + cost > earned) break;
      spent += cost;
      bought.push(key);
    }
    const xp = xpm * minutes;
    let level = 1;
    while (level < 30 && xp >= XP_TABLE[level]) level++;
    return { gpm, xpm, gold: Math.round(earned - spent), networth: Math.round(earned), bought, level, xp: Math.round(xp) };
  }

  inventory(t, bought) {
    // Components are consumed into the finished item, so keep only the last six purchases that still exist.
    const { items } = load();
    const owned = [];
    for (const key of bought) {
      const it = items.get(key);
      for (const c of it.components || []) {
        const idx = owned.indexOf(c);
        if (idx >= 0) owned.splice(idx, 1);
      }
      if (key === 'magic_wand') { const i = owned.indexOf('magic_stick'); if (i >= 0) owned.splice(i, 1); }
      if (key === 'power_treads' || key === 'phase_boots' || key === 'arcane_boots') { const i = owned.indexOf('boots'); if (i >= 0) owned.splice(i, 1); }
      if (CONSUMABLE_ONCE.has(key) && t > 240 && key !== 'magic_stick') continue;
      owned.push(key);
    }
    const slots = {};
    const main = owned.slice(-6);
    const backpack = owned.slice(0, Math.max(0, owned.length - 6)).slice(-3);
    for (let i = 0; i < 9; i++) {
      const key = i < 6 ? main[i] : backpack[i - 6];
      const cd = key === 'blink' || key === 'black_king_bar' ? Math.max(0, Math.round(12 - (t % 40))) : 0;
      slots['slot' + i] = key
        ? { name: 'item_' + key, purchaser: 0, item_level: 1, can_cast: cd === 0, cooldown: cd, passive: false, charges: key === 'magic_wand' ? Math.round(5 + 5 * Math.sin(t / 30)) : undefined }
        : { name: 'empty' };
    }
    for (let i = 0; i < 6; i++) slots['stash' + i] = { name: 'empty' };
    slots.teleport0 = { name: 'item_tpscroll', purchaser: 0, can_cast: true, cooldown: Math.max(0, Math.round(20 - (t % 90))), charges: 1 };
    const neutral = NEUTRALS.filter(([at]) => t >= at).pop();
    slots.neutral0 = neutral ? { name: 'item_' + neutral[1], purchaser: 0, can_cast: true, cooldown: 0, passive: true } : { name: 'empty' };
    return slots;
  }

  life(t, level) {
    const respawnTime = 6 + level * 2;
    for (const d of this.deaths) if (t >= d && t < d + respawnTime) return { alive: false, respawn: Math.ceil(d + respawnTime - t) };
    return { alive: true, respawn: 0 };
  }

  abilityBlock(t, level) {
    const out = {};
    const ultLevel = Math.min(3, Math.floor(level / 6));
    const basicPoints = Math.max(0, Math.min(level, 16) - ultLevel);
    this.abilities.forEach((name, i) => {
      const ultimate = i === 3;
      let lvl;
      if (ultimate) lvl = ultLevel;
      else if (i < 3) lvl = Math.min(4, Math.floor((basicPoints + (2 - i)) / 3));
      else lvl = 1;
      const period = ultimate ? 140 : 24 + i * 7;
      const cooldownMax = ultimate ? 110 : 14 + i * 4;
      const phase = (t + i * 13) % period;
      const cooldown = lvl > 0 && phase < cooldownMax ? Math.round(cooldownMax - phase) : 0;
      out['ability' + i] = { name, level: lvl, can_cast: lvl > 0 && cooldown === 0, passive: false, ability_active: true, cooldown, ultimate };
    });
    return out;
  }

  heroBlock(t, eco, life, inDraft, myPicked) {
    if (inDraft && !myPicked) return { id: 0, name: '' };
    const maxHp = 600 + eco.level * 85;
    const maxMp = 300 + eco.level * 40;
    const hpPct = life.alive ? 0.55 + 0.4 * Math.abs(Math.sin(t / 37)) : 0;
    const mpPct = life.alive ? 0.35 + 0.6 * Math.abs(Math.cos(t / 51)) : 0;
    return {
      xpos: Math.round(-6000 + (t * 37) % 12000), ypos: Math.round(-6000 + (t * 53) % 12000),
      id: this.me.id, name: this.me.npc, level: eco.level, xp: eco.xp,
      alive: life.alive, respawn_seconds: life.respawn,
      buyback_cost: Math.round(200 + eco.networth / 13), buyback_cooldown: t > this.deaths[2] + 10 && t < this.deaths[2] + 490 ? Math.round(this.deaths[2] + 490 - t) : 0,
      health: Math.round(maxHp * hpPct), max_health: maxHp, health_percent: Math.round(hpPct * 100),
      mana: Math.round(maxMp * mpPct), max_mana: maxMp, mana_percent: Math.round(mpPct * 100),
      silenced: false, stunned: false, disarmed: false, magicimmune: false, hexed: false, muted: false, break: false,
      aghanims_scepter: eco.bought.includes('ultimate_scepter'), aghanims_shard: eco.bought.includes('aghanims_shard'),
      smoked: false, has_debuff: false,
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`talent_${n}`, n % 2 === 1 && eco.level >= 10 + 5 * Math.floor((n - 1) / 2)])),
    };
  }

  events(t, gameTime) {
    const out = [];
    for (const k of this.roshanKills) {
      if (t >= k && t < k + 15) {
        out.push({ game_time: gameTime - (t - k), event_type: 'roshan_killed', killed_by_team: this.team, killer_player_id: 2 });
        if (!this.sentEvents.has(k)) { this.sentEvents.add(k); log(`  Roshan killed at ${fmt(k)}`); }
      }
    }
    return out;
  }

  payload({ phase, clock, draftProgress = 1 }) {
    const states = {
      draft: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
      strategy: 'DOTA_GAMERULES_STATE_STRATEGY_TIME',
      pregame: 'DOTA_GAMERULES_STATE_PRE_GAME',
      game: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
      post: 'DOTA_GAMERULES_STATE_POST_GAME',
    };
    const inDraft = phase === 'draft' || phase === 'strategy';
    const t = Math.max(0, clock);
    const eco = inDraft ? { gpm: 0, xpm: 0, gold: 600, networth: 600, bought: [], level: 1, xp: 0 } : this.economy(clock);
    const life = phase === 'game' ? this.life(t, eco.level) : { alive: true, respawn: 0 };
    const draft = inDraft ? this.draftBlock(phase === 'strategy' ? 1 : draftProgress) : { block: this.draftMode === 'none' ? {} : {}, myPicked: true };
    const kills = this.kills.filter((k) => clock >= k).length;
    const deaths = this.deaths.filter((d) => clock >= d).length;
    const gameTime = clock + 90 + 30;
    const payload = {
      provider: { name: 'Dota 2', appid: 570, version: 47, timestamp: Math.floor(Date.now() / 1000) },
      map: {
        name: 'start', matchid: this.matchId, game_time: Math.round(gameTime), clock_time: Math.round(clock),
        daytime: clock < 0 || Math.floor(t / 300) % 2 === 0, nightstalker_night: false,
        radiant_score: Math.round(t / 75), dire_score: Math.round(t / 90),
        game_state: states[phase], paused: false,
        win_team: phase === 'post' ? this.team : 'none', customgamename: '', ward_purchase_cooldown: 0,
      },
      player: {
        steamid: '76561198000000000', accountid: '39734272', name: 'Simulatore', activity: 'playing',
        kills, deaths, assists: Math.round(t / 160), last_hits: Math.round(t / 60 * 6.2), denies: Math.round(t / 60 * 0.7),
        kill_streak: 0, commands_issued: Math.round(t * 2.3), kill_list: {}, team_name: this.team, player_slot: this.team === 'radiant' ? 2 : 130,
        team_slot: 2, gold: eco.gold, gold_reliable: Math.round(eco.gold * 0.3), gold_unreliable: Math.round(eco.gold * 0.7),
        gold_from_hero_kills: kills * 250, gold_from_creep_kills: Math.round(t * 3), gold_from_income: Math.round(t * 1.5), gold_from_shared: 0,
        gpm: eco.gpm, xpm: eco.xpm,
      },
      hero: this.heroBlock(t, eco, life, inDraft, draft.myPicked),
      abilities: inDraft ? {} : this.abilityBlock(t, eco.level),
      items: inDraft ? {} : this.inventory(t, eco.bought),
      draft: draft.block,
      events: phase === 'game' ? this.events(t, gameTime) : [],
      auth: { token: 'simulator' },
    };
    return payload;
  }
}

const fmt = (s) => `${s < 0 ? '-' : ''}${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`;
let quiet = false;
const log = (msg) => { if (!quiet) console.log(msg); };

async function post(port, payload) {
  const r = await fetch(`http://127.0.0.1:${port}/gsi`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  quiet = !!opts.quiet;
  const port = Number(opts.port || process.env.COURIER_PORT || process.env.DOTA_COMPANION_PORT || 51234);
  const scenario = opts.scenario || 'full';
  const speed = Math.max(0.1, Number(opts.speed || (scenario === 'full' ? 10 : 1)));
  const interval = Math.max(100, Number(opts.interval || 500));
  const match = new Match(opts);
  const names = (list) => list.map((h) => h.name).join(', ');
  log(`[sim] ${scenario} on port ${port}, speed ${speed}x, ${match.team}, draft data: ${match.draftMode}`);
  log(`[sim] me: ${match.me.name} | allies: ${names(match.allies.slice(1))} | enemies: ${names(match.enemies)}`);

  // Timeline in game seconds: draft (60) -> strategy (30) -> pre-game (-90..0) -> game -> post-game (20).
  const timeline = [];
  const startClock = Number(opts.clock || 0);
  const endClock = opts.duration ? startClock + Number(opts.duration) : 45 * 60;
  if (scenario === 'full' || scenario === 'draft') {
    timeline.push({ phase: 'draft', length: 60 });
    timeline.push({ phase: 'strategy', length: 30 });
  }
  if (scenario === 'full') timeline.push({ phase: 'pregame', from: -90, to: 0 });
  if (scenario === 'full' || scenario === 'game') timeline.push({ phase: 'game', from: scenario === 'game' ? startClock : 0, to: endClock });
  if (scenario === 'full') timeline.push({ phase: 'post', length: 20 });

  // Courier opened during the draft has seen every pick: replay a finished draft first.
  if ((scenario === 'game' || scenario === 'snapshot') && match.draftMode === 'live' && !opts['no-draft-replay']) {
    try { await post(port, match.payload({ phase: 'strategy', clock: -120 })); }
    catch (e) { console.error(`[sim] Courier not reachable on ${port}: ${e.message}`); process.exit(1); }
  }

  if (scenario === 'snapshot') {
    const payload = match.payload({ phase: startClock < 0 ? 'pregame' : 'game', clock: startClock });
    const repeat = Number(opts.duration || 0);
    await post(port, payload);
    for (let i = 0; i < repeat * 2; i++) { await new Promise((r) => setTimeout(r, 500)); await post(port, payload); }
    log(`[sim] snapshot at ${fmt(startClock)} posted`);
    return;
  }

  let stop = false;
  process.on('SIGINT', () => { stop = true; });
  let failures = 0;
  for (const step of timeline) {
    const length = step.length ?? step.to - step.from;
    log(`[sim] phase ${step.phase}`);
    const t0 = Date.now();
    for (;;) {
      if (stop) return;
      const elapsed = ((Date.now() - t0) / 1000) * speed;
      if (elapsed > length) break;
      const clock = step.from != null ? step.from + elapsed : (step.phase === 'post' ? endClock : -90 - 30);
      const payload = match.payload({ phase: step.phase, clock, draftProgress: elapsed / length });
      try { await post(port, payload); failures = 0; }
      catch (e) {
        if (++failures === 1) log(`[sim] Courier not reachable on ${port} (${e.message}), retrying...`);
      }
      if (step.phase === 'game' && Math.floor(clock) % 60 === 0) log(`  ${fmt(clock)}  lvl ${payload.hero.level}  gold ${payload.player.gold}  ${payload.hero.alive ? '' : 'dead'}`);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  log('[sim] match finished');
}

if (require.main === module) run().catch((e) => { console.error('[sim] ' + e.message); process.exit(1); });

module.exports = { Match };

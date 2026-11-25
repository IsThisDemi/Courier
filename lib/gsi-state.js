// Turns raw GSI payloads into the app's match state: phase, player, hero, lineups, Roshan.
const { heroByAny } = require('./constants');

const DRAFT_STATES = new Set(['DOTA_GAMERULES_STATE_HERO_SELECTION', 'DOTA_GAMERULES_STATE_STRATEGY_TIME']);
const NEW_MATCH_STATES = new Set([...DRAFT_STATES, 'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD']);
const TEAM_KEYS = { team2: 'radiant', team3: 'dire' };

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// Supports Valve's flat format (team2: { pick0_id, pick0_class, ban0_id }) and the nested
// one (team2: { pick0: { id, name } }) used by older tests.
function parseDraft(draft) {
  const picks = [];
  const bans = [];
  if (!draft || typeof draft !== 'object') return { picks, bans, active: false };
  for (const [teamKey, block] of Object.entries(draft)) {
    const team = TEAM_KEYS[teamKey];
    if (!team || !block || typeof block !== 'object') continue;
    const slots = new Map();
    for (const [k, v] of Object.entries(block)) {
      const m = /^(pick|ban)(\d+)(?:_(id|class))?$/.exec(k);
      if (!m) continue;
      const slotKey = m[1] + m[2];
      const entry = slots.get(slotKey) || { kind: m[1], order: Number(m[2]) };
      if (m[3] === 'id') entry.id = num(v);
      else if (m[3] === 'class') entry.cls = v;
      else if (v && typeof v === 'object') { entry.id = num(v.id ?? v.hero_id); entry.cls = v.name || v.class; }
      slots.set(slotKey, entry);
    }
    for (const e of [...slots.values()].sort((a, b) => a.order - b.order)) {
      const hero = heroByAny(e.id || null) || heroByAny(e.cls || null);
      if (!hero) continue;
      (e.kind === 'ban' ? bans : picks).push({ id: hero.id, team });
    }
  }
  return { picks, bans, active: picks.length + bans.length > 0 };
}

function parseItems(items) {
  const out = { inventory: [], backpack: [], neutral: null, teleport: null };
  if (!items || typeof items !== 'object') return out;
  const pick = (v) => (v && v.name && v.name !== 'empty'
    ? { key: v.name.replace(/^item_/, ''), cooldown: num(v.cooldown) || 0, charges: num(v.charges) }
    : null);
  for (let i = 0; i < 9; i++) {
    const it = pick(items['slot' + i]);
    if (i < 6) out.inventory.push(it); else out.backpack.push(it);
  }
  out.neutral = pick(items.neutral0);
  out.teleport = pick(items.teleport0);
  return out;
}

function parseAbilities(abilities) {
  if (!abilities || typeof abilities !== 'object') return [];
  return Object.keys(abilities)
    .filter((k) => /^ability\d+$/.test(k))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
    .map((k) => abilities[k])
    .filter((a) => a && a.name && !/^(plus_|generic_hidden)/.test(a.name) && !/special_bonus/.test(a.name))
    .map((a) => ({
      name: a.name,
      level: num(a.level) || 0,
      cooldown: num(a.cooldown) || 0,
      ultimate: !!a.ultimate,
      passive: !!a.passive,
      canCast: !!a.can_cast,
    }));
}

class MatchState {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.raw = null;
    this.lastSeen = 0;
    this.updates = 0;
    this.matchKey = null;
    this.prevGameState = null;
    this.resetLineup();
  }

  resetLineup() {
    this.draftPicks = [];
    this.draftBans = [];
    this.manual = { allies: [], enemies: [] };
    this.screen = { allies: [], enemies: [] };
    this.roshanKilledAt = null;
    this.roshanKills = 0;
  }

  ingest(payload) {
    this.raw = payload || {};
    this.lastSeen = Date.now();
    this.updates++;
    const map = this.raw.map || {};
    const gs = map.game_state || null;
    const matchId = map.matchid || null;
    const enteringDraft = gs && NEW_MATCH_STATES.has(gs) && !NEW_MATCH_STATES.has(this.prevGameState || '');
    const newMatchId = matchId && matchId !== '0' && this.matchKey && matchId !== this.matchKey;
    if (enteringDraft || newMatchId) {
      this.log('info', 'new match: lineup reset', { gs, matchId });
      this.resetLineup();
    }
    if (matchId && matchId !== '0') this.matchKey = matchId;
    if (gs !== this.prevGameState) this.log('info', 'game_state -> ' + gs);
    this.prevGameState = gs;

    // The draft block disappears once the game starts: keep what was seen.
    const draft = parseDraft(this.raw.draft);
    if (draft.active) {
      if (DRAFT_STATES.has(gs)) { this.draftPicks = draft.picks; this.draftBans = draft.bans; }
      else {
        for (const p of draft.picks) if (!this.draftPicks.some((x) => x.id === p.id)) this.draftPicks.push(p);
        for (const b of draft.bans) if (!this.draftBans.some((x) => x.id === b.id)) this.draftBans.push(b);
      }
    }
    this.ingestEvents(this.raw.events, map);
  }

  ingestEvents(events, map) {
    const list = Array.isArray(events) ? events : (events && Array.isArray(events.events) ? events.events : []);
    const offset = (num(map.game_time) ?? 0) - (num(map.clock_time) ?? 0);
    for (const ev of list) {
      if (!ev || ev.event_type !== 'roshan_killed') continue;
      const clock = (num(ev.game_time) ?? num(map.game_time) ?? 0) - offset;
      if (this.roshanKilledAt == null || clock > this.roshanKilledAt + 60) {
        this.roshanKilledAt = Math.round(clock);
        this.roshanKills++;
        this.log('info', 'roshan killed (event)', { clock: this.roshanKilledAt });
      }
    }
  }

  setRoshan(action) {
    if (action === 'killed') { this.roshanKilledAt = Math.round(this.clock()); this.roshanKills++; }
    else if (action === 'reset') { this.roshanKilledAt = null; this.roshanKills = Math.max(0, this.roshanKills - 1); }
  }

  setManual(side, ids) {
    if (side !== 'allies' && side !== 'enemies') return;
    this.manual[side] = [...new Set(ids.map(Number).filter((id) => heroByAny(id)))].slice(0, 5);
  }

  setScreen(allies, enemies) {
    const clean = (a) => [...new Set((a || []).map(Number).filter((id) => heroByAny(id)))].slice(0, 5);
    this.screen = { allies: clean(allies), enemies: clean(enemies) };
  }

  clock() {
    const map = (this.raw && this.raw.map) || {};
    return num(map.clock_time) ?? 0;
  }

  myTeam() {
    const p = (this.raw && this.raw.player) || {};
    const t = String(p.team_name || p.team || '').toLowerCase();
    return t === 'radiant' || t === 'dire' ? t : null;
  }

  lineup() {
    const myHero = heroByAny(this.raw && this.raw.hero ? (this.raw.hero.id || this.raw.hero.name) : null);
    const team = this.myTeam();
    const allies = [];
    const enemies = [];
    const taken = new Set();
    const add = (arr, id, source) => {
      if (!id || taken.has(id) || arr.length >= 5) return;
      taken.add(id);
      arr.push({ id, source });
    };
    if (myHero) add(allies, myHero.id, 'me');
    for (const p of this.draftPicks) {
      if (!team) add(p.id === (myHero && myHero.id) ? allies : enemies, p.id, 'draft');
      else add(p.team === team ? allies : enemies, p.id, 'draft');
    }
    for (const id of this.manual.allies) add(allies, id, 'manual');
    for (const id of this.manual.enemies) add(enemies, id, 'manual');
    for (const id of this.screen.allies) add(allies, id, 'screen');
    for (const id of this.screen.enemies) add(enemies, id, 'screen');
    return { allies, enemies, bans: this.draftBans.map((b) => b.id), draftLive: !!(this.raw && parseDraft(this.raw.draft).active) };
  }

  snapshot() {
    if (!this.raw) return { connected: false };
    const map = this.raw.map || {};
    const player = this.raw.player || {};
    const hero = this.raw.hero || {};
    const auth = this.raw.auth || {};
    const myHero = heroByAny(hero.id || hero.name || null);
    return {
      connected: true,
      simulated: auth.token === 'simulator',
      updates: this.updates,
      lastSeen: this.lastSeen,
      map: {
        gameState: map.game_state || null,
        matchId: map.matchid || null,
        clock: num(map.clock_time) ?? 0,
        paused: !!map.paused,
        daytime: map.daytime ?? null,
        nightstalkerNight: !!map.nightstalker_night,
        radiantScore: num(map.radiant_score),
        direScore: num(map.dire_score),
        winTeam: map.win_team && map.win_team !== 'none' ? map.win_team : null,
      },
      player: {
        name: player.name || null,
        accountId: player.accountid ? String(player.accountid) : (player.steamid ? String(BigInt(player.steamid) - 76561197960265728n) : null),
        team: this.myTeam(),
        kills: num(player.kills), deaths: num(player.deaths), assists: num(player.assists),
        lastHits: num(player.last_hits), denies: num(player.denies),
        gold: num(player.gold), gpm: num(player.gpm), xpm: num(player.xpm),
      },
      hero: myHero ? {
        id: myHero.id,
        level: num(hero.level),
        alive: hero.alive !== false,
        respawn: num(hero.respawn_seconds),
        health: num(hero.health), maxHealth: num(hero.max_health),
        mana: num(hero.mana), maxMana: num(hero.max_mana),
        buybackCost: num(hero.buyback_cost), buybackCooldown: num(hero.buyback_cooldown),
        scepter: !!hero.aghanims_scepter, shard: !!hero.aghanims_shard,
        talents: Object.keys(hero).some((k) => /^talent_\d$/.test(k)) ? Object.keys(hero).filter((k) => /^talent_\d$/.test(k) && hero[k]).length : null,
      } : null,
      abilities: parseAbilities(this.raw.abilities),
      items: parseItems(this.raw.items),
      lineup: this.lineup(),
      roshanKilledAt: this.roshanKilledAt,
      roshanKills: this.roshanKills,
    };
  }
}

module.exports = { MatchState, parseDraft };

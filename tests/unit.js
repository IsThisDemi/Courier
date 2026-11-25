// Unit tests without network or browser: node tests/unit.js
const assert = require('assert');
const path = require('path');
const { MatchState, parseDraft } = require('../lib/gsi-state');
const { classify } = require('../lib/probuild');
const { rankPicks, rankBans, smoothed } = require('../lib/suggest');
const { itemLifts, enemyPredictions } = require('../lib/counters');
const { skillBuild } = require('../lib/skills');
const { Match } = require('../tools/gsi-sim');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log('PASS  ' + name); }
  catch (e) { results.push([false, name]); console.log('FAIL  ' + name + '\n      ' + e.message); }
}

(async () => {
  await test('draft: Valve flat format', () => {
    const d = parseDraft({ activeteam: 2, team2: { home_team: true, pick0_id: 2, pick0_class: 'axe', ban0_id: 74, ban0_class: 'invoker' }, team3: { home_team: false, pick0_id: 32, pick0_class: 'riki' } });
    assert.deepStrictEqual(d.picks, [{ id: 2, team: 'radiant' }, { id: 32, team: 'dire' }]);
    assert.deepStrictEqual(d.bans, [{ id: 74, team: 'radiant' }]);
  });

  await test('draft: nested format and empty slots', () => {
    const d = parseDraft({ team2: { pick0: { name: 'npc_dota_hero_axe' }, pick1_id: 0, pick1_class: '' }, team3: { pick0: { id: 35 } } });
    assert.deepStrictEqual(d.picks.map((p) => p.id), [2, 35]);
  });

  await test('state: draft picks survive into the game, sides follow the player team', () => {
    const s = new MatchState();
    s.ingest({ map: { game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', matchid: '1' }, player: { team_name: 'dire' }, hero: { id: 32 },
      draft: { team2: { pick0_id: 2 }, team3: { pick0_id: 32, pick1_id: 35 } } });
    s.ingest({ map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', matchid: '1', clock_time: 60 }, player: { team_name: 'dire' }, hero: { id: 32 }, draft: {} });
    const l = s.lineup();
    assert.deepStrictEqual(l.allies.map((e) => [e.id, e.source]), [[32, 'me'], [35, 'draft']]);
    assert.deepStrictEqual(l.enemies.map((e) => e.id), [2]);
  });

  await test('state: new match resets manual heroes', () => {
    const s = new MatchState();
    s.ingest({ map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', matchid: '1' } });
    s.setManual('enemies', [2, 32]);
    assert.strictEqual(s.lineup().enemies.length, 2);
    s.ingest({ map: { game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION', matchid: '2' } });
    assert.strictEqual(s.lineup().enemies.length, 0);
  });

  await test('state: roshan_killed event starts the Roshan timer in clock time', () => {
    const s = new MatchState();
    s.ingest({ map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', game_time: 1320, clock_time: 1200 }, events: [{ event_type: 'roshan_killed', game_time: 1310 }] });
    assert.strictEqual(s.roshanKilledAt, 1190);
    assert.strictEqual(s.roshanKills, 1);
  });

  await test('suggest: matchup wins belong to the enemy, so a low enemy winrate means a good counter', () => {
    const matchupsByEnemy = { 32: [{ hero_id: 2, games_played: 200, wins: 60 }, { hero_id: 35, games_played: 200, wins: 140 }] };
    const ranked = rankPicks({ enemies: [32], matchupsByEnemy });
    const axe = ranked.find((p) => p.id === 2);
    const sniper = ranked.find((p) => p.id === 35);
    assert.ok(axe.counter > 15, 'axe should counter: ' + axe.counter);
    assert.ok(sniper.counter < -15, 'sniper should be countered: ' + sniper.counter);
    assert.ok(ranked.indexOf(axe) < ranked.indexOf(sniper));
    assert.ok(!ranked.some((p) => p.id === 32), 'enemy must be excluded');
  });

  await test('suggest: small samples are pulled towards 50%', () => {
    assert.ok(Math.abs(smoothed(3, 3) - 0.5) < 0.06);
    assert.ok(smoothed(300, 400) > 0.72);
  });

  await test('probuild: starting items, core order, intermediates hidden', () => {
    const total = 100;
    const row = (item, games, med_t, start_games = 0, start_total = 0) => ({ item, games, med_t, start_games, start_total, total, oldest: 1790000000 });
    const b = classify([
      row('tango', 90, -89, 80, 80), row('branches', 70, -89, 70, 140), row('boots', 99, 200),
      row('phase_boots', 98, 400), row('blink', 95, 900), row('yasha', 40, 1500), row('manta', 35, 1700),
      row('black_king_bar', 70, 1500), row('ogre_axe', 70, 1200), row('heart', 15, 2200),
    ]);
    assert.deepStrictEqual(b.starting.map((s) => [s.key, s.qty]), [['tango', 1], ['branches', 2]]);
    assert.deepStrictEqual(b.core.map((c) => c.key), ['phase_boots', 'blink', 'black_king_bar', 'manta']);
    assert.ok(!b.core.concat(b.situational).some((c) => ['boots', 'ogre_axe', 'yasha'].includes(c.key)));
    assert.deepStrictEqual(b.situational.map((c) => c.key), ['heart']);
  });

  await test('simulator: full draft is 5 v 5 in Valve format and the game payload is consistent', () => {
    const m = new Match({ hero: 'axe', enemies: 'riki,sniper', seed: 3 });
    const draft = m.payload({ phase: 'strategy', clock: -120 });
    const parsed = parseDraft(draft.draft);
    assert.strictEqual(parsed.picks.length, 10);
    assert.strictEqual(parsed.picks.filter((p) => p.team === 'radiant').length, 5);
    const game = m.payload({ phase: 'game', clock: 900 });
    assert.strictEqual(game.hero.name, 'npc_dota_hero_axe');
    assert.ok(game.hero.level >= 8 && game.hero.level <= 16, 'level ' + game.hero.level);
    assert.deepStrictEqual(game.draft, {});
    assert.strictEqual(game.auth.token, 'simulator');
  });

  await test('timers: next events from the clock', async () => {
    const { upcoming } = await import(path.join(__dirname, '..', 'renderer', 'js', 'timers.js'));
    const list = upcoming(754, null);
    const byId = Object.fromEntries(list.map((t) => [t.id, t]));
    assert.strictEqual(byId.power.left, 840 - 754);
    assert.strictEqual(byId.bounty.left, 960 - 754);
    assert.strictEqual(byId.stack.left, 773 - 754);
    assert.strictEqual(byId.tormentor.left, 900 - 754);
    assert.strictEqual(byId.neutral2.left, 900 - 754);
    const rosh = upcoming(1300, 1190).find((t) => t.id === 'roshan');
    assert.strictEqual(rosh.left, 1190 + 480 - 1300);
    const third = upcoming(2500, 2400, 3).find((t) => t.id === 'roshan');
    assert.strictEqual(third.left, 2400 + 6 * 60 - 2500, '3rd kill: window opens after 6 minutes');
    const many = upcoming(4000, 3900, 9).find((t) => t.id === 'roshan');
    assert.strictEqual(many.left, 3900 + 5 * 60 - 4000, 'never below 5 minutes');
  });

  await test('bans: heroes that beat our picks come first', () => {
    const matchupsByAlly = { 2: [{ hero_id: 32, games_played: 300, wins: 90 }, { hero_id: 35, games_played: 300, wins: 210 }] };
    const bans = rankBans({ allies: [2], matchupsByAlly });
    assert.strictEqual(bans[0].id, 32);
    assert.strictEqual(bans[0].beats[0].id, 2);
    assert.ok(!bans.some((b) => b.id === 2));
  });

  await test('counter items: bought more often against the hero, components and greed items ignored', () => {
    const g = (id, games, wins) => ({ item_id: id, games, wins, players: 60000 });
    const v = (id, games, wins) => ({ item_id: id, games, wins, players: 1000 });
    const globalRows = [g(135, 1200, 600), g(116, 6000, 3000), g(65, 900, 450), g(162, 800, 400), g(149, 900, 470)];
    // 135 MKB: bought 3x more vs this hero; 116 BKB: normal; 65 Hand of Midas: greed; 162 Sange: component.
    const vsRows = [v(135, 60, 36), v(116, 100, 50), v(65, 40, 30), v(162, 40, 30), v(149, 15, 8)];
    const lifts = itemLifts(vsRows, globalRows);
    assert.strictEqual(lifts[0].key, 'monkey_king_bar');
    assert.ok(!lifts.some((x) => ['hand_of_midas', 'sange', 'lesser_crit'].includes(x.key)), lifts.map((x) => x.key).join(','));
    assert.ok(!lifts.some((x) => x.key === 'black_king_bar'), 'BKB is bought as often as usual');
  });

  await test('enemy predictions attach item answers', () => {
    const p = enemyPredictions([{ hero: 44, build: { source: 'pro', core: [{ key: 'butterfly', name: 'Butterfly', time: 1700, pct: 0.6 }] } }]);
    assert.deepStrictEqual(p[0].items[0].answer.items.map((x) => x.key), ['monkey_king_bar', 'bloodthorn']);
  });

  await test('skill build: most common ability per level, never above what pros levelled', () => {
    const a = [5008, 5009, 5009, 5007, 5009, 5010, 5009, 5008, 5007, 5008, 9401];
    const b = [5009, 5008, 5009, 5007, 5009, 5010, 5009, 5008, 5007, 5008, 6102];
    const rows = [a, a, a, b, b].map((arr) => ({ arr }));
    const sb = skillBuild(rows);
    assert.strictEqual(sb.sequence[0].name, 'axe_battle_hunger');
    assert.strictEqual(sb.sequence.filter((x) => x.name === 'axe_counter_helix').length, 4);
    assert.strictEqual(sb.sequence[5].name, 'axe_culling_blade');
    assert.ok(sb.sequence[10].talent);
  });

  await test('next skill point follows the pro order', async () => {
    const { nextSkill } = await import(path.join(__dirname, '..', 'renderer', 'js', 'items.js'));
    const seq = ['axe_battle_hunger', 'axe_counter_helix', 'axe_counter_helix', 'axe_berserkers_call'].map((name, i) => ({ level: i + 1, name, label: name, talent: false }));
    const snap = { hero: { level: 3, talents: 0 }, abilities: [{ name: 'axe_battle_hunger', level: 1 }, { name: 'axe_counter_helix', level: 1 }, { name: 'axe_berserkers_call', level: 0 }] };
    assert.strictEqual(nextSkill({ sequence: seq }, snap).name, 'axe_counter_helix');
    snap.abilities[1].level = 2;
    assert.strictEqual(nextSkill({ sequence: seq }, snap), null, 'no unspent points');
  });

  await test('gsi sampler: keys per kind, last payload per phase, events, simulator ignored', () => {
    const fs = require('fs');
    const os = require('os');
    const { GsiSampler } = require('../lib/gsi-sampler');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsi-'));
    const s = new GsiSampler(dir, { every: 0 });
    s.add({ auth: { token: 'simulator' }, map: { game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' } });
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    s.add({
      auth: { token: 'x' }, previously: { map: { clock_time: 1 } },
      map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 600, roshan_state: 'alive' },
      items: { slot0: { name: 'item_tango' }, slot1: { name: 'empty' } },
      draft: { team2: { pick0_id: 2 } },
      events: [{ event_type: 'aegis_picked_up', player_id: 3 }],
    });
    s.add({ map: { game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 601 }, events: { events: [{ event_type: 'aegis_picked_up', player_id: 3 }] } });
    const keys = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(keys), ['draft.team2.pick#_id', 'events', 'events.events', 'items.slot#.name', 'map.clock_time', 'map.game_state', 'map.roshan_state']);
    assert.strictEqual(keys['items.slot#.name'], 'item_tango');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state-game_in_progress.json'), 'utf8'));
    assert.strictEqual(saved.auth, undefined);
    const ev = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(ev, [{ clock: 600, event_type: 'aegis_picked_up', player_id: 3 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('patches: current patch first, widened only when the games are too few', async () => {
    const { patchList, windows, withPatch } = require('../lib/patches');
    const list = patchList([{ name: '7.41', date: '2026-03-24T00:50:59Z' }, { name: '7.42', date: '2026-11-18T21:28:07Z' }, { name: '7.40', date: '2025-12-16T00:50:40Z' }]);
    assert.deepStrictEqual(list.map((p) => p.name), ['7.42', '7.41', '7.40']);
    const w = windows(list);
    assert.deepStrictEqual(w.map((x) => x.name), ['7.42', '7.41–7.42', '7.40–7.42']);
    const games = { [w[0].since]: 5, [w[1].since]: 40, [w[2].since]: 90 };
    const got = await withPatch(w, 20, async (since) => ({ games: games[since] }));
    assert.strictEqual(got.patch.name, '7.41–7.42');
    assert.strictEqual(got.patch.widened, true);
    assert.ok(patchList(null).length > 3, 'bundled list when OpenDota is down');
  });

  await test('positions: shares and the most played one', () => {
    const { positionShares, validPos, positionsSql } = require('../lib/positions');
    const r = positionShares([{ position: 1, games: 10 }, { position: 3, games: 30 }]);
    assert.strictEqual(r.main, 3);
    assert.strictEqual(r.positions.find((p) => p.pos === 3).share, 0.75);
    assert.strictEqual(validPos('7'), null);
    assert.strictEqual(validPos('2'), 2);
    assert.ok(/m\.start_time >= 1700000000/.test(positionsSql(2, 1700000000)));
  });

  await test('neutrals: artifacts per tier from the pick history, enchantments offered to the hero attribute', () => {
    const { neutralPicks, neutralsSql, TIERS } = require('../lib/neutrals');
    const t3 = TIERS.find((t) => t.tier === 3).artifacts[0];
    const row = (kind, item, games) => ({ kind, item, games, total: 50 });
    const r = neutralPicks([row('a', t3, 20), row('e', 'enhancement_tough', 10), row('e', 'enhancement_alert', 5), row('r3', null, 40)], 'str');
    const tier3 = r.tiers.find((t) => t.tier === 3);
    assert.strictEqual(tier3.artifacts[0].key, t3);
    assert.strictEqual(tier3.artifacts[0].share, 0.5, 'share over the games with a tier 3 artifact');
    assert.deepStrictEqual(r.enchantments.map((e) => e.key), ['enhancement_tough'], 'alert is not offered to strength heroes');
    assert.ok(neutralsSql(2, { since: 1 }).includes(`WHEN art IN ('${t3}'`), 'tier from the artifact itself');
    const ids = require('../renderer/data/items.json');
    const fin = neutralPicks([{ kind: 'a', item_id: ids[t3].id, games: 10, total: 40 }], 'agi');
    assert.strictEqual(fin.fromHistory, false);
    assert.strictEqual(fin.tiers.find((t) => t.tier === 3).artifacts[0].share, 0.25);
  });

  await test('counter items: only from the hero item pool when there is one', () => {
    const { counterItems } = require('../lib/counters');
    const { itemPool } = require('../lib/probuild');
    const global = [135, 116].map((id) => ({ item_id: id, games: 3000, wins: 1500, players: 60000 }));
    const vs = { 32: [{ item_id: 135, games: 120, wins: 60, players: 1000 }, { item_id: 116, games: 120, wins: 60, players: 1000 }] };
    assert.strictEqual(counterItems([32], vs, global).length, 2);
    const pool = itemPool([{ item: 'black_king_bar', games: 40, total: 100 }, { item: 'monkey_king_bar', games: 2, total: 100 }]);
    assert.deepStrictEqual(counterItems([32], vs, global, pool).map((c) => c.key), ['black_king_bar']);
  });

  await test('build: late items counted on the games still running, then offered as a choice', async () => {
    const r = (item, games, med_t, alive) => ({ item, games, med_t, alive, start_games: 0, start_total: 0, total: 100, oldest: 1 });
    const b = classify([r('phase_boots', 98, 400, 100), r('black_king_bar', 80, 1500, 97), r('shivas_guard', 18, 2100, 60), r('heart', 15, 2100, 60)]);
    assert.deepStrictEqual(b.core.map((c) => c.key), ['phase_boots', 'black_king_bar']);
    assert.deepStrictEqual(b.situational.map((c) => c.key), ['shivas_guard', 'heart']);
    assert.strictEqual(b.situational[0].pct, 0.3, '18 of the 60 games still running at 35 minutes');
    const { nextBuy } = await import(path.join(__dirname, '..', 'renderer', 'js', 'items.js'));
    const snap = { items: { inventory: [{ key: 'phase_boots' }, { key: 'black_king_bar' }], backpack: [] } };
    assert.strictEqual(nextBuy(b, snap, []).key, 'shivas_guard');
    const vsHeart = nextBuy(b, snap, [{ key: 'heart', vs: [{ id: 999999 }] }]);
    assert.strictEqual(vsHeart.key, 'heart', 'an answer to the enemies comes first');
    assert.strictEqual(vsHeart.choice, true);
    const early = { items: { inventory: [{ key: 'phase_boots' }], backpack: [] } };
    assert.strictEqual(nextBuy(b, early, [], 1200).key, 'black_king_bar');
    assert.strictEqual(nextBuy(b, early, [], 2200).key, 'shivas_guard', 'BKB is 10 minutes late: skipped');
  });

  const failed = results.filter((r) => !r[0]).length;
  console.log(failed ? `${failed} test falliti` : `tutti i ${results.length} test passati`);
  process.exit(failed ? 1 : 0);
})();

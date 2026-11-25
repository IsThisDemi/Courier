// End-to-end test in headless Chromium (no window is ever shown), with a fake OpenDota.
// Starts its own server on a spare port with a throwaway data folder: node tests/e2e.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Match } = require('../tools/gsi-sim');

const ROOT = path.join(__dirname, '..');
const PORT = 51303;
const BASE = `http://127.0.0.1:${PORT}`;
const { fakeOpenDota, explorerSql } = require('./fake-opendota');

const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ': ' + extra : ''}`); };
const post = (payload) => fetch(BASE + '/gsi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

(async () => {
  const fake = await fakeOpenDota();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-e2e-'));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, COURIER_PORT: String(PORT), COURIER_DATA: dataDir, OPENDOTA_BASE: `http://127.0.0.1:${fake.address().port}`, COURIER_MIN_INTERVAL: '0' },
    stdio: 'ignore',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    // 1. Draft from GSI, half way through.
    const match = new Match({ hero: 'axe', enemies: 'riki,sniper,lion,zeus,phantom_assassin', allies: 'crystal_maiden,juggernaut,tidehunter,storm_spirit', seed: 1 });
    await post(match.payload({ phase: 'draft', clock: -120, draftProgress: 0.45 }));
    await page.waitForFunction(() => document.querySelectorAll('#lineup .slot[data-id]').length >= 3, null, { timeout: 5000 }).catch(() => {});
    const partial = await page.locator('#lineup .slot[data-id]').count();
    check('draft in progress shows the picks made so far', partial >= 3 && partial < 10, `${partial} slot`);
    check('status says simulated match', /simulata/i.test(await page.locator('#status-text').innerText()));

    // 2. Draft complete: 5 v 5, matrix with 5 enemy columns.
    await post(match.payload({ phase: 'strategy', clock: -120 }));
    await page.waitForFunction(() => document.querySelectorAll('#lineup .slot[data-id]').length === 10, null, { timeout: 5000 }).catch(() => {});
    check('full draft fills both teams', (await page.locator('#lineup .slot[data-id]').count()) === 10);
    await page.waitForSelector('#bans .ban', { timeout: 10000 }).catch(() => {});
    check('ban suggestions during the draft', (await page.locator('#bans .ban').count()) >= 3);
    await page.waitForSelector('#picks .mx-row:not(.mx-head):not(.mx-groups)', { timeout: 10000 }).catch(() => {});
    check('matchup matrix has one column per enemy', (await page.locator('#picks .mx-head .mx-enemy').count()) === 5);
    check('matrix lists suggested heroes', (await page.locator('#picks .mx-row:not(.mx-head):not(.mx-groups)').count()) >= 5);
    await page.click('#role-filter [data-role="Support"]');
    const roleOk = await page.locator('#picks .mx-row:not(.mx-head):not(.mx-groups)').count();
    check('role filter keeps working', roleOk >= 1, `${roleOk} support`);

    // 3. Game starts: the live tab opens by itself with clock, time column and hero.
    for (const clock of [598, 599, 600]) { await post(match.payload({ phase: 'game', clock })); await new Promise((r) => setTimeout(r, 200)); }
    await page.waitForFunction(() => document.querySelector('#view-live[data-active]'), null, { timeout: 5000 }).catch(() => {});
    check('live tab opens when the game starts', await page.locator('#view-live[data-active]').count() === 1);
    const clockText = await page.locator('.clock').innerText();
    check('clock follows GSI', /^10:0[0-2]$/.test(clockText.trim()), clockText);
    check('time column lists upcoming objectives', (await page.locator('#timeline .tl-row:not(.tl-now)').count()) >= 3);
    check('hero panel shows Axe', /Axe/.test(await page.locator('#hero-panel .hero-name').innerText()));
    check('abilities and items are drawn', (await page.locator('#hero-panel .ability').count()) >= 4 && (await page.locator('#hero-panel .item img').count()) >= 3);

    // 4. Roshan killed event from GSI.
    const k = match.roshanKills[0];
    await post(match.payload({ phase: 'game', clock: k + 2 }));
    await page.waitForFunction(() => /Roshan/.test(document.querySelector('#timeline').innerText), null, { timeout: 4000 }).catch(() => {});
    check('roshan_killed event adds the Roshan window', /Roshan/.test(await page.locator('#timeline').innerText()));
    check('Aegis expiry is tracked', /Aegis/.test(await page.locator('#timeline').innerText()));
    await page.click('.tabs [data-tab="items"]');
    await page.waitForSelector('#predictions .prediction', { timeout: 10000 }).catch(() => {});
    await page.click('.tabs [data-tab="live"]');
    await post(match.payload({ phase: 'game', clock: 300 }));
    await page.waitForFunction(() => document.querySelector('#timeline .tl-enemy'), null, { timeout: 5000 }).catch(() => {});
    check('estimated enemy items appear in the time column', (await page.locator('#timeline .tl-enemy').count()) >= 1);
    check('next item hint under the clock', /Compra/.test(await page.locator('#next-up').innerText()));

    // 5. Items tab: pro build with order and "next" marker.
    await page.click('.tabs [data-tab="items"]');
    await page.waitForSelector('#build .step', { timeout: 10000 }).catch(() => {});
    check('pro build lists purchase order', (await page.locator('#build .step').count()) === 3);
    check('starting items with quantity', /×2/.test(await page.locator('#build .start-items').innerText()));
    await page.waitForSelector('#counter-items .counter-item', { timeout: 10000 }).catch(() => {});
    const counters = await page.locator('#counter-items').innerText();
    check('counter items come from pro data', /Monkey King Bar/.test(counters) && /I pro lo comprano/.test(counters), counters.slice(0, 80));
    check('counter items are limited to what the hero builds', !/Black King Bar|Heart/.test(counters) || counters.includes('Solo oggetti che i pro comprano su Axe'), counters.slice(0, 120));
    await page.waitForSelector('#skills .skill-step', { timeout: 10000 }).catch(() => {});
    check('pro skill order is shown', (await page.locator('#skills .skill-step').count()) >= 10);

    // 5b. Position: the most played one is picked, a click filters build, skills and neutrals.
    check('most played position is preselected', /3\s*Offlane/.test(await page.locator('#position-items [aria-checked="true"]').innerText().catch(() => '')));
    const src = await page.locator('#build .build-source').innerText();
    check('build says patch and position', /pos 3 Offlane/.test(src) && /patch 7\.4/i.test(src), src);
    await page.waitForSelector('#neutrals .neu', { timeout: 10000 }).catch(() => {});
    const neu = await page.locator('#neutrals').innerText();
    check('neutral items per tier', /Livello 3/.test(neu) && /Stormcrafter/.test(neu) && /Tough/.test(neu), neu.slice(0, 80));
    const before = explorerSql.length;
    await page.click('#position-items [data-pos="1"]');
    await page.waitForFunction(() => /pos 1 Carry/.test(document.querySelector('#build .build-source')?.innerText || ''), null, { timeout: 10000 }).catch(() => {});
    check('choosing a position reloads the build for it', /pos 1 Carry/.test(await page.locator('#build .build-source').innerText()));
    const newSql = explorerSql.slice(before);
    check('pro queries are filtered by position and patch', newSql.some((q) => /pos\.position = 1/.test(q) && /start_time >= \d+/.test(q)), `${newSql.length} queries`);
    check('position is remembered for the hero', await page.evaluate(() => localStorage.getItem('dc_pos_2')) === '1');
    await page.waitForSelector('#predictions .prediction', { timeout: 10000 }).catch(() => {});
    check('enemy item predictions per enemy', (await page.locator('#predictions .prediction').count()) === 5);

    // 6. Bot game: no draft data, enemies added by hand through the picker.
    await fetch(BASE + '/api/lineup', { method: 'POST', body: JSON.stringify({ reset: true }) });
    const bots = new Match({ hero: 'sniper', draft: 'none', seed: 2 });
    await post(bots.payload({ phase: 'game', clock: 300 }));
    await page.click('.tabs [data-tab="draft"]');
    await page.waitForFunction(() => document.querySelectorAll('#lineup .team[data-side="enemies"] .slot[data-id]').length === 0, null, { timeout: 4000 }).catch(() => {});
    await page.click('#lineup .team[data-side="enemies"] .slot[data-add]');
    await page.fill('#picker-search', 'riki');
    await page.press('#picker-search', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#lineup .team[data-side="enemies"] .slot[data-id]').length === 1, null, { timeout: 4000 }).catch(() => {});
    const manual = await page.locator('#lineup .team[data-side="enemies"] .slot[data-source="manual"]').count();
    check('enemy added by hand through the picker', manual === 1);
    await page.waitForFunction(() => document.querySelectorAll('#picks .mx-head .mx-enemy').length === 1, null, { timeout: 8000 }).catch(() => {});
    check('matrix recomputed for the manual enemy', (await page.locator('#picks .mx-head .mx-enemy').count()) === 1);
    await page.click('#lineup .team[data-side="enemies"] .slot[data-source="manual"]');
    await page.click('#picker-remove');
    await page.waitForFunction(() => document.querySelectorAll('#lineup .team[data-side="enemies"] .slot[data-id]').length === 0, null, { timeout: 4000 }).catch(() => {});
    check('manual enemy can be removed', (await page.locator('#lineup .team[data-side="enemies"] .slot[data-id]').count()) === 0);

    // 7. Settings are saved without dialogs.
    await page.click('#open-settings');
    await page.fill('#set-enemies', '111, 222');
    await page.click('#settings-save');
    await page.waitForFunction(() => document.querySelector('#settings-save').textContent === 'Salvato', null, { timeout: 4000 }).catch(() => {});
    const saved = await (await fetch(BASE + '/api/settings')).json();
    check('settings saved', JSON.stringify(saved.enemyAccountIds) === '["111","222"]');

    // 8. My heroes: a Steam64 ID is converted and the filter appears.
    await page.keyboard.press('Escape');
    await page.click('#open-settings');
    await page.fill('#set-me', '76561197999999999');
    await page.click('#settings-save');
    await page.waitForFunction(() => document.querySelector('#settings-save').textContent === 'Salvato', null, { timeout: 4000 }).catch(() => {});
    const s2 = await (await fetch(BASE + '/api/settings')).json();
    check('Steam64 ID converted to account ID', s2.myAccountId === '39734271', s2.myAccountId);
    await page.keyboard.press('Escape');
    await post(bots.payload({ phase: 'game', clock: 310 }));
    await fetch(BASE + '/api/lineup', { method: 'POST', body: JSON.stringify({ side: 'enemies', ids: [32, 35] }) });
    await page.waitForSelector('#role-filter [data-role="mine"]', { timeout: 10000 }).catch(() => {});
    check('"I miei eroi" filter available', (await page.locator('#role-filter [data-role="mine"]').count()) === 1);

    // 9. Post-game summary from OpenDota (a real, non simulated payload).
    const real = new Match({ hero: 'axe', seed: 5 }).payload({ phase: 'post', clock: 2400 });
    delete real.auth;
    real.player.accountid = '39734272';
    await post(real);
    await page.click('.tabs [data-tab="live"]');
    await page.waitForFunction(() => /Vittoria/.test(document.querySelector('#postgame').innerText), null, { timeout: 8000 }).catch(() => {});
    const pg = await page.locator('#postgame').innerText();
    check('post-game summary with benchmarks and item timings', /Vittoria/.test(pg) && /71°/.test(pg) && /Blink Dagger/.test(pg), pg.slice(0, 120));

    // 10. Help sheet with shortcuts.
    await page.click('#open-help');
    check('help sheet lists the shortcuts', await page.locator('#help:not([hidden]) kbd').count() >= 10);
    await page.keyboard.press('Escape');
    check('help sheet closes with Escape', await page.locator('#help[hidden]').count() === 1);

    // 11. Pick screen read from the screen: the game sends no picks, the capture shows them.
    await fetch(BASE + '/api/lineup', { method: 'POST', body: JSON.stringify({ reset: true }) });
    const cap = await browser.newPage({ viewport: { width: 430, height: 900 } });
    cap.on('pageerror', (e) => errors.push(e.message));
    await cap.addInitScript(() => {
      // fake desktop capture: a pick screen with heroes locked on both teams and one only hovered (grey)
      const shown = { 2: 'crystal_maiden', 6: 'riki', 9: 'lion' };
      window.dotaCapture = {
        sources: async () => [{ id: 'dota', name: 'Dota 2' }],
        shot: async () => {
          const W = 1920, H = 1080;
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
          const c = cv.getContext('2d');
          c.fillStyle = '#20262f'; c.fillRect(0, 0, W, H);
          const slots = window.Detect.draftSlots(W, H);
          const load = (n) => new Promise((r) => { const m = new Image(); m.onload = () => r(m); m.src = 'data/portraits/' + n + '.png'; });
          for (const [i, n] of Object.entries(shown)) { const s = slots[i]; c.drawImage(await load(n), s.x, s.y, s.w, s.h); }
          const s = slots[4]; c.filter = 'grayscale(1)'; c.drawImage(await load('axe'), s.x, s.y, s.w, s.h);
          return { dataUrl: cv.toDataURL('image/png') };
        },
      };
    });
    await cap.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await post(new Match({ hero: 'sniper', draft: 'none', seed: 4 }).payload({ phase: 'draft', clock: -60 }));
    await cap.waitForFunction(() => document.querySelectorAll('#lineup .slot[data-source="screen"]').length >= 3, null, { timeout: 12000 }).catch(() => {});
    const fromScreen = await (await fetch(BASE + '/api/state')).json();
    const ids = (side) => fromScreen.lineup[side].filter((x) => x.source === 'screen').map((x) => x.id).sort((a, b) => a - b);
    check('pick screen read from the screen', JSON.stringify(ids('enemies')) === '[26,32]' && ids('allies').includes(5), JSON.stringify(fromScreen.lineup));
    check('hovered (grey) hero ignored on the pick screen', !fromScreen.lineup.allies.concat(fromScreen.lineup.enemies).some((x) => x.id === 2));
    await cap.close();

    check('no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} controlli falliti` : `tutti i ${results.length} controlli passati`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

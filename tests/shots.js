// Headless screenshots of every tab fed by the GSI simulator. Never opens a visible window.
//   node tests/shots.js [outDir] [--clock 754] [--hero axe] [--enemies a,b] [--width 430]
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const outDir = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, 'shots');
const PORT = Number(opt('port', 51302));
const ROOT = path.join(__dirname, '..');
const BASE = `http://127.0.0.1:${PORT}`;

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // --fake: answers from tests/fake-opendota.js instead of the real OpenDota
  const fake = args.includes('--fake') ? await require('./fake-opendota').fakeOpenDota() : null;
  const dataDir = opt('data', fake ? fs.mkdtempSync(path.join(os.tmpdir(), 'dc-shots-')) : path.join(os.tmpdir(), 'courier-shots'));
  const fakeEnv = fake ? { OPENDOTA_BASE: `http://127.0.0.1:${fake.address().port}`, COURIER_MIN_INTERVAL: '0' } : {};
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, COURIER_PORT: String(PORT), COURIER_DATA: dataDir, ...fakeEnv },
    stdio: 'ignore',
  });
  try {
    await waitHealth();
    const sim = ['tools/gsi-sim.js', '--port', String(PORT), '--scenario', 'snapshot', '--quiet',
      '--clock', opt('clock', '754'), '--hero', opt('hero', 'axe'), '--enemies', opt('enemies', 'riki,sniper,lion,zeus,phantom_assassin'),
      '--allies', opt('allies', 'crystal_maiden,juggernaut,tidehunter,storm_spirit')];
    execFileSync(process.execPath, sim, { cwd: ROOT });
    // Keep the snapshot fresh while the browser works, so the status shows a live simulated match.
    const keepAlive = spawn(process.execPath, [...sim, '--no-draft-replay', '--duration', '120'], { cwd: ROOT, stdio: 'ignore' });
    process.on('exit', () => keepAlive.kill());
    const browser = await chromium.launch({ headless: true });
    const width = Number(opt('width', 430));
    const page = await browser.newPage({ viewport: { width, height: 1400 }, deviceScaleFactor: 2 });
    // --overlay 0.7: fake the desktop overlay bridge and capture with a transparent background.
    const overlayAlpha = opt('overlay', null);
    if (overlayAlpha) {
      await page.addInitScript(([alpha, compact]) => {
        const state = { clickThrough: false, autoClickThrough: false, backgroundAlpha: Number(alpha), compact };
        window.dotaOverlay = {
          get: async () => state, hide() {}, setClickThrough() {}, setBackgroundAlpha() {}, setAutoClickThrough() {}, reportPhase() {},
          onState() {}, onTab() {}, onRoshan() {},
        };
      }, [overlayAlpha, opt('compact', '0') === '1']);
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#picks .mx-row, #picks .meta-hero'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const compact = opt('compact', '0') === '1';
    for (const tab of compact ? ['live'] : ['draft', 'live', 'items']) {
      if (!compact) await page.click(`.tabs [data-tab="${tab}"]`);
      if (tab === 'items') await page.waitForFunction(() => document.querySelector('#build .step'), null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(700);
      // compact: the window height the app would ask for (bar + content), as in overlay.js
      const fitH = () => page.evaluate(() => Math.ceil(document.querySelector('.bar').getBoundingClientRect().height + document.querySelector('main').getBoundingClientRect().height) + 2);
      const h = overlayAlpha ? (compact ? await fitH() : 760) : await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width, height: Math.min(h, 2400) });
      await page.screenshot({ path: path.join(outDir, `${overlayAlpha ? (compact ? 'overlay-compact-' : 'overlay-') : ''}${tab}.png`), fullPage: !overlayAlpha, omitBackground: !!overlayAlpha });
      await page.setViewportSize({ width, height: 1400 });
    }
    if (!overlayAlpha) {
      await page.click('.tabs [data-tab="draft"]');
      await page.click('#lineup .slot[data-add]').catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, 'picker.png') });
      await page.keyboard.press('Escape');
      await page.click('#open-help');
      await page.waitForTimeout(300);
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(outDir, 'help.png') });
    }
    await browser.close();
    console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
    console.log('screenshots in ' + outDir);
  } finally {
    if (fake) fake.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });

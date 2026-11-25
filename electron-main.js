// Electron shell: a frameless, semi-transparent overlay that stays above Dota 2 (borderless window mode).
// Starts server.js in the same process when it is not already running.
const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, ipcMain, desktopCapturer, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const gsi = require('./lib/gsi-install');

const env = (name) => process.env['COURIER_' + name] ?? process.env['DOTA_COMPANION_' + name];
const PORT = Number(env('PORT') || 51234);
const URL = `http://127.0.0.1:${PORT}/`;
const SMOKE = env('SMOKE') === '1'; // headless self-check: the window is never shown

let win = null;
let tray = null;
let clickThrough = false;
let autoClickThrough = false;

const prefsFile = () => path.join(app.getPath('userData'), 'overlay.json');
const DEFAULT_PREFS = { bounds: null, backgroundAlpha: 0.86, autoClickThrough: false, compact: false, fullHeight: null, gsiNoticeShown: false };
function readPrefs() {
  // Le preferenze di quando l'app si chiamava Dota Companion, se ci sono.
  const legacy = path.join(app.getPath('appData'), 'dota-companion', 'overlay.json');
  try { if (!fs.existsSync(prefsFile()) && fs.existsSync(legacy)) fs.copyFileSync(legacy, prefsFile()); } catch {}
  try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { return { ...DEFAULT_PREFS }; }
}
let prefs = DEFAULT_PREFS;
function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch {}
}

function ensureServer() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}health`, (res) => { res.resume(); resolve(true); });
    req.on('error', () => {
      try { require('./server.js').start(PORT); } catch (e) { console.error(e); }
      setTimeout(resolve, 800);
    });
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 380;
  const height = Math.min(760, area.height - 80);
  return { width, height, x: area.x + area.width - width - 16, y: area.y + 60 };
}

function sendState() {
  if (win) win.webContents.send('overlay:state', { clickThrough, autoClickThrough, backgroundAlpha: prefs.backgroundAlpha, compact: !!prefs.compact });
}

function setClickThrough(on) {
  if (!win) return;
  clickThrough = !!on;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  sendState();
  refreshTray();
}

// Compact mode shrinks the window to its content (the page reports the height); the full height comes back after.
const COMPACT_HEIGHT = 350;
const COMPACT_MIN = 150;
function setCompact(on) {
  if (!win) return;
  const b = win.getBounds();
  if (on && !prefs.compact) savePrefs({ fullHeight: b.height });
  savePrefs({ compact: !!on });
  win.setMinimumSize(320, on ? COMPACT_MIN : 360);
  win.setBounds({ ...b, height: on ? COMPACT_HEIGHT : Math.max(COMPACT_HEIGHT + 100, prefs.fullHeight || 760) });
  savePrefs({ bounds: win.getBounds() });
  sendState();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function createWindow() {
  const bounds = prefs.bounds || defaultBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: prefs.compact ? COMPACT_MIN : 360,
    title: 'Courier',
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(URL);
  if (!SMOKE) win.once('ready-to-show', () => win.show());
  const remember = () => { if (win && !win.isMinimized()) savePrefs({ bounds: win.getBounds() }); };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', sendState);
}

// Il file GSI dentro Dota: senza, il gioco non manda niente. Si scrive da solo all'avvio, se Dota
// si trova; se no, dal menu dell'icona si sceglie la cartella a mano.
let gsiState = { installed: false };
function ensureGsi(hint) {
  try {
    const st = gsi.status({ port: PORT, hint });
    if (st.dota && !st.current) gsi.install({ port: PORT, hint });
    gsiState = gsi.status({ port: PORT, hint });
  } catch (e) { console.warn('gsi: ' + e.message); gsiState = { installed: false }; }
  if (gsiState.installed && !prefs.gsiNoticeShown && !SMOKE) {
    savePrefs({ gsiNoticeShown: true });
    dialog.showMessageBox({
      type: 'info',
      title: 'Courier',
      message: 'Courier è collegato a Dota 2',
      detail: 'Ultimo passo, una volta sola: su Steam apri Dota 2 → Proprietà → Generale → Opzioni di avvio e aggiungi\n\n-gamestateintegration\n\nPoi gioca in modalità finestra senza bordi, così Courier può stare sopra il gioco.',
    });
  }
  refreshTray();
}

async function chooseDotaFolder() {
  const r = await dialog.showOpenDialog({
    title: 'Dov\'è installato Dota 2?',
    message: 'Scegli la cartella "dota 2 beta" (di solito in steamapps\\common)',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return;
  ensureGsi(r.filePaths[0]);
  if (!gsiState.installed) dialog.showErrorBox('Courier', 'In quella cartella non c\'è Dota 2: scegli "dota 2 beta".');
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostra o nascondi (Alt+D)', click: toggleVisible },
    { label: 'Clic passanti (Alt+T)', type: 'checkbox', checked: clickThrough, click: (m) => setClickThrough(m.checked) },
    { label: 'Compatta (Alt+C)', type: 'checkbox', checked: !!prefs.compact, click: (m) => setCompact(m.checked) },
    { label: 'Torna alla posizione iniziale', click: () => { if (win) { win.setBounds(defaultBounds()); savePrefs({ bounds: null }); } } },
    { type: 'separator' },
    gsiState.installed
      ? { label: 'Collegamento con Dota: attivo', enabled: false }
      : { label: 'Collega a Dota 2…', click: () => chooseDotaFolder() },
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]));
}

ipcMain.handle('dota:sources', async () => {
  const srcs = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: false });
  return srcs.map((s) => ({ id: s.id, name: s.name }));
});
ipcMain.handle('dota:shot', async (_e, sourceId, width) => {
  const w = Math.min(Number(width) || 1280, 1920);
  const srcs = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: w, height: Math.round((w * 9) / 16) },
    fetchWindowIcons: false,
  });
  const s = srcs.find((x) => x.id === sourceId);
  return s ? s.thumbnail.toDataURL() : null;
});
ipcMain.handle('overlay:get', () => ({ clickThrough, autoClickThrough, backgroundAlpha: prefs.backgroundAlpha, compact: !!prefs.compact }));
ipcMain.on('overlay:hide', () => { if (win) win.hide(); });
ipcMain.on('overlay:click-through', (_e, on) => setClickThrough(on));
ipcMain.on('overlay:alpha', (_e, alpha) => {
  const a = Math.min(1, Math.max(0.2, Number(alpha) || DEFAULT_PREFS.backgroundAlpha));
  savePrefs({ backgroundAlpha: a });
  sendState();
});
ipcMain.on('overlay:compact', (_e, on) => setCompact(on));
ipcMain.on('overlay:fit', (_e, h) => {
  if (!win || !prefs.compact || !Number.isFinite(Number(h))) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const height = Math.round(Math.min(Math.max(Number(h), COMPACT_MIN), area.height - 40));
  if (Math.abs(height - b.height) > 2) { win.setBounds({ ...b, height }); savePrefs({ bounds: win.getBounds() }); }
});
ipcMain.on('overlay:auto', (_e, on) => { autoClickThrough = !!on; savePrefs({ autoClickThrough }); sendState(); });
// With automatic mode on, clicks pass to the game while a match is running and come back in draft.
ipcMain.on('overlay:phase', (_e, inGame) => { if (autoClickThrough && clickThrough !== !!inGame) setClickThrough(!!inGame); });

function registerShortcuts() {
  const shortcuts = {
    'Alt+D': toggleVisible,
    'Alt+T': () => setClickThrough(!clickThrough),
    'Alt+1': () => win && win.webContents.send('overlay:tab', 'draft'),
    'Alt+2': () => win && win.webContents.send('overlay:tab', 'live'),
    'Alt+3': () => win && win.webContents.send('overlay:tab', 'items'),
    'Alt+R': () => win && win.webContents.send('overlay:roshan'),
    'Alt+C': () => setCompact(!prefs.compact),
  };
  for (const [key, fn] of Object.entries(shortcuts)) {
    try { if (!globalShortcut.register(key, fn)) console.warn('shortcut already taken: ' + key); } catch {}
  }
}

app.whenReady().then(async () => {
  if (SMOKE && app.dock) app.dock.hide();
  prefs = readPrefs();
  autoClickThrough = !!prefs.autoClickThrough;
  await ensureServer();
  createWindow();
  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const result = await win.webContents.executeJavaScript(`({
        overlayApi: typeof window.dotaOverlay === 'object',
        captureApi: typeof window.dotaCapture === 'object',
        overlayClass: document.documentElement.classList.contains('overlay'),
        tabs: document.querySelectorAll('.tabs [role=tab]').length,
      })`);
      console.log('SMOKE ' + JSON.stringify(result));
      app.exit(0);
    });
    return;
  }
  registerShortcuts();
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon-16.png' : 'icon-32.png')));
    tray.setToolTip('Courier');
    tray.on('click', toggleVisible);
    refreshTray();
  } catch {}
  ensureGsi();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

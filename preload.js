// Preload: IPC bridge for screen capture and overlay controls (both live in the main process).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dotaCapture', {
  sources: async () => {
    try {
      const r = await ipcRenderer.invoke('dota:sources');
      return Array.isArray(r) ? r : { error: 'nessuna sorgente' };
    } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
  },
  shot: async (sourceId, width) => {
    try {
      const r = await ipcRenderer.invoke('dota:shot', sourceId, width);
      return r ? { dataUrl: r } : { error: 'sorgente sparita' };
    } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
  },
});

contextBridge.exposeInMainWorld('dotaOverlay', {
  get: () => ipcRenderer.invoke('overlay:get'),
  hide: () => ipcRenderer.send('overlay:hide'),
  setClickThrough: (on) => ipcRenderer.send('overlay:click-through', !!on),
  setBackgroundAlpha: (a) => ipcRenderer.send('overlay:alpha', Number(a)),
  setAutoClickThrough: (on) => ipcRenderer.send('overlay:auto', !!on),
  setCompact: (on) => ipcRenderer.send('overlay:compact', !!on),
  fitHeight: (h) => ipcRenderer.send('overlay:fit', Number(h)),
  reportPhase: (inGame) => ipcRenderer.send('overlay:phase', !!inGame),
  onState: (cb) => ipcRenderer.on('overlay:state', (_e, s) => cb(s)),
  onTab: (cb) => ipcRenderer.on('overlay:tab', (_e, t) => cb(t)),
  onRoshan: (cb) => ipcRenderer.on('overlay:roshan', () => cb()),
});

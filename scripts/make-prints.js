// Genera renderer/data/prints.json dai RITRATTI verificati (dataset giusto).
// Per ogni eroe salva 7 finestre (intero + centri/volti): il match prende il max.
// Uso: node scripts/make-prints.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'renderer', 'data', 'portraits');
const OUT = path.join(ROOT, 'renderer', 'data', 'prints.json');
const N = 12; // deve combaciare con detect.js
// Finestre canoniche sul ritratto 16:9 (l'HUD inquadra il volto in modo diverso per eroe)
const WINS = [
  { x: 0, y: 0, w: 1, h: 1 },          // intero
  { x: 0.13, y: 0.08, w: 0.74, h: 0.92 }, // centro
  { x: 0.2, y: 0.15, w: 0.6, h: 0.75 },   // volto stretto
  { x: 0.0, y: 0.08, w: 0.74, h: 0.92 },  // volto a sinistra
  { x: 0.26, y: 0.08, w: 0.74, h: 0.92 }, // volto a destra
  { x: 0.15, y: 0.0, w: 0.7, h: 0.7 },    // testa in alto
  { x: 0.075, y: 0.2, w: 0.7, h: 0.7 },   // volto basso
];

function grid(png, c) {
  const x0 = png.width * c.x, y0 = png.height * c.y;
  const w = png.width * c.w, h = png.height * c.h;
  const vals = [];
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    const ax = x0 + (w * gx) / N, bx = x0 + (w * (gx + 1)) / N;
    const ay = y0 + (h * gy) / N, by = y0 + (h * (gy + 1)) / N;
    let s = 0, n = 0;
    for (let y = Math.floor(ay); y < Math.max(Math.floor(ay) + 1, Math.floor(by)); y++) {
      for (let x = Math.floor(ax); x < Math.max(Math.floor(ax) + 1, Math.floor(bx)); x++) {
        const xx = Math.min(x, png.width - 1), yy = Math.min(y, png.height - 1);
        const i = (yy * png.width + xx) * 4;
        const a = png.data[i + 3] / 255; // angoli trasparenti composti su nero
        s += a * (0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
        n++;
      }
    }
    vals.push(n ? s / n : 0);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const dev = vals.map((v) => v - mean);
  const maxAbs = Math.max(1, ...dev.map(Math.abs));
  return dev.map((d) => Math.round((d / maxAbs) * 100));
}

const prints = {};
let ok = 0; const ko = [];
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.png'))) {
  const short = f.replace('.png', '');
  try {
    const png = PNG.sync.read(fs.readFileSync(path.join(DIR, f)));
    prints['npc_dota_hero_' + short] = WINS.map((c) => grid(png, c));
    ok++;
  } catch (e) { ko.push(short); }
}

fs.writeFileSync(OUT, JSON.stringify({ v: 3, n: N, wins: WINS, d: prints }));
console.log(`impronte ritratti: ${ok} ok, ${ko.length} ko ${ko.slice(0, 5).join(',')} | N=${N} finestre=${WINS.length} ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);

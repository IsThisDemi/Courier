// Riconoscimento eroi dalla barra in alto di Dota.
// Le icone della barra sono le ICONE eroe (arte pixel): si confrontano con NCC
// (correlazione normalizzata) su una griglia NxN di luminanza, che tollera
// luminosita', compressione JPEG e scala. Nessuna chiamata di rete: tutto locale.
window.Detect = (() => {
  const N = 12;        // deve combaciare con scripts/make-prints.js
  const INSET = 0.04;  // bordo icona ignorato (angoli arrotondati / alone)

  // Griglia NxN di luminanza su un rettangolo di un ImageData (media zero).
  function gridOf(buf, bufW, bufH, rect, inset, n) {
    const g = n || N;
    const i0 = inset == null ? INSET : inset;
    const cx = rect.x + rect.w * i0, cy = rect.y + rect.h * i0;
    const cw = rect.w * (1 - 2 * i0), ch = rect.h * (1 - 2 * i0);
    const out = new Float32Array(g * g);
    let k = 0;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++) {
        const ax = Math.round(cx + (cw * gx) / g), bx = Math.max(ax + 1, Math.round(cx + (cw * (gx + 1)) / g));
        const ay = Math.round(cy + (ch * gy) / g), by = Math.max(ay + 1, Math.round(cy + (ch * (gy + 1)) / g));
        let s = 0, cnt = 0;
        for (let y = ay; y < by; y++) {
          if (y < 0 || y >= bufH) continue;
          for (let x = ax; x < bx; x++) {
            if (x < 0 || x >= bufW) continue;
            const i = (y * bufW + x) * 4;
            s += 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
            cnt++;
          }
        }
        out[k++] = cnt ? s / cnt : 0;
      }
    }
    let m = 0;
    for (let i = 0; i < out.length; i++) m += out[i];
    m /= out.length;
    for (let i = 0; i < out.length; i++) out[i] -= m;
    return out;
  }

  // NCC: 1 = identiche (a meno di luminosita'), 0 = nessuna relazione.
  function ncc(a, b) {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; d += x * y; na += x * x; nb += y * y; }
    return d / (Math.sqrt(na * nb) || 1);
  }

  // prints.json -> { npc: Float32Array } oppure { npc: [Float32Array x finestre] }.
  function loadRefs(json) {
    const d = json && json.d ? json.d : json;
    const refs = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      refs[k] = (v && typeof v[0] === 'object') ? v.map((g) => Float32Array.from(g)) : Float32Array.from(v);
    }
    return refs;
  }

  function imageDataOf(frame, W, H) {
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    return { ctx, buf: ctx.getImageData(0, 0, W, H).data };
  }

  // Slot dei 10 ritratti in alto, frazioni (fallback quando non c'e' calibrazione).
  function defaultSlots(W, H) {
    const iw = W * 0.0275, ih = iw * 0.5625, gap = W * 0.003, mid = W * 0.032;
    const y = H * 0.008, slots = [];
    for (let i = 0; i < 5; i++) slots.push({ x: W / 2 - mid - (5 - i) * (iw + gap) + iw * 1.0, y, w: iw, h: ih, group: 'left' });
    for (let i = 0; i < 5; i++) slots.push({ x: W / 2 + mid + i * iw + i * gap, y, w: iw, h: ih, group: 'right' });
    return slots;
  }

  // Geometria da 3 click (frazioni 0..1): centro 1a icona, 5a, 10a.
  // Cosi' il buco centrale (orologio + punteggi) non viene spalmato sulle icone.
  // opts.fill: icon width / pitch; opts.aspect: height / width (the pick screen has wider gaps).
  function slotsFromPoints(W, H, p0, p1, p2, opts) {
    const x0 = p0.x * W, x4 = p1.x * W, x9 = p2.x * W;
    const pitch = (x4 - x0) / 4;
    if (!(pitch > 4)) return null;
    const w = pitch * ((opts && opts.fill) || 0.97), h = w * ((opts && opts.aspect) || 0.5625);
    const y = p0.y * H - h / 2;
    const slots = [];
    for (let i = 0; i < 5; i++) slots.push({ x: x0 - w / 2 + i * pitch, y, w, h, group: 'left' });
    for (let i = 0; i < 5; i++) slots.push({ x: x9 - w / 2 - (4 - i) * pitch, y, w, h, group: 'right' });
    return slots;
  }

  // Converte uno slot generico in rect assoluto con arrotondamenti sicuri.
  const rectOf = (s) => ({ x: Math.round(s.x), y: Math.round(s.y), w: Math.max(4, Math.round(s.w)), h: Math.max(4, Math.round(s.h)) });

  // Punteggi per uno slot: migliore, secondo, e i 3 candidati.
  // Punteggi per uno slot: cerca anche micro-spostamenti (±2px) e ritagli diversi,
  // cosi' un click imperfetto o 1-2px di disallineamento non azzerano il match.
  function scoreSlot(buf, W, H, rect, refs) {
    const grids = [];
    for (const d of [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2]]) {
      for (const inset of [0.04, 0.12]) {
        grids.push(gridOf(buf, W, H, { x: rect.x + d[0], y: rect.y + d[1], w: rect.w, h: rect.h }, inset, N));
      }
    }
    let best = '', bestS = -2, secondS = -2;
    const all = [];
    for (const npc of Object.keys(refs)) {
      const ref = refs[npc];
      const rgs = (ref && typeof ref[0] === 'object') ? ref : [ref]; // multi-finestra (v3) o singola
      let s = -2;
      for (const g of grids) for (const rg of rgs) { const v = ncc(g, rg); if (v > s) s = v; }
      all.push([npc, s]);
      if (s > bestS) { secondS = bestS; bestS = s; best = npc; } else if (s > secondS) secondS = s;
    }
    all.sort((a, b) => b[1] - a[1]);
    return { npc: best, score: bestS, margin: bestS - secondS, cands: all.slice(0, 3) };
  }

  // Match completo: gate severo per l'auto-applicazione, candidati sempre disponibili.
  function matchSlots(frame, W, H, prints, slots, opts) {
    const o = opts || {};
    const minScore = o.minScore == null ? 0.70 : o.minScore;
    const minMargin = o.minMargin == null ? 0.03 : o.minMargin;
    const refs = prints && prints.d ? loadRefs(prints) : prints;
    const { buf } = imageDataOf(frame, W, H);
    const list = slots || defaultSlots(W, H);
    return list.map((s) => {
      const r = rectOf(s);
      if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) return { ...s, npc: null, score: 0, margin: 0, cands: [] };
      const res = scoreSlot(buf, W, H, r, refs);
      const ok = res.score >= minScore && res.margin >= minMargin
        && (!o.minChroma || chromaOf(buf, W, H, r) >= o.minChroma)
        && (!o.minDetail || detailOf(gridOf(buf, W, H, r, 0.12, N)) >= o.minDetail);
      return {
        ...s,
        npc: ok ? res.npc : null,
        best: res.npc,
        conf: ok ? Math.max(0, Math.round(res.score * 100)) : 0,
        score: Math.round(res.score * 1000) / 1000,
        margin: Math.round(res.margin * 1000) / 1000,
        cands: res.cands.map(([npc, sc]) => ({ npc, score: Math.round(sc * 1000) / 1000 })),
      };
    });
  }

  // Banda verticale delle icone: nella fascia in alto sono l'unica cosa colorata,
  // quindi si misura dove comincia e finisce il colore (altezza vera delle icone).
  function findIconBand(buf, W, H, slots) {
    const base = slots || defaultSlots(W, H);
    const x0 = Math.max(0, Math.round(base[0].x)), x1 = Math.min(W, Math.round(base[9].x + base[9].w));
    const yMax = Math.min(H, Math.max(24, Math.round(H * 0.08)));
    if (x1 - x0 < 20) return null;
    const rows = [];
    for (let y = 0; y < yMax; y++) {
      let vivid = 0, n = 0;
      for (let x = x0; x < x1; x += 2) {
        const i = (y * W + x) * 4;
        const R = buf[i], G = buf[i + 1], B = buf[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        if (mx > 55 && mx - mn > 40) vivid++;
        n++;
      }
      rows.push(n ? vivid / n : 0);
    }
    const peak = Math.max(...rows);
    if (peak < 0.15) return null; // nessuna fila di icone: Dota non visibile
    const thr = Math.max(0.08, peak * 0.45);
    // trova il blocco piu' alto di righe sopra soglia (la banda delle icone)
    let bs = -1, be = -1, cs = -1;
    for (let y = 0; y <= rows.length; y++) {
      const on = y < rows.length && rows[y] >= thr;
      if (on && cs < 0) cs = y;
      if (!on && cs >= 0) { if (y - cs > be - bs) { bs = cs; be = y; } cs = -1; }
    }
    if (bs < 0 || be - bs < 6) return null;
    return { y0: bs, y1: be, h: be - bs, peak };
  }

  // Auto-allineamento: usa la banda colorata per altezza e posizione verticale delle icone
  // (i click danno gia' passo e centro orizzontale). Ritorna gli slot corretti.
  function autoAlign(frame, W, H, prints, slots) {
    const { buf } = imageDataOf(frame, W, H);
    const base = slots || defaultSlots(W, H);
    const band = findIconBand(buf, W, H, base);
    if (!band) return { slots: base, band: null, ok: false };
    const pitch = base[1].x - base[0].x;
    // le righe estreme delle icone (sfondo scuro in alto/basso) restano sotto soglia:
    // si allarga la banda di un margine per recuperare l'altezza vera dell'icona.
    const pad = Math.max(2, Math.round(band.h * 0.12));
    const h = band.h + pad;
    const dy = band.y0 - Math.round(pad / 2) - base[0].y;
    const out = base.map((s) => ({ ...s, y: s.y + dy, h }));
    // verifica: la confidenza media deve migliorare, altrimenti lascio stare
    const refs = prints && prints.d ? loadRefs(prints) : prints;
    const avg = (sl) => {
      let sum = 0;
      for (const s of sl) {
        const r = rectOf(s);
        if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) continue;
        sum += scoreSlot(buf, W, H, r, refs).score;
      }
      return sum / sl.length;
    };
    const a0 = avg(base), a1 = avg(out);
    const ok = a1 >= a0 - 0.005;
    return { slots: ok ? out : base, band, dy, h, pitch, before: a0, after: a1, ok };
  }

  // Pick screen (hero selection and strategy time): bigger portraits than in game, near the top edge.
  // Measured in screen heights on 2025-26 client screenshots. The gap around the clock comes in two widths.
  const DRAFT_FIT = { fill: 0.87, aspect: 0.62 };
  const DRAFT = { w: 0.1, h: 0.062, pitch: 0.1153, y: 0.004, gaps: [0.1315, 0.171] };

  // v: { gap, scale }. Slots are the portraits' box at mid height (they are slightly slanted).
  function draftSlots(W, H, v) {
    const k = (v && v.scale) || 1;
    const gap = ((v && v.gap) || DRAFT.gaps[0]) * H * k;
    const w = DRAFT.w * H * k, h = DRAFT.h * H * k, pitch = DRAFT.pitch * H * k;
    const y = DRAFT.y * H * k;
    const span = 4 * pitch + w;
    const left = W / 2 - gap - span, right = W / 2 + gap;
    const slots = [];
    for (let i = 0; i < 5; i++) slots.push({ x: left + i * pitch, y, w, h, group: 'left' });
    for (let i = 0; i < 5; i++) slots.push({ x: right + i * pitch, y, w, h, group: 'right' });
    return slots;
  }

  const DRAFT_VARIANTS = [];
  for (const scale of [1, 0.94, 1.06]) for (const gap of DRAFT.gaps) DRAFT_VARIANTS.push({ gap, scale });

  // Tries the pick-screen layouts and keeps the one that recognises most heroes.
  // Grey portraits are heroes only hovered, not picked yet: they need some colour to count.
  // opts.slots: geometry from the 3-click alignment; opts.variant: layout that worked last time.
  function matchDraft(frame, W, H, prints, opts) {
    const o = opts || {};
    const cands = [];
    if (o.slots) cands.push({ v: null, slots: o.slots });
    if (o.variant) cands.push({ v: o.variant, slots: draftSlots(W, H, o.variant) });
    for (const v of DRAFT_VARIANTS) cands.push({ v, slots: draftSlots(W, H, v) });
    let best = null;
    for (const [i, c] of cands.entries()) {
      const got = matchSlots(frame, W, H, prints, c.slots, { minScore: 0.78, minMargin: 0.06, minChroma: 0.12, minDetail: 0.3 });
      const n = got.filter((g) => g.npc).length;
      if (!best || n > best.n) best = { v: c.v, got, n }; // on a tie the expected layout wins
      if (i === 0 && (o.slots || o.variant) && n >= 2) break;
    }
    return best;
  }

  // Share of neighbouring grid cells that differ: a portrait is detailed everywhere,
  // a patch of flat background with one edge in it is not.
  function detailOf(g) {
    let d = 0, n = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = g[y * N + x];
      if (x + 1 < N) { if (Math.abs(v - g[y * N + x + 1]) > 6) d++; n++; }
      if (y + 1 < N) { if (Math.abs(v - g[(y + 1) * N + x]) > 6) d++; n++; }
    }
    return n ? d / n : 0;
  }

  // Share of clearly coloured pixels in a rectangle.
  function chromaOf(buf, W, H, r) {
    let c = 0, n = 0;
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y += 2) {
      for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x += 2) {
        const i = (y * W + x) * 4;
        if (Math.max(buf[i], buf[i + 1], buf[i + 2]) - Math.min(buf[i], buf[i + 1], buf[i + 2]) > 30) c++;
        n++;
      }
    }
    return n ? c / n : 0;
  }

  // True se nella fascia in alto c'e' roba colorata (barra HUD di Dota visibile).
  function hudPresent(frame, W, H) {
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    const y0 = Math.max(0, Math.round(H * 0.002)), hh = Math.max(8, Math.round(H * 0.04));
    const d = ctx.getImageData(0, y0, W, hh).data;
    let vivid = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx > 45 && mx - mn > 22) vivid++;
      n++;
    }
    return { ok: n > 0 && vivid / n > 0.02, ratio: n ? vivid / n : 0 };
  }

  function isBlack(frame, W, H) {
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(Math.round(W * 0.4), Math.round(H * 0.4), 20, 20).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return (s / (d.length / 4)) < 12;
  }

  return { N, INSET, detailOf, defaultSlots, slotsFromPoints, draftSlots, matchDraft, DRAFT_FIT, matchSlots, scoreSlot, rectOf, autoAlign, findIconBand, hudPresent, isBlack, gridOf, ncc, loadRefs };
})();

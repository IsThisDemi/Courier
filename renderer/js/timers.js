// Map objectives by game clock, patch 7.42 (official notes of 18 Nov 2026 plus the 7.41f values they leave unchanged).
const RECURRING = [
  { id: 'bounty', label: 'Runa della ricchezza', icon: '◆', first: 0, every: 240 },
  { id: 'power', label: 'Runa del potere', icon: '✦', first: 360, every: 120 },
  { id: 'wisdom', label: 'Santuario della saggezza', icon: '✧', first: 420, every: 420 },
  { id: 'lotus', label: 'Loto', icon: '❀', first: 180, every: 180 },
  { id: 'daynight', label: 'Cambio giorno/notte', icon: '◐', first: 300, every: 300 },
  { id: 'stack', label: 'Stack dei campi', icon: '▲', first: 53, every: 60, short: 'Stack' },
];
const ONCE = [
  { id: 'water1', label: 'Runa d\'acqua', icon: '●', at: 120 },
  { id: 'water2', label: 'Runa d\'acqua', icon: '●', at: 240 },
  { id: 'tormentor', label: 'Tormentor', icon: '✚', at: 900 },
  { id: 'neutral2', label: 'Oggetti neutrali, livello 2', icon: '◇', at: 900, short: 'Neutrali 2' },
  { id: 'neutral3', label: 'Oggetti neutrali, livello 3', icon: '◇', at: 1800, short: 'Neutrali 3' },
  { id: 'neutral4', label: 'Oggetti neutrali, livello 4', icon: '◇', at: 3000, short: 'Neutrali 4' },
  { id: 'madstone', label: 'Madstone senza limite', icon: '◇', at: 3900, short: 'Madstone' },
];
const SHORT = { bounty: 'Ricchezza', power: 'Potere', wisdom: 'Santuario', lotus: 'Loto', daynight: 'Giorno/notte', water1: 'Acqua', water2: 'Acqua', tormentor: 'Tormentor' };

const nextOf = (clock, first, every) => {
  if (clock <= first) return first;
  return first + Math.ceil((clock - first) / every) * every;
};

// 7.42: the 8-11 minute respawn window starts one minute earlier after each kill, never below 5 minutes.
const AEGIS = 300;
export function roshanWindow(killedAt, kills = 1) {
  const minMinutes = Math.max(5, 8 - Math.max(0, kills - 1));
  return { min: killedAt + minMinutes * 60, max: killedAt + (minMinutes + 3) * 60 };
}

export function upcoming(clock, roshanKilledAt, roshanKills = 1) {
  const out = [];
  for (const t of RECURRING) {
    const at = nextOf(clock - 5, t.first, t.every); // keep an event on screen for 5s after it happens
    out.push({ ...t, short: t.short || SHORT[t.id], at, left: at - clock });
  }
  for (const t of ONCE) if (t.at >= clock - 5) out.push({ ...t, short: t.short || SHORT[t.id], left: t.at - clock });
  if (roshanKilledAt != null) {
    const aegis = roshanKilledAt + AEGIS;
    if (clock < aegis) out.push({ id: 'aegis', label: 'Scade l\'Aegis', icon: '⬣', short: 'Aegis', at: aegis, left: aegis - clock });
    const { min, max } = roshanWindow(roshanKilledAt, roshanKills);
    const nth = roshanKills > 1 ? ` (${roshanKills}ª uccisione)` : '';
    if (clock < min) out.push({ id: 'roshan', label: 'Roshan può tornare' + nth, note: `al più tardi tra ${fmt(max - clock)}`, icon: '☗', short: 'Roshan', at: min, left: min - clock });
    else if (clock <= max) out.push({ id: 'roshan', label: 'Roshan può essere già vivo' + nth, note: `al più tardi tra ${fmt(max - clock)}`, icon: '☗', short: 'Roshan', at: clock, left: 0, window: true });
  }
  return out.sort((a, b) => a.left - b.left);
}

export function urgency(t) {
  if (t.left <= 0 && t.left > -5) return 'now';
  if (t.window) return 'now';
  if (t.left <= (t.id === 'stack' ? 8 : 20)) return 'soon';
  return '';
}

function fmt(s) {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

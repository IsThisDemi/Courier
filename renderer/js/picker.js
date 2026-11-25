// Hero picker sheet: search, attribute filter, keyboard friendly.
import { allHeroes, portrait, esc } from './data.js';

const ATTRS = [['', 'Tutti'], ['str', 'Forza'], ['agi', 'Agilità'], ['int', 'Intelligenza'], ['all', 'Universali']];
const $ = (id) => document.getElementById(id);

let current = null;
let attr = '';

function renderGrid() {
  const q = $('picker-search').value.trim().toLowerCase();
  const list = allHeroes().filter((h) => (!attr || h.attr === attr) && (!q || h.name.toLowerCase().includes(q) || h.short.includes(q)));
  $('picker-grid').innerHTML = list.length
    ? list.map((h) => `<button class="pick-cell" data-id="${h.id}"${current.taken.has(h.id) ? ' disabled' : ''}>
        <img class="portrait" src="${portrait(h.id)}" alt="" loading="lazy" /><span>${esc(h.name)}</span></button>`).join('')
    : '<p class="empty">Nessun eroe con questo nome.</p>';
}

function renderAttrs() {
  $('picker-attr').innerHTML = ATTRS.map(([k, label]) =>
    `<button class="chip" role="radio" aria-checked="${k === attr}" data-attr="${k}">${label}</button>`).join('');
}

export function closePicker() {
  $('picker').hidden = true;
  current = null;
}

export function openPicker(opts) {
  current = { taken: new Set(), ...opts };
  $('picker-title').textContent = opts.title;
  $('picker-remove').hidden = !opts.onRemove;
  $('picker-search').value = '';
  attr = '';
  renderAttrs();
  renderGrid();
  $('picker').hidden = false;
  $('picker-search').focus();
}

export function initPicker() {
  $('picker-search').addEventListener('input', renderGrid);
  $('picker-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('picker-grid').querySelector('.pick-cell:not([disabled])');
      if (first) first.click();
    }
  });
  $('picker-attr').addEventListener('click', (e) => {
    const b = e.target.closest('[data-attr]');
    if (!b) return;
    attr = b.dataset.attr;
    renderAttrs();
    renderGrid();
  });
  $('picker-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.pick-cell');
    if (!b || b.disabled || !current) return;
    const cb = current.onPick;
    closePicker();
    cb(Number(b.dataset.id));
  });
  $('picker-remove').addEventListener('click', () => {
    const cb = current && current.onRemove;
    closePicker();
    if (cb) cb();
  });
  $('picker-close').addEventListener('click', closePicker);
  $('picker').addEventListener('click', (e) => { if (e.target.id === 'picker') closePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closePicker(); });
}

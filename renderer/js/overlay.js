// Overlay controls, only inside the desktop app: background transparency, click-through, hotkeys.
const $ = (id) => document.getElementById(id);

export function initOverlay({ setTab, roshanKilled }) {
  const api = window.dotaOverlay;
  if (!api) return null;
  document.documentElement.classList.add('overlay');
  const note = $('help-desktop-note');
  if (note) note.textContent = 'Dota deve essere in modalità finestra senza bordi: con lo schermo intero esclusivo la finestra non può stare sopra il gioco.';
  const settingsBtn = $('open-settings');
  settingsBtn.insertAdjacentHTML('beforebegin', `
    <button class="icon-btn" id="ov-pass" aria-pressed="false" title="Clic passanti al gioco (Alt+T)" aria-label="Clic passanti al gioco">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M7 2l11 11h-6.2l3.6 7.4-2.7 1.3-3.6-7.5L7 17.8z"/></svg></button>
    <button class="icon-btn" id="ov-compact" aria-pressed="false" title="Compatta (Alt+C)" aria-label="Compatta">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M4 4h16v6H4zm0 8h7v8H4z"/></svg></button>
    <button class="icon-btn" id="ov-hide" title="Nascondi (Alt+D)" aria-label="Nascondi">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M5 11h14v2H5z"/></svg></button>`);
  document.querySelector('#settings .form-actions').insertAdjacentHTML('beforebegin', `
    <label>Trasparenza dello sfondo
      <input id="ov-alpha" type="range" min="0.2" max="1" step="0.02" />
      <small>Il testo resta pieno: diventa trasparente solo lo sfondo.</small>
    </label>
    <label class="check-row"><input id="ov-auto" type="checkbox" /> Lascia passare i clic al gioco durante la partita</label>
    <p class="fine">Le scorciatoie sono nel pulsante ? in alto. Dota deve essere in modalità finestra senza bordi.</p>`);

  let state = { clickThrough: false, autoClickThrough: false, backgroundAlpha: 0.86, compact: false };
  const apply = (s) => {
    state = { ...state, ...s };
    document.documentElement.style.setProperty('--bg-alpha', String(state.backgroundAlpha));
    document.documentElement.classList.toggle('passing', !!state.clickThrough);
    const wasCompact = document.documentElement.classList.contains('compact');
    document.documentElement.classList.toggle('compact', !!state.compact);
    if (state.compact && !wasCompact) setTab('live');
    $('ov-compact').setAttribute('aria-pressed', String(!!state.compact));
    $('ov-pass').setAttribute('aria-pressed', String(!!state.clickThrough));
    $('ov-alpha').value = String(state.backgroundAlpha);
    $('ov-auto').checked = !!state.autoClickThrough;
  };
  // compact: the window follows the content, so nothing is cut at the bottom
  const fit = () => {
    if (!state.compact || !api.fitHeight) return;
    const main = document.querySelector('main');
    api.fitHeight(Math.ceil(document.querySelector('.bar').getBoundingClientRect().height + main.getBoundingClientRect().height) + 2);
  };
  new ResizeObserver(fit).observe(document.querySelector('main'));
  const applyAndFit = (s) => { apply(s); requestAnimationFrame(fit); };
  api.get().then(applyAndFit).catch(() => {});
  api.onState(applyAndFit);
  api.onTab((tab) => setTab(tab));
  api.onRoshan(() => roshanKilled());
  $('ov-pass').addEventListener('click', () => api.setClickThrough(!state.clickThrough));
  $('ov-hide').addEventListener('click', () => api.hide());
  $('ov-compact').addEventListener('click', () => api.setCompact(!state.compact));
  $('ov-alpha').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--bg-alpha', e.target.value);
    api.setBackgroundAlpha(e.target.value);
  });
  $('ov-auto').addEventListener('change', (e) => api.setAutoClickThrough(e.target.checked));
  return {
    isPassing: () => !!state.clickThrough,
    reportPhase: (inGame) => api.reportPhase(inGame),
  };
}

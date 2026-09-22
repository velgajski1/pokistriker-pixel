/**
 * uiManager.js - every DOM write in the game happens here.
 *
 * The arcade interface: the HUD (score, pixel hearts, level blocks, combo),
 * shot verdicts, the level-up banner, and the title and game-over panels.
 * This module owns no game state; app.js hands it plain values.
 */

const $ = (id) => document.getElementById(id);
const el = {};
let verdictTimer = 0, bannerTimer = 0;
const loadingStarted = performance.now();

// ---- Pixel art ------------------------------------------------------------
const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

/** A heart drawn from square pixels: red with a highlight, or a dark socket when empty. */
function heartSvg(full) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 7 6');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('heart', full ? 'full' : 'empty');
  HEART.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== 'X') return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', 1); rect.setAttribute('height', 1);
    const highlight = full && y === 1 && (x === 1 || x === 2);
    rect.setAttribute('fill', highlight ? '#ffb3a8' : full ? '#e8322b' : '#3b2c2c');
    svg.append(rect);
  }));
  return svg;
}

function button(label, onClick, kind = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `block-button ${kind}`.trim();
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function node(tag, className, text = '') {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

// ---- Boot -----------------------------------------------------------------
export function init() {
  el.dim = $('dim');
  el.hud = $('hud');
  el.score = $('hud-score');
  el.best = $('hud-best');
  el.combo = $('hud-combo');
  el.level = $('hud-level');
  el.levelBlocks = $('hud-level-blocks');
  el.hearts = $('hud-hearts');
  el.prompt = $('phase-prompt');
  el.verdict = $('verdict');
  el.banner = $('banner');
  el.overlay = $('overlay');
}

/** One button: SOUND ON / SOUND OFF. `onToggle(muted)` applies and saves it. */
export function initAudioControls(settings, onToggle, onSound) {
  const toggle = button('', () => {
    settings.muted = !settings.muted;
    label();
    onToggle(settings.muted);
    if (!settings.muted) onSound('click');
  }, 'audio-toggle');
  const label = () => {
    toggle.textContent = settings.muted ? 'SOUND OFF' : 'SOUND ON';
    toggle.setAttribute('aria-pressed', String(!settings.muted));
    toggle.classList.toggle('off', settings.muted);
  };
  label();
  for (const event of ['pointerdown', 'keydown']) toggle.addEventListener(event, e => e.stopPropagation());
  document.body.append(toggle);
  document.addEventListener('pointerover', e => {
    const b = e.target.closest('button');
    if (b && !b.contains(e.relatedTarget)) onSound('hover');
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b !== toggle) onSound(b.classList.contains('primary') ? 'confirm' : 'click');
  }, true);
}

export async function finishLoading() {
  const remaining = 450 - (performance.now() - loadingStarted);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  document.body.classList.remove('loading');
  el.overlay.inert = false;
  el.hud.inert = false;
  $('preloader').classList.add('hidden');
}

export function showLoadingError() {
  $('preloader').classList.add('failed');
  $('preloader-message').textContent = 'COULD NOT LOAD THE GAME. TRY AGAIN.';
  const retry = $('preloader-retry');
  retry.classList.remove('hidden');
  retry.onclick = () => location.reload();
}

// ---- HUD ------------------------------------------------------------------
/** Dims the arena behind the menus; play clears it. */
export function setDimmed(on) { el.dim.classList.toggle('clear', !on); }

export function showHud(on) { el.hud.classList.toggle('hidden', !on); }

let lastScore = -1;
export function setArcadeHud({ score, hearts, maxHearts, level, combo, levelProgress, best }) {
  if (score !== lastScore) {
    el.score.textContent = String(score).padStart(6, '0');
    if (lastScore >= 0 && score > lastScore) {
      el.score.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'steps(4)' });
    }
    lastScore = score;
  }
  el.best.textContent = `BEST ${String(Math.max(best, score)).padStart(6, '0')}`;
  el.combo.textContent = combo > 1 ? `x${combo}` : '';
  el.combo.classList.toggle('show', combo > 1);
  el.level.textContent = `LEVEL ${level}`;
  const blocks = [];
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    blocks.push(node('i', i < Math.round(levelProgress * steps) ? 'on' : ''));
  }
  el.levelBlocks.replaceChildren(...blocks);
  if (el.hearts.dataset.hearts !== `${hearts}/${maxHearts}`) {
    const lost = Number(el.hearts.dataset.hearts?.split('/')[0]) > hearts;
    el.hearts.dataset.hearts = `${hearts}/${maxHearts}`;
    el.hearts.replaceChildren(...Array.from({ length: maxHearts }, (_, i) => heartSvg(i < hearts)));
    if (lost) el.hearts.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' }], { duration: 240, easing: 'steps(3)' });
  }
}

export function setPrompt(text) {
  el.prompt.textContent = text || '';
  el.prompt.classList.toggle('show', !!text);
}

/** A shot's verdict: big label, points line, optional detail. */
export function flashVerdict(label, kind, points = '', detail = '') {
  el.verdict.replaceChildren(node('strong', '', label));
  if (points) el.verdict.append(node('b', '', points));
  if (detail) el.verdict.append(node('span', '', detail));
  el.verdict.className = `verdict show ${kind}`;
  clearTimeout(verdictTimer);
  verdictTimer = setTimeout(() => { el.verdict.className = 'verdict'; }, 1600);
}

export function showLevelUp(level) {
  el.banner.replaceChildren(node('strong', '', `LEVEL ${level}`),
    node('span', '', level === 2 ? 'THE KEEPER IS WAKING UP' : level === 3 ? 'DEFENDERS INCOMING'
      : level === 5 ? 'A DEFENDER EVERY TIME' : level === 6 ? 'DOUBLE DEFENCE'
        : level % 3 === 0 ? 'SMALLER TARGETS' : 'THEY ARE GETTING BETTER'));
  el.banner.className = 'banner show';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.banner.className = 'banner'; }, 1900);
}

// ---- Panels ---------------------------------------------------------------
export function hideOverlay() {
  el.overlay.classList.add('hidden');
  el.overlay.replaceChildren();
}

function mount(panel) {
  el.overlay.replaceChildren(panel);
  el.overlay.classList.remove('hidden');
  panel.querySelector('.primary')?.focus({ preventScroll: true });
}

function logo() {
  const title = node('h1', 'logo');
  title.append(node('span', 'logo-block', 'BLOCK'), node('span', 'logo-striker', 'STRIKER'));
  return title;
}

/** Pause: the game is frozen behind it; RESUME is the big button. */
export function showPause({ onResume, onRestart }) {
  const panel = node('div', 'panel pause-panel');
  panel.append(logo(), node('p', 'tagline', 'PAUSED'));
  const actions = node('div', 'actions stack');
  actions.append(button('RESUME', onResume, 'primary'), button('RESTART', onRestart));
  panel.append(actions);
  mount(panel);
}

/** Bottom edge of the score block, in CSS pixels (Poki's pill goes below it). */
export const scoreBottom = () => document.querySelector('.hud-score').getBoundingClientRect().bottom;

/** "TAP" on touch screens, "SPACE" with a keyboard. */
export const pressWord = () => matchMedia('(pointer: coarse)').matches ? 'TAP' : 'PRESS SPACE';

/** The pause button in the HUD (touch has no Esc key). */
export function initPauseButton(onPause) {
  const b = button('II', onPause, 'pause-button');
  b.setAttribute('aria-label', 'Pause');
  el.hud.append(b);
}

export function showGameOver({ score, best, isBest, level, goals, bullseyes, bestCombo, precision, onReplay, onContinue }) {
  const panel = node('div', 'panel over-panel');
  panel.append(node('h2', 'over-title', isBest && score > 0 ? 'NEW BEST!' : 'GAME OVER'));
  panel.append(node('p', 'over-score', String(score).padStart(6, '0')));
  const stats = node('dl', 'stats');
  for (const [label, value] of [['LEVEL', level], ['GOALS', goals], ['BULLSEYES', bullseyes],
    ['PRECISION', `${precision}%`], ['BEST COMBO', bestCombo > 1 ? `x${bestCombo}` : '-'],
    ['BEST', String(best).padStart(6, '0')]]) {
    const row = node('div');
    row.append(node('dt', '', label), node('dd', '', String(value)));
    stats.append(row);
  }
  // Poki: the standard button is at least as large as, and above, the rewarded
  // one; the rewarded one is never green and carries the video icon.
  const actions = node('div', 'actions stack');
  actions.append(button('PLAY AGAIN', onReplay, 'primary'));
  if (onContinue) {
    const reward = button('\u{1F3AC} CONTINUE  +1 HEART', onContinue, 'reward');
    reward.id = 'continue-button';
    actions.append(reward);
  }
  panel.append(stats, actions);
  mount(panel);
}

/** The rewarded ad did not complete: the continue offer goes away. */
export function dropContinue() { document.getElementById('continue-button')?.remove(); }

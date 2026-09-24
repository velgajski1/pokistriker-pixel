/**
 * uiManager.js - every DOM write in the game happens here.
 *
 * The arcade interface: the HUD (score, pixel hearts, level blocks, rank,
 * combo, special-chance tag), shot verdicts, the level-up banner, mission
 * toasts, and the pause, game-over and locker panels.
 * This module owns no game state; app.js hands it plain values.
 */

const $ = (id) => document.getElementById(id);
const el = {};
let noticeTimer = 0, activeNotice = null;
const noticeQueue = [];
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

/** A button; `icon` (an emoji or glyph) goes before the label, hidden from screen readers. */
function button(label, onClick, kind = '', icon = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `block-button ${kind}`.trim();
  if (icon) {
    const glyph = node('span', 'b-icon', icon);
    glyph.setAttribute('aria-hidden', 'true');
    b.append(glyph, node('span', 'b-label', label));
  } else b.textContent = label;
  b.onclick = onClick;
  return b;
}
const ICON = { play: '\u25B6', back: '\u21A9', restart: '\u21BB', locker: '\u{1F392}', daily: '\u{1F4C5}',
  striker: '\u{1F464}', missions: '\u{1F4CB}', flag: '\u{1F6A9}', video: '\u{1F3AC}' };

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
  el.rank = $('hud-rank');
  el.progress = $('hud-progress');
  // The rush clock, where the hearts are in the lives-based arcade.
  el.clock = node('div', 'hud-clock hidden');
  el.clockText = node('b', '', '45');
  el.clock.append(node('i', 'clock-icon', '\u23F1'), el.clockText);
  el.special = $('hud-special');
  el.toast = $('toast');
  el.swipe = $('swipe');
  el.swipeLine = el.swipe.querySelector('polyline');
  // The pull shot's band: from where the finger went down to where it is now.
  const svg = 'http://www.w3.org/2000/svg';
  el.pullBand = document.createElementNS(svg, 'line');
  el.pullAnchor = document.createElementNS(svg, 'circle');
  el.pullKnob = document.createElementNS(svg, 'circle');
  el.pullBand.setAttribute('class', 'pull-band');
  el.pullAnchor.setAttribute('class', 'pull-anchor');
  el.pullKnob.setAttribute('class', 'pull-knob');
  el.pullAnchor.setAttribute('r', 8);
  el.pullKnob.setAttribute('r', 18);
  el.swipe.append(el.pullBand, el.pullAnchor, el.pullKnob);
  el.charge = $('charge');
  el.hearts = $('hud-hearts');
  el.prompt = $('phase-prompt');
  el.verdict = $('verdict');
  el.banner = $('banner');
  el.overlay = $('overlay');
  // Flow layout keeps changing scores, specials and controls in separate regions.
  const top = node('div', 'hud-top');
  el.controls = node('div', 'hud-controls');
  el.controls.append(el.clock, el.hearts);
  top.append(el.score.parentElement, el.level.parentElement, el.controls, el.special);
  const notices = node('div', 'hud-notices');
  notices.append(el.verdict, el.banner, el.toast);
  const bottom = node('div', 'hud-bottom');
  bottom.append(el.charge, el.prompt);
  el.hud.prepend(top, notices, bottom);
  // The tutorial's gesture on the pitch: a finger presses, drags down, lets go.
  el.gesture = node('div', 'gesture hidden');
  el.gesture.setAttribute('aria-hidden', 'true');
  el.gesture.append(node('i', 'g-anchor'), node('i', 'g-band'), node('i', 'g-finger', '\u{1F446}'),
    node('i', 'g-shot', '\u26BD'), node('b', 'g-label', 'PULL DOWN'));
  document.body.append(el.gesture);
  // Menus scroll internally; gameplay still prevents page scrolling.
  el.overlay.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
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
  $('preloader').classList.add('hidden');
}

export function showLoadingError(message = 'COULD NOT LOAD THE GAME. TRY AGAIN.') {
  $('preloader').classList.remove('hidden');
  $('preloader').classList.add('failed');
  $('preloader-message').textContent = message;
  const retry = $('preloader-retry');
  retry.classList.remove('hidden');
  retry.onclick = () => location.reload();
}

// ---- HUD ------------------------------------------------------------------
/** Dims the arena behind the menus; play clears it. */
export function setDimmed(on) { el.dim.classList.toggle('clear', !on); }

export function showHud(on) {
  el.hud.classList.toggle('hidden', !on);
  if (!on) {
    el.hud.inert = true;
    clearTimeout(noticeTimer);
    if (activeNotice) activeNotice.element.classList.remove('show');
    activeNotice = null;
    noticeQueue.length = 0;
  }
}

/** Only one UI layer participates in focus, clicks and accessibility at once. */
export function setGameplayActive(on) {
  el.hud.inert = !on;
  el.overlay.inert = on;
}

let lastScore = -1, lastSpecial = '';
const hex = value => '#' + value.toString(16).padStart(6, '0');
const thousands = value => value.toLocaleString('en-US');

export function setArcadeHud({ score, hearts, maxHearts, level, combo, levelProgress, levelSteps = 3, best,
  rank = '', daily = null, special = null, progress = null, tutorial = null, rush = null, bonus = null }) {
  if (score !== lastScore) {
    el.score.textContent = String(score).padStart(6, '0');
    lastScore = score;
  }
  el.best.textContent = `BEST ${String(Math.max(best, score)).padStart(6, '0')}`;
  el.combo.textContent = combo > 1 ? `x${combo}` : '';
  el.combo.classList.toggle('show', combo > 1);
  el.level.textContent = tutorial ? 'TUTORIAL' : bonus ? 'BONUS LEVEL' : daily ? `DAILY ${daily.shot}/${daily.of}` : `LEVEL ${level}`;
  el.rank.textContent = tutorial ? `SHOT ${tutorial.shot}/${tutorial.of}` : bonus ? `\u{1F525} SHOT ${bonus.shot}/${bonus.of}`
    : daily ? `LEVEL ${level}` : rank;
  el.level.parentElement.classList.toggle('bonus', !!bonus);
  if (progress !== null && el.progress.dataset.percent !== String(progress)) {
    el.progress.dataset.percent = progress;
    el.progress.firstChild.textContent = `PROGRESS ${progress}%`;
    el.progress.style.setProperty('--fill', `${progress}%`);
  }
  const blocks = [];
  if (!daily && !tutorial) for (let i = 0; i < levelSteps; i++) {
    blocks.push(node('i', i < Math.round(levelProgress * levelSteps) ? 'on' : ''));
  }
  el.levelBlocks.replaceChildren(...blocks);
  el.hearts.classList.toggle('hidden', !!daily || !!rush);
  el.clock.classList.toggle('hidden', !rush);
  if (rush) setClock(rush.time, rush.hurry);
  const specialKey = special ? `${special.kind}:${special.label}` : '';
  if (specialKey !== lastSpecial) {
    lastSpecial = specialKey;
    el.special.replaceChildren();
    el.special.className = 'special-tag';
    if (special) {
      el.special.append(node('strong', '', special.label), node('span', '', special.note));
      el.special.className = `special-tag show ${special.kind}`;
    }
  }
  if (el.hearts.dataset.hearts !== `${hearts}/${maxHearts}`) {
    const lost = Number(el.hearts.dataset.hearts?.split('/')[0]) > hearts;
    el.hearts.dataset.hearts = `${hearts}/${maxHearts}`;
    el.hearts.replaceChildren(...Array.from({ length: maxHearts }, (_, i) => heartSvg(i < hearts)));
    if (lost) el.hearts.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' },
      { transform: 'translateX(0)' }], { duration: 240, easing: 'steps(3)' });
  }
}

export function setPrompt(text) {
  el.prompt.classList.remove('tutorial');
  el.prompt.textContent = text || '';
  el.prompt.classList.toggle('show', !!text);
}

export function showTutorialStep(step) {
  const tap = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';
  el.prompt.replaceChildren(
    node('span', 'tutorial-step', `YOUR FIRST SHOT · STEP ${step} OF 2`),
    node('strong', 'tutorial-title', step === 1 ? 'Aim at the target' : 'Set the shot height'),
    node('span', 'tutorial-instruction', step === 1
      ? `${tap} to stop the moving arrow.` : `${tap} again to stop the height marker and shoot.`));
  el.prompt.classList.add('show', 'tutorial');
}

/**
 * A coaching card in the tutorial style: a step label, a big title, one line
 * of instruction, and optionally an animated hand showing the pull-back.
 */
export function coach(step, title, instruction, hand = false) {
  const parts = [node('span', 'tutorial-step', step), node('strong', 'tutorial-title', title),
    node('span', 'tutorial-instruction', instruction)];
  if (hand) {
    const demo = node('span', 'coach-demo');
    demo.append(node('i', 'coach-anchor'), node('i', 'coach-band'), node('i', 'coach-hand', '\u{1F446}'));
    parts.unshift(demo);
  }
  el.prompt.replaceChildren(...parts);
  el.prompt.classList.add('show', 'tutorial');
}

// Show notices sequentially so simultaneous rewards never overlap or get clipped.
function nextNotice() {
  clearTimeout(noticeTimer);
  if (activeNotice) activeNotice.element.classList.remove('show');
  activeNotice = noticeQueue.shift() || null;
  if (!activeNotice) return;
  activeNotice.element.classList.add('show');
  noticeTimer = setTimeout(nextNotice, activeNotice.duration);
}

function showNotice(element, duration, priority = false) {
  const queued = noticeQueue.findIndex(notice => notice.element === element);
  if (queued >= 0) noticeQueue.splice(queued, 1);
  if (activeNotice?.element === element) {
    element.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(nextNotice, duration);
    return;
  }
  if (priority && activeNotice) {
    activeNotice.element.classList.remove('show');
    noticeQueue.unshift(activeNotice);
    activeNotice = null;
  }
  if (priority) noticeQueue.unshift({ element, duration });
  else noticeQueue.push({ element, duration });
  if (!activeNotice) nextNotice();
}

/** A shot's verdict: big label, points line, optional detail. */
export function flashVerdict(label, kind, points = '', detail = '') {
  el.verdict.replaceChildren(node('strong', '', label));
  if (points) el.verdict.append(node('b', '', points));
  if (detail) el.verdict.append(node('span', '', detail));
  el.verdict.className = `verdict ${kind}`;
  showNotice(el.verdict, 1600, true);
}

/** A new chance: the last shot's verdict goes, so it never covers the special tag. */
export function clearVerdict() {
  if (activeNotice?.element === el.verdict) nextNotice();
  el.verdict.className = 'verdict';
}

/** The green banner: a level-up, a new rank, the daily challenge starting. */
export function showLevelUp(title, note = '', kind = '') {
  el.banner.replaceChildren(node('strong', '', title));
  if (note) el.banner.append(node('span', '', note));
  el.banner.className = `banner ${kind}`.trim();
  showNotice(el.banner, 2200);
}

/** The flick shot's trail: the finger's path so far (client pixels), then a fade on release. */
export function drawSwipe(xs, ys, count) {
  let points = '';
  for (let i = 0; i < count; i++) points += `${Math.round(xs[i])},${Math.round(ys[i])} `;
  el.swipeLine.setAttribute('points', points);
  el.swipe.classList.remove('fade');
}
export function fadeSwipe() { el.swipe.classList.add('fade'); }

/** The pull shot's band from (ax, ay) to the finger at (x, y), in `colour` (a CSS colour). */
export function drawPull(ax, ay, x, y, colour) {
  for (const [node, attrs] of [[el.pullBand, { x1: ax, y1: ay, x2: x, y2: y }], [el.pullAnchor, { cx: ax, cy: ay }],
    [el.pullKnob, { cx: x, cy: y }]]) for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, Math.round(value));
  el.swipe.style.setProperty('--pull', colour);
  el.swipe.classList.add('pulling');
  el.swipe.classList.remove('fade');
}
export function hidePull() { el.swipe.classList.remove('pulling'); }

/** Free aim's charge meter, 0..1; null hides it. */
export function setCharge(value) {
  el.charge.classList.toggle('hidden', value === null);
  if (value !== null) el.charge.style.setProperty('--fill', `${Math.round(value * 100)}%`);
}

/** On fire: flames licking up the screen edges and a burning HUD (a fire round). */
export function setOnFire(on) {
  document.body.classList.toggle('on-fire', on);
}

/** The tutorial's big finger showing the pull: press, drag down, let go (the ball flies). */
let gestureTimer = 0;
export function showGesture(on) {
  clearTimeout(gestureTimer);
  el.gesture.classList.remove('subtle');
  el.gesture.classList.toggle('hidden', !on);
}
/** A pull that went nowhere (a tap, a flick up): the same finger, smaller and fainter, for a moment. */
export function hintGesture() {
  showGesture(true);
  el.gesture.classList.add('subtle');
  gestureTimer = setTimeout(() => showGesture(false), 2800);
}

/** The rush clock: whole seconds, tenths in the last ten; red and pulsing in a hurry. */
let clockShown = '';
export function setClock(seconds, hurry) {
  const text = hurry ? Math.max(0, seconds).toFixed(1) : String(Math.ceil(seconds));
  if (text === clockShown) return;
  clockShown = text;
  el.clockText.textContent = text;
  el.clock.classList.toggle('hurry', hurry);
}

/** "+2s" floats up from the clock. */
export function clockBonus(seconds) {
  const pop = node('span', 'clock-bonus', `+${seconds}s`);
  el.clock.append(pop);
  // A timer, not animationend: with reduced motion (or a hidden HUD) the animation never runs.
  setTimeout(() => pop.remove(), 1100);
  el.clock.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
}

/** A mission finished mid-run, queued behind the shot result. */
export function toast(text, reward = '') {
  el.toast.replaceChildren(node('strong', '', text));
  if (reward) el.toast.append(node('b', '', reward));
  el.toast.className = 'toast';
  showNotice(el.toast, 2800);
}

// ---- Panels ---------------------------------------------------------------
export function hideOverlay() {
  el.overlay.inert = true;
  el.overlay.classList.add('hidden');
  el.overlay.replaceChildren();
}

/** Shows a menu panel; `screen` names it (style.css dresses every named screen as TILES). */
function mount(panel, screen = '') {
  if (screen) {
    panel.dataset.screen = screen;
    panel.classList.add('tiles');
  }
  el.overlay.replaceChildren(panel);
  el.overlay.classList.remove('hidden');
  el.overlay.inert = false;
  el.hud.inert = true;
  panel.tabIndex = -1;
  panel.querySelector('.primary')?.focus({ preventScroll: true });
}

function logo() {
  const title = node('h1', 'logo');
  title.append(node('span', 'logo-block', 'BLOCK'), node('span', 'logo-striker', 'STRIKER'));
  return title;
}

/** A labelled progress bar; `fill` is 0..1. */
function bar(fill) {
  const track = node('i', 'bar');
  track.style.setProperty('--fill', `${Math.round(100 * Math.max(0, Math.min(1, fill)))}%`);
  return track;
}

/** Overall game progress: the percentage, a bar, and its three parts. */
function gameProgressBlock(game) {
  const block = node('div', 'game-progress');
  const head = node('div', 'r-row');
  head.append(node('span', 'r-label', 'Game progress'), node('b', 'gp-percent', `${game.percent}%`));
  block.append(head, bar(game.percent / 100), node('p', 'r-small gp-parts',
    `Level ${game.level.value}/${game.level.goal}  ·  Missions ${game.missions.value}/${game.missions.goal}  ·  Items ${game.items.value}/${game.items.goal}`));
  return block;
}

/** Mission rows: text, progress bar and reward; `finished` ones are ticked. */
function missionList(missions, finished = []) {
  const list = node('ul', 'missions');
  for (const mission of finished) {
    const row = node('li', 'done');
    row.append(node('i', 'tick', '\u2714'), node('span', 'mission-text', mission.text), node('b', '', `+${mission.xp} XP`));
    list.append(row);
  }
  for (const mission of missions) {
    const row = node('li');
    row.append(node('i', 'tick'), node('span', 'mission-text', mission.text), bar(mission.value / mission.goal),
      node('b', '', `${thousands(mission.value)}/${thousands(mission.goal)}`));
    list.append(row);
  }
  return list;
}

/** Pause: the game is frozen behind it; RESUME is the big button. */
export function showPause(options) {
  const { onResume, onRestart, missions = [] } = options;
  const panel = node('div', 'panel pause-panel');
  const main = node('div', 'pause-main'), side = node('div', 'pause-side');
  main.append(logo(), node('p', 'tagline', 'PAUSED'));
  if (missions.length) side.append(node('h3', 'section-title', 'MISSIONS'), missionList(missions));
  const actions = node('div', 'actions stack dock');
  actions.append(button('RESUME', onResume, 'primary', ICON.play), button('RESTART', onRestart, 'sec', ICON.restart));
  main.append(actions);
  panel.append(main);
  if (missions.length) panel.append(side);
  mount(panel, 'pause');
}

/**
 * Landscape screens never scroll: a grid of cards shows one page at a time,
 * with page buttons, sized to the screen (one row on short screens). Portrait
 * shows everything (it scrolls). Returns { show(index) } to turn to a card's page.
 */
function pageGrid(grid, startIndex = 0, fixed = null) {
  const cards = [...grid.children];
  const landscape = innerWidth > innerHeight;
  // The actions sit beside the grid in landscape: one card fewer per row.
  const cols = fixed ? fixed.cols : (innerWidth >= 1000 ? 6 : innerWidth >= 740 ? 5 : 4) - (landscape ? 1 : 0);
  const perPage = fixed ? fixed.cols : landscape ? cols * (innerHeight >= 700 ? 2 : 1) : cards.length;
  const pages = Math.max(1, Math.ceil(cards.length / perPage));
  if (landscape || fixed) grid.style.gridTemplateColumns = `repeat(${Math.min(cols, cards.length)}, minmax(0, 1fr))`;
  const nav = node('div', 'pager' + (pages > 1 ? '' : ' hidden'));
  const label = node('span', 'pager-label');
  let page = 0;
  const turn = to => {
    page = (to + pages) % pages;
    cards.forEach((card, i) => card.classList.toggle('off-page', Math.floor(i / perPage) !== page));
    label.textContent = `${page + 1} / ${pages}`;
  };
  const prev = button('\u25C0', () => turn(page - 1), 'small pager-button');
  const next = button('\u25B6', () => turn(page + 1), 'small pager-button');
  prev.setAttribute('aria-label', 'Previous page');
  next.setAttribute('aria-label', 'Next page');
  nav.append(prev, label, next);
  turn(Math.floor(Math.max(0, startIndex) / perPage));
  return { nav, show: index => { if (Math.floor(index / perPage) !== page) turn(Math.floor(index / perPage)); } };
}

/** Bottom edge of the score block, in CSS pixels (Poki's pill goes below it). */
export const scoreBottom = () => document.querySelector('.hud-score').getBoundingClientRect().bottom;

/** "TAP" on touch screens, "CLICK" with a mouse. */
export const pressWord = () => matchMedia('(pointer: coarse)').matches ? 'TAP' : 'CLICK';

/** The pause button in the HUD (touch has no Esc key). */
export function initPauseButton(onPause) {
  const b = button('II', onPause, 'pause-button');
  b.setAttribute('aria-label', 'Pause');
  el.controls.append(b);
}

/**
 * Game over, or the daily challenge's results. One clear order, top to bottom
 * (two columns on a landscape screen): the result, progress toward the next
 * unlock, missions, then what to do next.
 */
export function showGameOver(options) {
  const { rush = null, score, isBest, level, goals, bullseyes, bestCombo, precision, rank, toBest,
  daily, xpGained, unlocked, next, missions, finished, boosted, lockerNew, dailyStatus, collection, game,
  rewards = [], onUseUnlock = null,
  onReplay, onContinue, onBoost, onCheckpoint, checkpoint, onDaily, onLocker, onStriker } = options;
  const panel = node('div', 'panel results-panel');

  // The result.
  const hero = node('div', 'r-hero');
  hero.append(node('h2', 'r-title' + (isBest && score > 0 && !daily ? ' best' : ''),
    daily ? 'DAILY DONE' : isBest && score > 0 ? 'NEW BEST!' : rush ? 'TIME UP!' : 'GAME OVER'));
  const scoreLine = node('p', 'r-score', thousands(score));
  hero.append(scoreLine);
  const gap = daily
    ? (daily.newBest ? 'New daily best!' : `Today's best: ${thousands(daily.best)}`)
    : toBest > 0 ? `${thousands(toBest)} points to beat your best` : isBest && score > 0 ? 'Your best run ever' : '';
  if (gap) hero.append(node('p', 'r-gap', gap));
  if (daily) hero.append(node('p', 'r-streak', `\u{1F525} ${daily.streak}-day streak`));
  hero.append(node('p', 'r-meta', [daily ? `Reached level ${level}` : `Level ${level} · ${rank}`,
    `${goals} goal${goals === 1 ? '' : 's'}`, `${bullseyes} bullseye${bullseyes === 1 ? '' : 's'}`,
    `${precision}% on target`].join('  ·  ')));

  // Progress toward the next unlock, and the whole collection.
  const progress = node('section', 'r-card r-progress');
  const head = node('div', 'r-row');
  head.append(node('b', 'r-xp', `+${thousands(xpGained)} XP`),
    node('span', '', next ? `Next: ${next.name}` : 'Everything unlocked'));
  progress.append(head, bar(next ? next.fraction : 1));
  const foot = node('div', 'r-row r-small');
  foot.append(node('span', '', next ? `${thousands(next.need)} XP to go` : ''));
  progress.append(foot);
  // Unlocks get their own big card under the score (see unlockCard).
  progress.append(gameProgressBlock(game));

  // Missions.
  const tasks = node('section', 'r-card r-missions');
  tasks.append(node('h3', 'r-label', 'Missions'), missionList(missions, finished));

  // What next. Poki: the standard PLAY AGAIN comes first and is the largest; the
  // rewarded offer sits right under it, prominent but smaller, never green, with
  // the video icon. Then the locker, then the smaller extras.
  const actions = node('div', 'r-actions dock');
  actions.append(button('PLAY AGAIN', onReplay, 'primary', ICON.play));
  if (onContinue) {
    const reward = button(rush ? `Continue: +${rush.bonus} seconds` : 'Continue: +1 heart', onContinue, 'reward big', ICON.video);
    reward.id = 'continue-button';
    actions.append(reward);
  } else if (onBoost) {
    const reward = button(rush ? `Next rush: +${rush.bonus} seconds` : 'Next run: +1 heart', onBoost, 'reward big', ICON.video);
    reward.id = 'boost-button';
    actions.append(reward);
  }
  const lockerButton = button('Locker', onLocker,
    'sec locker-cta' + (lockerNew ? ' has-new' : ''), ICON.locker);
  if (lockerNew) lockerButton.append(node('em', 'new', 'NEW'));
  actions.append(lockerButton);
  const more = node('div', 'r-more');
  const dailyButton = button(dailyStatus.played ? `Daily ✔` : 'Daily', onDaily, 'small sec daily-button' + (dailyStatus.played ? '' : ' glow'), ICON.daily);
  if (dailyStatus.streak > 0) dailyButton.append(node('em', '', `\u{1F525}${dailyStatus.streak}`));
  more.append(dailyButton, button('Striker', onStriker, 'small sec striker-button', ICON.striker));
  // Short landscape screens: missions and game progress are a click away, not a scroll.
  const detail = button('Missions', () => panel.classList.add('show-detail'), 'small sec detail-button', ICON.missions);
  more.append(detail);
  if (onCheckpoint) more.append(button(`Start at level ${checkpoint}`, onCheckpoint, 'small sec', ICON.flag));
  actions.append(more);
  if (!onContinue && !onBoost && boosted) actions.append(node('p', 'r-small r-boost', rush
    ? `Boost ready: your next rush starts with +${rush.bonus} seconds` : 'Boost ready: your next run starts with an extra heart'));

  for (const reward of rewards) hero.append(unlockCard(reward, onUseUnlock));
  const back = button('BACK', () => panel.classList.remove('show-detail'), 'primary detail-back', ICON.back);
  panel.append(hero, progress, tasks, actions, back);
  mount(panel, 'results');
  countUp(scoreLine, score);
}

/** The result's number counts up from zero (skipped when motion is reduced). */
function countUp(target, value, ms = 900) {
  if (value <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const step = now => {
    if (!target.isConnected) return;
    const t = Math.min(1, (now - start) / ms);
    target.textContent = thousands(Math.round(value * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  target.textContent = '0';
  requestAnimationFrame(step);
}

/**
 * The rush's reward screen: the score, the unlock as the centrepiece, NEXT,
 * and under it the rewarded offer to keep playing.
 */
export function showReward(options) {
  const { score, isBest, won = false, goals, rewards, onUseUnlock, continueSeconds, onContinue, onNext, focus = null } = options;
  const panel = node('div', 'panel reward-panel');
  const head = node('div', 'reward-head'), body = node('div', 'reward-body');
  head.append(node('h2', 'r-title' + (won || (isBest && score > 0) ? ' best' : ''),
    won ? '\u{1F3C6} CHAMPION!' : isBest && score > 0 ? 'NEW BEST!' : 'TIME UP!'));
  const scoreLine = node('p', 'r-score', thousands(score));
  head.append(scoreLine, node('p', 'r-meta', `${goals} goal${goals === 1 ? '' : 's'}`));
  panel.append(head);
  if (rewards.length === 1) {
    body.append(node('p', 'reward-heading', 'YOUR REWARD'), unlockCard(rewards[0], onUseUnlock, true));
    panel.append(body);
  } else if (rewards.length) {
    // Several unlocks: small cards side by side (three in landscape, two in
    // portrait), paged, so the screen never scrolls.
    body.append(node('p', 'reward-heading', `YOUR REWARDS \u00b7 ${rewards.length}`));
    const cards = node('div', 'reward-cards');
    for (const reward of rewards) cards.append(unlockCard(reward, onUseUnlock, false));
    const pager = pageGrid(cards, Math.max(0, rewards.findIndex(reward => reward.id === focus)),
      { cols: innerWidth > innerHeight ? 3 : 2 });
    body.append(cards, pager.nav);
    panel.append(body);
  }
  const actions = node('div', 'r-actions dock');
  const next = button('NEXT', onNext, 'primary', ICON.play);
  next.id = 'reward-next';
  actions.append(next);
  if (onContinue) {
    const reward = button(`+${continueSeconds} seconds: keep playing`, onContinue, 'reward big', ICON.video);
    reward.id = 'continue-button';
    actions.append(reward);
  }
  panel.append(actions);
  mount(panel, 'reward');
  countUp(scoreLine, score);
}

/** The run's unlock: a preview of the item, its name, and a button to use it straight away. */
const UNLOCK_KIND = { kit: 'NEW KIT', boots: 'NEW BOOTS', ball: 'NEW BALL', celebration: 'NEW CELEBRATION', striker: 'NEW STRIKER',
  hat: 'NEW HAT', glasses: 'NEW GLASSES' };
function unlockCard(item, onUse, big = false) {
  const card = node('div', `unlock-card ${item.type}${big ? ' big' : ''}`);
  const preview = node('div', 'unlock-preview');
  if (item.sprite) { item.sprite.className = 'sprite'; preview.append(item.sprite); }
  else {
    const swatch = node('i', 'swatch' + (item.icon ? ' icon' : ''), item.icon || (item.type === 'celebration' ? '\u2605' : ''));
    if (item.color != null) swatch.style.background = hex(item.color);
    if (item.accent != null) swatch.style.setProperty('--accent', hex(item.accent));
    preview.append(swatch);
  }
  const text = node('div', 'unlock-text');
  text.append(node('span', 'unlock-kind', `\u{1F513} ${UNLOCK_KIND[item.type]} UNLOCKED!`), node('strong', 'unlock-name', item.name));
  if (item.style) text.append(node('span', 'unlock-style', item.style));
  card.append(preview, text);
  if (onUse) {
    card.append(item.inUse ? node('span', 'unlock-inuse', '\u2714 IN USE')
      : button(item.type === 'striker' ? 'PLAY AS' : 'EQUIP', () => onUse(item.id), 'small unlock-use'));
  }
  return card;
}

/** The locker: every kit, pair of boots, ball and celebration, and how to get it. */
export function showLocker(options) {
  const { items, tab, tabs, onTab, xp, next, game, onEquip, onBack } = options;
  const panel = node('div', 'panel locker-panel');
  panel.append(node('h2', 'over-title locker-title', 'LOCKER'),
    node('p', 'over-rank', `${thousands(xp)} XP${next ? `  \u00b7  NEXT: ${next.name} AT ${thousands(next.xp)}` : ''}`));
  panel.append(gameProgressBlock(game));
  // Tabs, each flagged when it holds something new.
  const tabRow = node('div', 'locker-tabs');
  for (const [type, label] of tabs) {
    const b = button(label, () => onTab(type), 'small tab' + (type === tab ? ' active' : ''));
    const inTab = items.filter(item => item.type === type);
    b.append(node('span', 'tab-count', ` ${inTab.filter(item => item.unlocked).length}/${inTab.length}`));
    if (inTab.some(item => item.isNew)) b.append(node('em', 'new', 'NEW'));
    tabRow.append(b);
  }
  panel.append(tabRow);
  const grid = node('div', 'locker');
  const labels = { kit: 'KIT', boots: 'BOOTS', ball: 'BALL', celebration: 'MOVE', hat: 'HAT', glasses: 'GLASSES' };
  for (const item of items.filter(entry => entry.type === tab)) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `locker-item ${item.type}${item.unlocked ? '' : ' locked'}${item.equipped ? ' equipped' : ''}`;
    tile.disabled = !item.unlocked;
    const swatch = node('i', 'swatch');
    if (item.color != null) swatch.style.background = hex(item.color);
    if (item.accent != null) swatch.style.setProperty('--accent', hex(item.accent));
    if (item.type === 'celebration' && !item.icon) swatch.textContent = '\u2605';
    if (item.icon) { swatch.textContent = item.icon; swatch.classList.add('icon'); }
    tile.append(swatch, node('span', 'item-type', labels[item.type]), node('span', 'item-name', item.short),
      node('span', 'item-state', !item.unlocked ? `${thousands(item.xp)} XP` : item.equipped ? 'EQUIPPED' : 'EQUIP'));
    if (item.isNew) tile.append(node('em', 'new', 'NEW'));
    if (item.unlocked && !item.equipped) tile.onclick = () => onEquip(item.id);
    grid.append(tile);
  }
  const pager = pageGrid(grid, Math.max(0, items.filter(entry => entry.type === tab).findIndex(item => item.equipped)));
  const actions = node('div', 'actions dock');
  actions.append(pager.nav, button('BACK', onBack, 'primary', ICON.back));
  panel.append(grid, actions);
  mount(panel, 'locker');
}

/**
 * Choose your striker: a card per striker with their pixel portrait. Picking a
 * card calls `onPick` at once (the striker on the pitch changes behind the
 * panel); PLAY starts, BACK (from the results) returns.
 */
export function showStrikerSelect(options) {
  const { strikers, selected, onPick, onPlay, onBack = null } = options;
  const panel = node('div', 'panel select-panel');
  panel.append(node('h2', 'over-title locker-title', 'CHOOSE YOUR STRIKER'));
  const grid = node('div', 'strikers');
  for (const striker of strikers) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'striker-card' + (striker.id === selected ? ' selected' : '') + (striker.unlocked ? '' : ' locked');
    card.dataset.id = striker.id;
    card.disabled = !striker.unlocked;
    striker.sprite.className = 'sprite';
    card.append(striker.sprite, node('strong', '', striker.name),
      node('span', '', striker.unlocked ? striker.style : `\u{1F512} ${thousands(striker.xp)} XP`));
    if (striker.isNew) card.append(node('em', 'new', 'NEW'));
    card.onclick = () => {
      for (const other of grid.children) other.classList.toggle('selected', other === card);
      pager?.show([...grid.children].indexOf(card));
      onPick(striker.id);
    };
    grid.append(card);
  }
  const pager = pageGrid(grid, strikers.findIndex(striker => striker.id === selected));
  const actions = node('div', 'actions dock');
  actions.append(pager.nav, button('PLAY', onPlay, 'primary', ICON.play));
  if (onBack) actions.append(button('BACK', onBack, 'sec', ICON.back));
  const hint = pressWord() === 'TAP' ? 'TAP A STRIKER, THEN PLAY' : 'CLICK A STRIKER, THEN PLAY';
  panel.append(grid, node('p', 'select-hint', hint), actions);
  mount(panel, 'select');
}

/** Arrow keys on the striker screen: move the selection one card. */
export function stepStriker(direction) {
  const cards = [...el.overlay.querySelectorAll('.striker-card:not(:disabled)')];
  if (!cards.length) return;
  const index = cards.findIndex(card => card.classList.contains('selected'));
  cards[(index + direction + cards.length) % cards.length].click();
}

/* @dev */
/** Localhost screen previews: a yellow tag naming the screen on show. */
let devTagTimer = 0;
export function devTag(text) {
  let tag = document.getElementById('dev-tag');
  if (!tag) {
    tag = node('div', '');
    tag.id = 'dev-tag';
    tag.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;padding:4px 8px;background:#ffd23f;color:#2b1d00;'
      + 'font:700 13px system-ui,sans-serif;border:2px solid #000;pointer-events:none';
    document.body.append(tag);
  }
  tag.textContent = text;
  tag.hidden = false;
  clearTimeout(devTagTimer);
  devTagTimer = setTimeout(() => { tag.hidden = true; }, 2500);
}
/* @end-dev */

/** The rewarded ad did not complete: the continue offer goes away. */
export function dropContinue() { document.getElementById('continue-button')?.remove(); }

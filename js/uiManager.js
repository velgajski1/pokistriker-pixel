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
  el.rank = $('hud-rank');
  el.progress = $('hud-progress');
  el.special = $('hud-special');
  el.toast = $('toast');
  el.swipe = $('swipe');
  el.swipeLine = el.swipe.querySelector('polyline');
  el.charge = $('charge');
  el.hearts = $('hud-hearts');
  el.prompt = $('phase-prompt');
  el.verdict = $('verdict');
  el.banner = $('banner');
  el.overlay = $('overlay');
  // Flow layout keeps changing scores, specials and controls in separate regions.
  const top = node('div', 'hud-top');
  el.controls = node('div', 'hud-controls');
  el.controls.append(el.hearts);
  top.append(el.score.parentElement, el.level.parentElement, el.controls, el.special);
  const notices = node('div', 'hud-notices');
  notices.append(el.verdict, el.banner, el.toast);
  const bottom = node('div', 'hud-bottom');
  bottom.append(el.charge, el.prompt);
  el.hud.prepend(top, notices, bottom);
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
  rank = '', daily = null, special = null, progress = null }) {
  if (score !== lastScore) {
    el.score.textContent = String(score).padStart(6, '0');
    lastScore = score;
  }
  el.best.textContent = `BEST ${String(Math.max(best, score)).padStart(6, '0')}`;
  el.combo.textContent = combo > 1 ? `x${combo}` : '';
  el.combo.classList.toggle('show', combo > 1);
  el.level.textContent = daily ? `DAILY ${daily.shot}/${daily.of}` : `LEVEL ${level}`;
  el.rank.textContent = daily ? `LEVEL ${level}` : rank;
  if (progress !== null && el.progress.dataset.percent !== String(progress)) {
    el.progress.dataset.percent = progress;
    el.progress.firstChild.textContent = `PROGRESS ${progress}%`;
    el.progress.style.setProperty('--fill', `${progress}%`);
  }
  const blocks = [];
  if (!daily) for (let i = 0; i < levelSteps; i++) {
    blocks.push(node('i', i < Math.round(levelProgress * levelSteps) ? 'on' : ''));
  }
  el.levelBlocks.replaceChildren(...blocks);
  el.hearts.classList.toggle('hidden', !!daily);
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
  const tap = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click or press Space';
  el.prompt.replaceChildren(
    node('span', 'tutorial-step', `YOUR FIRST SHOT · STEP ${step} OF 2`),
    node('strong', 'tutorial-title', step === 1 ? 'Aim at the target' : 'Set the shot height'),
    node('span', 'tutorial-instruction', step === 1
      ? `${tap} to stop the moving arrow.` : `${tap} again to stop the height marker and shoot.`));
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
export function showLevelUp(title, note = '') {
  el.banner.replaceChildren(node('strong', '', title));
  if (note) el.banner.append(node('span', '', note));
  el.banner.className = 'banner';
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

/** Free aim's charge meter, 0..1; null hides it. */
export function setCharge(value) {
  el.charge.classList.toggle('hidden', value === null);
  if (value !== null) el.charge.style.setProperty('--fill', `${Math.round(value * 100)}%`);
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

function mount(panel) {
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
export function showPause({ onResume, onRestart, missions = [] }) {
  const panel = node('div', 'panel pause-panel');
  panel.append(logo(), node('p', 'tagline', 'PAUSED'));
  if (missions.length) panel.append(node('h3', 'section-title', 'MISSIONS'), missionList(missions));
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
  el.controls.append(b);
}

/**
 * Game over, or the daily challenge's results. One clear order, top to bottom
 * (two columns on a landscape screen): the result, progress toward the next
 * unlock, missions, then what to do next.
 */
export function showGameOver({ score, isBest, level, goals, bullseyes, bestCombo, precision, rank, toBest,
  daily, xpGained, unlocked, next, missions, finished, boosted, lockerNew, dailyStatus, collection, game,
  onReplay, onContinue, onBoost, onCheckpoint, checkpoint, onDaily, onLocker, onStriker }) {
  const panel = node('div', 'panel results-panel');

  // The result.
  const hero = node('div', 'r-hero');
  hero.append(node('h2', 'r-title' + (isBest && score > 0 && !daily ? ' best' : ''),
    daily ? 'DAILY DONE' : isBest && score > 0 ? 'NEW BEST!' : 'GAME OVER'));
  hero.append(node('p', 'r-score', thousands(score)));
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
  for (const item of unlocked) progress.append(node('p', 'r-unlocked', `Unlocked: ${item.name}`));
  progress.append(gameProgressBlock(game));

  // Missions.
  const tasks = node('section', 'r-card r-missions');
  tasks.append(node('h3', 'r-label', 'Missions'), missionList(missions, finished));

  // What next. Poki: the standard PLAY AGAIN comes first and is the largest; the
  // rewarded offer sits right under it, prominent but smaller, never green, with
  // the video icon. Then the locker, then the smaller extras.
  const actions = node('div', 'r-actions');
  actions.append(button('PLAY AGAIN', onReplay, 'primary'));
  if (onContinue) {
    const reward = button('\u{1F3AC} Continue: +1 heart', onContinue, 'reward big');
    reward.id = 'continue-button';
    actions.append(reward);
  } else if (onBoost) {
    const reward = button('\u{1F3AC} Next run: +1 heart', onBoost, 'reward big');
    reward.id = 'boost-button';
    actions.append(reward);
  }
  const lockerButton = button(lockerNew ? 'Locker: new items!' : 'Locker', onLocker,
    'locker-cta' + (lockerNew ? ' has-new' : ''));
  if (lockerNew) lockerButton.append(node('em', 'new', 'NEW'));
  actions.append(lockerButton);
  const more = node('div', 'r-more');
  const dailyButton = button(dailyStatus.played ? `Daily ✔` : 'Daily', onDaily, 'small' + (dailyStatus.played ? '' : ' glow'));
  if (dailyStatus.streak > 0) dailyButton.append(node('em', '', `\u{1F525}${dailyStatus.streak}`));
  more.append(dailyButton, button('Striker', onStriker, 'small'));
  if (onCheckpoint) more.append(button(`Start at level ${checkpoint}`, onCheckpoint, 'small'));
  actions.append(more);
  if (!onContinue && !onBoost && boosted) actions.append(node('p', 'r-small r-boost', 'Boost ready: your next run starts with an extra heart'));

  panel.append(hero, progress, tasks, actions);
  mount(panel);
}

/** The locker: every kit, pair of boots, ball and celebration, and how to get it. */
export function showLocker({ items, tab, tabs, onTab, xp, next, collection, game, onEquip, onBack }) {
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
  const labels = { kit: 'KIT', boots: 'BOOTS', ball: 'BALL', celebration: 'MOVE' };
  for (const item of items.filter(entry => entry.type === tab)) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `locker-item ${item.type}${item.unlocked ? '' : ' locked'}${item.equipped ? ' equipped' : ''}`;
    tile.disabled = !item.unlocked || item.type === 'celebration';
    const swatch = node('i', 'swatch');
    if (item.color != null) swatch.style.background = hex(item.color);
    if (item.accent != null) swatch.style.setProperty('--accent', hex(item.accent));
    if (item.type === 'celebration') swatch.textContent = '\u2605';
    tile.append(swatch, node('span', 'item-type', labels[item.type]), node('span', 'item-name', item.short),
      node('span', 'item-state', !item.unlocked ? `${thousands(item.xp)} XP` : item.equipped ? 'EQUIPPED'
        : item.type === 'celebration' ? 'UNLOCKED' : 'EQUIP'));
    if (item.isNew) tile.append(node('em', 'new', 'NEW'));
    if (item.unlocked && item.type !== 'celebration' && !item.equipped) tile.onclick = () => onEquip(item.id);
    grid.append(tile);
  }
  const actions = node('div', 'actions');
  actions.append(button('BACK', onBack, 'primary'));
  panel.append(grid, actions);
  mount(panel);
}

/**
 * Choose your striker: a card per striker with their pixel portrait. Picking a
 * card calls `onPick` at once (the striker on the pitch changes behind the
 * panel); PLAY starts, BACK (from the results) returns.
 */
export function showStrikerSelect({ strikers, selected, onPick, onPlay, onBack = null }) {
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
      onPick(striker.id);
    };
    grid.append(card);
  }
  const actions = node('div', 'actions');
  actions.append(button('PLAY', onPlay, 'primary'));
  if (onBack) actions.append(button('BACK', onBack));
  const hint = pressWord() === 'TAP' ? 'TAP A STRIKER, THEN PLAY' : '← → TO CHOOSE, SPACE TO PLAY';
  panel.append(grid, node('p', 'select-hint', hint), actions);
  mount(panel);
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

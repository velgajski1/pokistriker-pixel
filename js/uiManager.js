/**
 * uiManager.js - every DOM write in the game happens here.
 *
 * Screen transitions use one utility flag (.hidden). Upgrade tables are built
 * procedurally from the data model app.js hands over; this module owns no
 * game state of its own.
 */

const $ = (id) => document.getElementById(id);

export function initAudioControls(settings, onChange, onSound) {
  const controls = document.createElement('details');
  controls.className = 'audio-controls hidden';
  const summary = document.createElement('summary');
  summary.textContent = 'Sound';
  controls.append(summary);
  for (const key of ['music', 'sfx']) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = key === 'music' ? 'Music' : 'Sound effects';
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.value = String(Math.round(settings[key] * 100));
    input.setAttribute('aria-label', title.textContent + ' volume');
    const output = document.createElement('output');
    output.textContent = input.value + '%';
    input.oninput = () => {
      output.textContent = input.value + '%';
      onChange(key, Number(input.value) / 100);
    };
    input.onchange = () => onSound('click');
    label.append(title, input, output); controls.append(label);
  }
  for (const event of ['pointerdown', 'click', 'keydown']) controls.addEventListener(event, e => e.stopPropagation());
  document.body.append(controls);
  document.addEventListener('pointerover', e => {
    const button = e.target.closest('button');
    if (button && !button.contains(e.relatedTarget)) onSound('hover');
  });
  document.addEventListener('focusin', e => { if (e.target.closest('button')) onSound('hover'); });
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button:disabled')) onSound('unavailable');
  }, true);
  document.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    onSound(button.disabled || button.getAttribute('aria-disabled') === 'true' ? 'unavailable'
      : /back/i.test(button.textContent) ? 'back' : button.classList.contains('character-card') ? 'select'
      : /^(play|next|confirm|kick off)/i.test(button.textContent.trim()) ? 'confirm' : 'click');
  }, true);
}

const el = {
  dim: null, hud: null, left: null, right: null,
  ticker: null,
  prompt: null, verdict: null, overlay: null,
  identity: null, confidence: null, confidenceFill: null, confidenceValue: null,
};

let verdictTimer = 0;
const loadingStarted = performance.now();

export async function preloadMenuAssets(portraits) {
  await Promise.all([
    'assets/ui/bg/shooting-goal.webp',
    'assets/ui/hud/confidence-frame.png',
    'assets/ui/hud/confidence-fill.png',
    'assets/ui/hud/game-over.png',
    'assets/ui/hud/manager-angry.png',
    ...portraits,
  ].map(src => {
    const image = new Image();
    image.src = src;
    // Missing optional artwork must not prevent playing the game.
    return image.decode().catch(() => {});
  }));
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
  $('preloader-message').textContent = 'Could not get the game ready. Please try again.';
  const retry = $('preloader-retry');
  retry.classList.remove('hidden');
  retry.onclick = () => location.reload();
}

const menuThemes = ['Stadium', 'Daylight', 'Matchday', 'Clubhouse', 'Arcade', 'Varsity', 'Editorial', 'Neon'];
let menuTheme = 0;

export function cycleMenuTheme(direction) {
  menuTheme = (menuTheme + direction + menuThemes.length) % menuThemes.length;
  el.overlay.dataset.theme = menuThemes[menuTheme].toLowerCase();
  const label = el.overlay.querySelector('.theme-name');
  if (label) label.textContent = menuThemes[menuTheme];
}

export const isMainMenu = () => !!el.overlay.querySelector('.main-menu');

export function init() {
  el.dim = $('dim');
  el.hud = $('hud');
  el.left = $('hud-left');
  el.right = $('hud-right');
  el.ticker = $('ticker');
  el.prompt = $('phase-prompt');
  el.verdict = $('verdict');
  el.overlay = $('overlay');
  el.identity = document.createElement('div');
  el.identity.className = 'career-identity hidden';
  const confidence = confidenceMeter(0, 100, 'trainer-confidence');
  el.confidence = confidence.root;
  el.confidenceFill = confidence.fill;
  el.confidenceValue = confidence.value;
  el.confidence.dataset.value = '';
  el.confidence.classList.add('hidden');
  el.hud.append(el.identity, el.confidence);
}

function confidenceMeter(value, max, className = '') {
  const root = document.createElement('div');
  root.className = `confidence-meter ${className}`.trim();
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', 'Trainer confidence');

  const heading = document.createElement('div');
  heading.className = 'confidence-heading';
  const label = document.createElement('span');
  label.textContent = 'TRAINER CONFIDENCE';
  const amount = document.createElement('b');
  heading.append(label, amount);

  const track = document.createElement('div');
  track.className = 'confidence-track';
  track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div');
  fill.className = 'confidence-fill';
  track.appendChild(fill);
  root.append(heading, track);
  updateConfidenceMeter({ root, fill, value: amount }, value, max);
  return { root, fill, value: amount };
}

const confidenceTweens = new WeakMap();

function updateConfidenceMeter(meter, value, max, animate = true) {
  const safeValue = Math.max(0, Math.min(max, Number(value) || 0));
  const displayPercent = Math.min(100, safeValue);
  const previous = Number(meter.root.dataset.meterValue);
  const changed = meter.root.dataset.meterValue !== undefined && previous !== safeValue;
  const running = confidenceTweens.get(meter.root);
  if (animate && !changed && running) return;
  const fromValue = running ? running.displayed : previous;
  const from = animate && changed && meter.fill.isConnected ? getComputedStyle(meter.fill).clipPath : null;
  const to = `inset(0 ${(100 - displayPercent).toFixed(1)}% 0 0)`;
  if (changed || !animate) {
    if (running) cancelAnimationFrame(running.frame);
    confidenceTweens.delete(meter.root);
    for (const animation of meter.fill.getAnimations()) animation.cancel();
  }
  meter.fill.style.clipPath = to;
  if (from) {
    // Sample the visible fill before cancelling, so consecutive changes stay smooth.
    const animation = meter.fill.animate([{ clipPath: from }, { clipPath: to }], {
      duration: Math.abs(safeValue - previous) > 1 ? 1600 : 350,
      easing: 'cubic-bezier(.25,.1,.25,1)',
    });
    const tween = { displayed: fromValue, frame: 0 };
    confidenceTweens.set(meter.root, tween);
    const count = () => {
      if (confidenceTweens.get(meter.root) !== tween) return;
      if (!meter.root.isConnected) {
        animation.cancel();
        confidenceTweens.delete(meter.root);
        return;
      }
      // The effect's progress includes the fill's easing, keeping both in sync.
      const progress = animation.playState === 'finished' ? 1 : animation.effect.getComputedTiming().progress ?? 0;
      tween.displayed = fromValue + (safeValue - fromValue) * progress;
      meter.value.textContent = `${Math.round(tween.displayed)}%`;
      meter.root.setAttribute('aria-valuenow', String(Math.round(tween.displayed)));
      if (progress < 1) tween.frame = requestAnimationFrame(count);
      else confidenceTweens.delete(meter.root);
    };
    count();
  }
  meter.root.dataset.meterValue = String(safeValue);
  if (!from) meter.value.textContent = `${Math.round(safeValue)}%`;
  meter.root.setAttribute('aria-valuemin', '0');
  meter.root.setAttribute('aria-valuemax', String(max));
  if (!from) meter.root.setAttribute('aria-valuenow', String(Math.round(safeValue)));
  meter.root.classList.toggle('low', safeValue < 30);
  meter.root.classList.toggle('over', safeValue > 100);
}

export function setCareerIdentity(character) {
  el.identity.replaceChildren();
  el.identity.classList.toggle('hidden', !character);
  if (!character) return;
  const portrait = document.createElement('img');
  portrait.src = character.portrait;
  portrait.alt = '';
  const name = document.createElement('span');
  name.textContent = character.name;
  el.identity.append(portrait, name);
}

// ---------------------------------------------------------------------------
// Match presentation
// ---------------------------------------------------------------------------

/** SIMULATING dims the arena; HIGHLIGHT clears it instantly. */
export function setDimmed(on) { el.dim.classList.toggle('clear', !on); }

export function showHud(on) {
  if (on && el.hud.classList.contains('hidden')) el.confidence.dataset.value = '';
  el.hud.classList.toggle('hidden', !on);
}

export function setScore(match, clock, goals, mode = 'career', enemyGoals = 0, homeClub = '', opponent = '') {
  if (mode === 'tutorial') {
    el.left.textContent = 'LEARN TO SHOOT';
    el.right.textContent = 'ONE PRACTICE SHOT';
    return;
  }
  el.left.textContent = mode === 'practice' ? 'TRAINING | UNLIMITED SHOTS'
    : `${mode === 'single' ? 'SINGLE MATCH' : `MATCH ${match}`} | CLOCK: ${clock}'`;
  el.right.textContent = mode === 'practice' ? `GOALS: ${goals}` : `${homeClub} ${goals} : ${enemyGoals} ${opponent}`;
}

export function setConfidence(value, max, mode = 'career') {
  const visible = mode === 'career';
  el.confidence.classList.toggle('hidden', !visible);
  if (!visible) {
    el.confidence.dataset.value = '';
    return;
  }

  if (el.confidence.dataset.value === String(value)
    && el.confidence.dataset.max === String(max)) return;
  updateConfidenceMeter({
    root: el.confidence, fill: el.confidenceFill, value: el.confidenceValue,
  }, value, max, el.confidence.dataset.value !== '');
  el.confidence.dataset.value = String(value);
  el.confidence.dataset.max = String(max);
}

export function setTicker(minute, text) {
  el.ticker.innerHTML = minute === null
    ? text
    : `<b>${minute}'</b> ${text}`;
}

export function setPrompt(text) {
  el.prompt.textContent = text || '';
  el.prompt.classList.toggle('show', !!text);
}

export function flashVerdict(text, kind) {
  el.verdict.textContent = text;
  el.verdict.className = `verdict show ${kind}`;
  clearTimeout(verdictTimer);
  verdictTimer = setTimeout(() => { el.verdict.className = 'verdict'; }, 1500);
}

// ---------------------------------------------------------------------------
// Overlay screens
// ---------------------------------------------------------------------------
export function hideOverlay() {
  el.overlay.classList.remove('benched-overlay');
  el.overlay.classList.add('hidden');
  el.overlay.replaceChildren();
}

function panel() {
  const p = document.createElement('div');
  p.className = 'panel';
  return p;
}

function mount(node, status = null) {
  el.overlay.classList.remove('benched-overlay');
  const styles = document.createElement('div');
  styles.className = 'theme-switcher hidden';
  const previous = action('↑', () => cycleMenuTheme(-1));
  previous.setAttribute('aria-label', 'Previous menu style');
  const label = document.createElement('span');
  label.className = 'theme-name';
  label.setAttribute('aria-live', 'polite');
  const next = action('↓', () => cycleMenuTheme(1));
  next.setAttribute('aria-label', 'Next menu style');
  styles.append(previous, label, next);
  const hint = document.createElement('span');
  hint.className = 'theme-hint';
  hint.textContent = '↑ / ↓ change style';
  styles.append(hint);
  node.append(styles);
  if (status) {
    const screen = document.createElement('div');
    screen.className = 'upgrade-screen';
    status.classList.add('upgrade-status');
    screen.append(status, node);
    el.overlay.replaceChildren(screen);
  } else {
    el.overlay.replaceChildren(node);
  }
  el.overlay.classList.remove('hidden');
  cycleMenuTheme(0);
}

function pips(level, max) {
  let out = '';
  for (let i = 0; i < max; i++) out += `<i class="${i < level ? 'filled' : ''}"></i>`;
  return out;
}

function meter(pct, max) {
  const slots = 20;
  const filled = Math.round((pct / max) * slots);
  let out = '';
  for (let i = 0; i < slots; i++) out += i < filled ? '■' : ' ';
  return out;
}

/**
 * One procedural upgrade row.
 * @param {{icon?:string,name:string,level:number,max:number,fx:string,
 *          cost:number|null,currency:string,affordable:boolean,onBuy:Function}} row
 */
function statRow(row) {
  const wrap = document.createElement('div');
  wrap.className = `statline upgrade-card${row.cost === null ? ' maxed' : ''}`;

  const icon = document.createElement('img');
  icon.className = 'upgrade-icon';
  icon.alt = '';
  const icons = { 'STAR PLAYER STATUS': 'star', 'SUPER SUB': 'subnet', 'NATURAL TALENT': 'talent',
    'ICE IN THE VEINS': 'veins', "MANAGER'S PET": 'pet', 'GOLDEN BOOT': 'boot',
    'POACHER INSTINCT': 'poacher', 'TARGET PRACTICE': 'target', 'LEG DAY': 'legday', 'ICE BATH': 'icebath' };
  icon.src = `assets/ui/icons/${icons[row.name]}.webp`;

  const pip = document.createElement('span');
  pip.className = 'pips';
  pip.innerHTML = pips(row.level, row.max);
  pip.setAttribute('aria-label', `Level ${row.level} of ${row.max}`);

  const level = document.createElement('span');
  level.className = 'upgrade-level';
  level.textContent = `LVL ${row.level} / ${row.max}`;

  const btn = document.createElement('button');
  if (row.cost === null) {
    btn.textContent = 'MAXED';
    btn.disabled = true;
  } else {
    btn.textContent = `Buy Lv ${row.level + 1} · ${row.currency}${row.cost}`;
    btn.disabled = !row.affordable;
    btn.addEventListener('click', row.onBuy);
  }

  btn.textContent = row.cost === null ? 'MAX' : `${row.currency === 'LP' ? row.cost + ' LP' : row.currency + row.cost}`;
  btn.setAttribute('aria-label', row.cost === null ? `${row.name}: maximum level`
    : `Upgrade ${row.name} to level ${row.level + 1} for ${row.currency}${row.cost}`);
  const title = document.createElement('h3');
  title.className = 'upgrade-title';
  title.textContent = row.name;
  const help = upgradeDetails('?', row.fx);
  help.classList.add('upgrade-help');
  help.querySelector('summary').setAttribute('aria-label', `About ${row.name}`);
  wrap.append(title, help, icon, level, pip, btn);
  return wrap;
}

function upgradeDetails(name, description) {
  const details = document.createElement('details');
  details.className = 'upgrade-details';
  const label = document.createElement('summary');
  label.textContent = name;
  const text = document.createElement('span');
  text.className = 'upgrade-tip';
  text.textContent = description;
  label.append(text);
  details.append(label);
  return details;
}

function header(title, subtitle) {
  const h = document.createElement('h1');
  h.textContent = title;
  if (subtitle) {
    const s = document.createElement('small');
    s.textContent = subtitle;
    h.appendChild(s);
  }
  return h;
}

function divider() {
  const d = document.createElement('div');
  d.className = 'rule';
  return d;
}

function action(text, callback, className = '') {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', callback);
  return button;
}

export function showMainMenu(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'main-menu');
  const brand = document.createElement('div');
  brand.className = 'menu-brand';
  brand.append(header('STRIKER STREAK'));
  const modes = document.createElement('div');
  modes.className = 'mode-list';
  for (const [title, callback] of [
    ['Career Mode', vm.onCareer],
    ['Single Match', vm.onSingle],
    ['Training Mode', vm.onPractice],
  ]) {
    modes.append(action(title, callback, 'menu-option'));
  }
  if (vm.hasProgress) modes.append(action('Reset Progress', vm.onReset, 'menu-option reset-progress'));
  p.append(brand, modes);
  mount(p);
}

export function showCharacterSelection(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'character-panel');
  const grid = document.createElement('div');
  grid.className = 'character-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Choose your career striker');
  const start = action('Play', vm.onStart, 'accent big');
  const cards = [];
  const select = id => {
    for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.character === id));
    vm.onSelect(id);
  };
  for (const character of vm.characters) {
    const card = action('', () => select(character.id), 'character-card');
    card.dataset.character = character.id;
    card.setAttribute('aria-label', character.name);
    card.setAttribute('aria-pressed', String(character.id === vm.selectedId));
    const portrait = document.createElement('img');
    portrait.src = character.portrait;
    portrait.alt = '';
    portrait.width = portrait.height = 512;
    portrait.draggable = false;
    const name = document.createElement('strong');
    name.textContent = character.name;
    const mark = document.createElement('span');
    mark.className = 'character-mark';
    mark.textContent = 'SELECTED';
    mark.setAttribute('aria-hidden', 'true');
    card.append(portrait, name, mark);
    grid.append(card);
    cards.push(card);
  }
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Back', vm.onBack), start);
  p.append(header('CHOOSE YOUR STRIKER'), grid, foot);
  mount(p);
  select(vm.selectedId);
  cards.find(card => card.dataset.character === vm.selectedId).focus({ preventScroll: true });
}

export function showConfirmation(title, description, onConfirm, onCancel) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel');
  const text = document.createElement('p');
  text.className = 'sub';
  text.textContent = description;
  const foot = document.createElement('div');
  foot.className = 'foot';
  const cancel = action('Cancel', onCancel, 'accent');
  foot.append(cancel, action('Reset Progress', onConfirm, 'reset-progress'));
  p.append(header(title), divider(), text, foot);
  mount(p);
  cancel.focus();
}

export function showTutorialComplete(onNext) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel', 'center');
  const message = document.createElement('p');
  message.textContent = 'Congratulations! You’re ready to take your skills onto the pitch.';
  const foot = document.createElement('div');
  foot.className = 'foot';
  const next = action('Next', onNext, 'accent big');
  foot.append(next);
  p.append(header('TUTORIAL COMPLETE', 'NICE WORK, STRIKER!'), divider(), message, foot);
  mount(p);
  next.focus();
}

export function showMatchResult(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel', 'match-result-panel', 'center');
  const outcome = vm.delta > 0 ? 'VICTORY' : vm.delta < 0 ? 'DEFEAT' : 'DRAW';
  p.dataset.outcome = outcome.toLowerCase();
  const opponent = document.createElement('p');
  opponent.className = 'sub';
  opponent.textContent = `${vm.homeClub} vs ${vm.opponent}`;
  const score = document.createElement('p');
  score.className = 'result-score';
  score.textContent = `${vm.goals} : ${vm.enemyGoals}`;
  const change = document.createElement('p');
  change.className = 'match-confidence-change';
  change.textContent = `${vm.delta > 0 ? '+' : ''}${vm.delta} trainer confidence · ${vm.delta > 0 ? 'Win bonus' : vm.delta < 0 ? 'Loss penalty' : 'No change for a draw'}`;
  const meter = confidenceMeter(vm.before, vm.confidenceMax, 'prematch-confidence');
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Next', vm.onNext, 'accent big'));
  const title = header(outcome, `MATCH ${vm.match} · FULL TIME`);
  p.append(title, opponent, score, divider(), change, meter.root, foot);
  mount(p);
  const fillMeter = () => {
    if (meter.root.isConnected) updateConfidenceMeter(meter, vm.after, vm.confidenceMax);
  };
  if (outcome === 'VICTORY') {
    const pieces = [title, opponent, score, change, meter.root, foot];
    const delays = [0, 250, 500, 1000, 1400, 2100];
    const next = foot.querySelector('button');
    next.disabled = true;
    for (let i = 0; i < pieces.length; i++) {
      const animation = pieces[i].animate([
        { opacity: 0, transform: `translateX(${i % 2 ? 100 : -100}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 650, delay: delays[i],
        easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
      // Hold the starting confidence until the bar is fully opaque and in place.
      if (pieces[i] === meter.root) animation.finished.then(fillMeter).catch(() => {});
      if (pieces[i] === foot) animation.finished.then(() => {
        if (next.isConnected) next.disabled = false;
      }).catch(() => {});
    }
  } else requestAnimationFrame(fillMeter);
}

export function showSingleResult(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel', 'center');
  const score = document.createElement('p');
  score.className = 'result-score';
  score.textContent = `${vm.goals} : ${vm.enemyGoals}`;
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Main Menu', vm.onMenu), action('Play Again', vm.onReplay, 'accent'));
  p.append(header('FULL TIME', `${vm.homeClub} vs ${vm.opponent} · ${vm.goals > vm.enemyGoals ? 'VICTORY' : vm.goals < vm.enemyGoals ? 'DEFEAT' : 'DRAW'}`), score, foot);
  mount(p);
}

export function showPrematch(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel', 'prematch-panel', 'center');
  const flag = document.createElement('div');
  flag.className = 'opponent-flag';
  flag.style.setProperty('--club-color', vm.color);
  flag.setAttribute('aria-hidden', 'true');
  flag.textContent = vm.name.split(' ').map(word => word[0]).join('');
  const name = document.createElement('h2');
  name.textContent = vm.name;
  const defense = document.createElement('p');
  defense.className = 'opponent-defense';
  defense.textContent = `DEFENSE ${vm.rating} / 100`;
  const detail = document.createElement('p');
  detail.className = 'sub';
  detail.textContent = 'Higher defense means faster, sharper goalkeepers and defenders.';
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Back', vm.onMenu), action('Play', vm.onPlay, 'accent big'));
  const title = header(`MATCH ${vm.match}${vm.totalMatches ? ` / ${vm.totalMatches}` : ''}`, 'YOUR OPPONENT');
  const pieces = [title, flag, name, defense, detail];
  p.append(...pieces);
  let meter = null;
  if (vm.confidence != null) {
    meter = confidenceMeter(vm.confidence, vm.confidenceMax, 'prematch-confidence');
    p.append(meter.root);
    const warning = document.createElement('p');
    warning.className = 'sub';
    warning.textContent = 'If trainer confidence is 0% at full time, you are benched and your season ends. Train over summer and come back stronger!';
    p.append(warning);
    pieces.push(meter.root, warning);
  }
  p.append(foot);
  pieces.push(foot);
  mount(p);
  const buttons = foot.querySelectorAll('button');
  for (const button of buttons) button.disabled = true;
  for (let i = 0; i < pieces.length; i++) {
    const entrance = pieces[i].animate([
      { opacity: 0, transform: `translateX(${i % 2 ? 80 : -80}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 650, delay: i * 180, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    if (pieces[i] === foot) entrance.finished.then(() => {
      if (foot.isConnected) for (const button of buttons) button.disabled = false;
    }).catch(() => {});
  }
}

/** SUMMER BREAK - permanent training paid for with Legacy Points. */
export function showMenu(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'clean-upgrades', 'summer-training');
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('SUMMER BREAK', 'Train for next season · Improvements stay with you'));
  p.append(head, divider());

  const row = document.createElement('div');
  row.className = 'row';
  const bank = document.createElement('div');
  bank.className = 'bank';
  bank.innerHTML = `LEGACY POINTS: <b>${vm.legacy}</b>`;
  row.append(bank);
  // Balances are outside the upgrade panel, separate from the cards.

  const h2 = document.createElement('h2');
  h2.textContent = 'Summer Training';
  const upgrades = document.createElement('div');
  upgrades.className = 'upgrade-grid';
  for (const r of vm.rows) upgrades.appendChild(statRow(r));
  p.appendChild(upgrades);

  p.appendChild(divider());
  const foot = document.createElement('div');
  foot.className = 'foot';
  const start = document.createElement('button');
  start.className = 'accent big';
  start.textContent = 'Next Season';
  start.addEventListener('click', vm.onStart);
  foot.append(action('Main Menu', vm.onMenu), start);
  p.appendChild(foot);

  mount(p, row);
}

/** TRAINING ROOM - between-match Match Cash spending. */
export function showTraining(vm) {
  // Keep the actual meter when purchases rebuild the upgrade screen.
  const previousMeter = el.overlay.querySelector('.training-confidence');
  const confidence = previousMeter ? {
    root: previousMeter,
    fill: previousMeter.querySelector('.confidence-fill'),
    value: previousMeter.querySelector('.confidence-heading b'),
  } : confidenceMeter(vm.confidence, vm.confidenceMax, 'training-confidence');
  const p = panel();
  p.classList.add('upgrade-panel', 'training-panel', 'clean-upgrades');
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('MATCH UPGRADES', `FULL TIME: ${vm.homeClub} ${vm.matchGoals} : ${vm.enemyGoals} ${vm.opponent}`));
  p.append(head, divider());

  const summary = document.createElement('div');
  summary.className = 'row';
  const s2 = document.createElement('div');
  s2.className = 'bank';
  s2.innerHTML = `CASH: <b>$${vm.cash}</b>`;
  summary.append(s2);

  summary.append(confidence.root);

  const upgrades = document.createElement('div');
  upgrades.className = 'upgrade-grid';
  for (const r of vm.rows) upgrades.appendChild(statRow(r));
  p.appendChild(upgrades);

  p.appendChild(divider());

  // Media Charm is a progressively priced consumable, not a tiered stat.
  const charm = document.createElement('div');
  charm.className = 'statline charm-card';
  const chn = document.createElement('span');
  chn.className = 'nm';
  chn.textContent = '❤️ MEDIA CHARM';
  const chf = document.createElement('span');
  chf.className = 'fx';
  chf.textContent = `Restore +${vm.charmRestore}% confidence`;
  const chb = document.createElement('button');
  chb.textContent = `Restore · $${vm.charmCost}`;
  chb.disabled = !vm.charmAffordable;
  chb.addEventListener('click', vm.onCharm);
  chb.textContent = `$${vm.charmCost}`;
  chb.setAttribute('aria-label', `Restore ${vm.charmRestore}% confidence for $${vm.charmCost}`);
  const charmIcon = document.createElement('img');
  charmIcon.src = 'assets/ui/icons/charm.webp';
  charmIcon.alt = '';
  charmIcon.className = 'charm-icon';
  charm.append(charmIcon, upgradeDetails('MEDIA CHARM',
    `Restore +${vm.charmRestore}% trainer confidence. Each use costs $${vm.charmBaseCost} more.`), chb);
  p.appendChild(charm);

  const foot = document.createElement('div');
  foot.className = 'foot';
  const next = document.createElement('button');
  next.className = 'accent big';
  next.textContent = 'Next Match >';
  next.addEventListener('click', vm.onProceed);
  foot.append(action('Main Menu', vm.onMenu), next);
  p.append(divider(), foot);

  mount(p, summary);
  updateConfidenceMeter(confidence, vm.confidence, vm.confidenceMax);
}

export function showBenched() {
  const scene = document.createElement('div');
  scene.className = 'benched-presentation';
  scene.setAttribute('role', 'status');
  const manager = document.createElement('img');
  manager.src = 'assets/ui/hud/manager-angry.png';
  manager.alt = 'An angry manager pointing toward the bench';
  manager.className = 'benched-manager';
  const message = document.createElement('div');
  message.className = 'benched-message';
  const title = document.createElement('strong');
  title.textContent = 'You are benched!!';
  const reason = document.createElement('span');
  reason.textContent = 'FULL TIME · CONFIDENCE 0%';
  message.append(title, reason);
  scene.append(manager, message);
  el.overlay.replaceChildren(scene);
  el.overlay.classList.add('benched-overlay');
  el.overlay.classList.remove('hidden');
}

/** Season summary - goals fund permanent summer training. */
export function showGameOver(vm) {
  const p = panel();
  p.className = 'panel upgrade-panel compact-panel game-over-panel center';
  p.append(header(vm.won ? 'YOU BEAT THE GAME!' : 'SEASON OVER',
    vm.won ? `${vm.seasonMatches ?? vm.matches}-MATCH SEASON COMPLETED · STILL IN THE TEAM` : 'BENCHED FOR THE REST OF THE SEASON'), divider());

  const image = document.createElement('img');
  image.className = 'game-over-image';
  image.src = 'assets/ui/hud/game-over.png';
  image.alt = 'An exhausted striker sitting in front of the goal in the rain';

  const body = document.createElement('div');
  body.className = 'sub';
  body.innerHTML = `
    <p>This season you played <b>${vm.matches}</b> match${vm.matches === 1 ? '' : 'es'}
    and scored <b>${vm.goals}</b> goal${vm.goals === 1 ? '' : 's'}.</p>
    <p>${vm.goals} goals &times; ${vm.rate} = <b style="color:var(--accent)">${vm.earned} LEGACY POINTS</b></p>
    <p>${vm.won
      ? 'Another season: same player and summer upgrades; match upgrades reset. New career: choose a new player and reset all upgrades and LP.'
      : 'Next: summer-break training. Spend LP on improvements that last every season.'}</p>
    ${vm.isBest ? '<p><b style="color:var(--good)">PERSONAL BEST SEASON</b></p>' : ''}
  `;
  const content = document.createElement('div');
  content.className = 'game-over-content';
  if (vm.won) {
    const emblem = document.createElement('div');
    emblem.className = 'career-victory-emblem';
    emblem.setAttribute('aria-label', 'Champion');
    emblem.textContent = '★';
    content.append(emblem, body);
  } else content.append(image, body);
  p.append(content, divider());

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.style.justifyContent = 'center';
  if (vm.won) {
    foot.style.flexDirection = 'column';
    foot.append(action('Another Season', vm.onRepeatSeason, 'accent big'),
      action('New Career · New Player', vm.onNewCareer));
  } else {
    foot.append(action('Next >', vm.onNext, 'accent big'));
  }
  p.appendChild(foot);

  mount(p);
}

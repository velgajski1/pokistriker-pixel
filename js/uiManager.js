/**
 * uiManager.js - every DOM write in the game happens here.
 *
 * Screen transitions use one utility flag (.hidden). Upgrade tables are built
 * procedurally from the data model app.js hands over; this module owns no
 * game state of its own.
 */

const $ = (id) => document.getElementById(id);

const el = {
  dim: null, hud: null, left: null, right: null,
  ticker: null, powerWrap: null, powerBar: null, powerFill: null,
  prompt: null, verdict: null, overlay: null,
  identity: null,
};

let verdictTimer = 0;
const loadingStarted = performance.now();

export async function preloadMenuAssets(portraits) {
  await Promise.all(['assets/ui/bg/shooting-goal.webp', ...portraits].map(src => {
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
  el.powerWrap = $('powerwrap');
  el.powerBar = el.powerWrap.querySelector('.powerbar');
  el.powerFill = $('powerfill');
  el.prompt = $('phase-prompt');
  el.verdict = $('verdict');
  el.overlay = $('overlay');
  el.identity = document.createElement('div');
  el.identity.className = 'career-identity hidden';
  el.hud.append(el.identity);
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

export function showHud(on) { el.hud.classList.toggle('hidden', !on); }

export function setScore(match, clock, goals, mode = 'career') {
  el.left.textContent = mode === 'practice' ? 'TRAINING | UNLIMITED SHOTS'
    : `${mode === 'single' ? 'SINGLE MATCH' : `MATCH ${match}`} | CLOCK: ${clock}'`;
  el.right.textContent = `GOALS: ${goals}`;
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

export function showPower(on) { el.powerWrap.classList.toggle('hidden', !on); }

export function setPower(p) {
  el.powerFill.style.width = `${(p * 100).toFixed(1)}%`;
  el.powerBar.classList.toggle('hot', p > 0.9);   // over-hit territory
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
  el.overlay.classList.add('hidden');
  el.overlay.replaceChildren();
}

function panel() {
  const p = document.createElement('div');
  p.className = 'panel';
  return p;
}

function mount(node, status = null) {
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

export function setMatchExit(onMenu) {
  el.hud.appendChild(action('Main Menu', onMenu, 'match-exit'));
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
  if (vm.resume) {
    const resume = document.createElement('p');
    resume.className = 'career-resume';
    resume.textContent = `Continue ${vm.resume}`;
    p.append(resume);
  }
  mount(p);
}

export function showCharacterSelection(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'character-panel');
  const intro = document.createElement('p');
  intro.className = 'sub character-intro';
  intro.textContent = 'Eight hopefuls. One shirt. Who are you taking off the bench?';
  const grid = document.createElement('div');
  grid.className = 'character-grid';
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Choose your career striker');
  const selection = document.createElement('p');
  selection.className = 'character-selection';
  selection.setAttribute('aria-live', 'polite');
  const start = action('Start Career >', vm.onStart, 'accent big');
  const cards = [];
  const select = id => {
    const character = vm.characters.find(player => player.id === id);
    for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.character === id));
    selection.textContent = `${character.name} · ${character.tagline}`;
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
  const note = document.createElement('p');
  note.className = 'sub character-note';
  note.textContent = 'Your portrait and on-pitch appearance stay with you all career. Same starting stats. Your story to write.';
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Back', vm.onBack), start);
  p.append(header('CHOOSE YOUR STRIKER', 'YOUR CAREER STARTS HERE'), intro, grid, selection, note, foot);
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

export function showSingleResult(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'compact-panel', 'center');
  const score = document.createElement('p');
  score.className = 'result-score';
  score.textContent = `${vm.goals} ${vm.goals === 1 ? 'GOAL' : 'GOALS'}`;
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.append(action('Main Menu', vm.onMenu), action('Play Again', vm.onReplay, 'accent'));
  p.append(header('FULL TIME'), score, foot);
  mount(p);
}

/** MAIN MENU - lifetime Legacy Point spending. */
export function showMenu(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'clean-upgrades');
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('META UPGRADES'));
  p.append(head, divider());

  const row = document.createElement('div');
  row.className = 'row';
  const bank = document.createElement('div');
  bank.className = 'bank';
  bank.innerHTML = `LEGACY POINTS: <b>${vm.legacy}</b>`;
  row.append(bank);
  // Balances are outside the upgrade panel, separate from the cards.

  const h2 = document.createElement('h2');
  h2.textContent = 'Permanent Upgrades';
  const upgrades = document.createElement('div');
  upgrades.className = 'upgrade-grid';
  for (const r of vm.rows) upgrades.appendChild(statRow(r));
  p.appendChild(upgrades);

  p.appendChild(divider());
  const foot = document.createElement('div');
  foot.className = 'foot';
  const start = document.createElement('button');
  start.className = 'accent big';
  start.textContent = 'Play Match >';
  start.addEventListener('click', vm.onStart);
  foot.append(action('Main Menu', vm.onMenu), start);
  p.appendChild(foot);

  mount(p, row);
}

/** TRAINING ROOM - between-match Match Cash spending. */
export function showTraining(vm) {
  const p = panel();
  p.classList.add('upgrade-panel', 'training-panel', 'clean-upgrades');
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('MATCH UPGRADES'));
  p.append(head, divider());

  const summary = document.createElement('div');
  summary.className = 'row';
  const s2 = document.createElement('div');
  s2.className = 'bank';
  s2.innerHTML = `CASH: <b>$${vm.cash}</b>`;
  summary.append(s2);

  const conf = document.createElement('div');
  conf.className = `statline conf${vm.confidence < 30 ? ' low' : ''}`;
  const cn = document.createElement('span');
  cn.className = 'nm';
  cn.textContent = 'CONFIDENCE';
  const cp = document.createElement('span');
  cp.className = 'pips';
  cp.textContent = `${Math.round(vm.confidence)}%`;
  conf.append(cn, cp);
  summary.append(conf);

  const upgrades = document.createElement('div');
  upgrades.className = 'upgrade-grid';
  for (const r of vm.rows) upgrades.appendChild(statRow(r));
  p.appendChild(upgrades);

  p.appendChild(divider());

  // Media Charm is a flat-fee consumable, not a tiered stat.
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
  charm.append(charmIcon, upgradeDetails('MEDIA CHARM', `Restore +${vm.charmRestore}% manager confidence`), chb);
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
}

/** BENCHED - run over, goals convert to Legacy Points. */
export function showGameOver(vm) {
  const p = panel();
  p.className = 'panel upgrade-panel compact-panel center';
  p.append(header('CAREER OVER', 'MANAGER CONFIDENCE HIT ZERO'), divider());

  const body = document.createElement('div');
  body.className = 'sub';
  body.innerHTML = `
    You survived <b>${vm.matches}</b> match${vm.matches === 1 ? '' : 'es'}
    and scored <b>${vm.goals}</b> goal${vm.goals === 1 ? '' : 's'}.<br/>
    <br/>
    ${vm.goals} goals &times; ${vm.rate} = <b style="color:var(--accent)">${vm.earned} LEGACY POINTS</b><br/>
    ${vm.isBest ? '<br/><b style="color:var(--good)">NEW CAREER BEST</b>' : ''}
  `;
  p.append(body, divider());

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.style.justifyContent = 'center';
  const back = document.createElement('button');
  back.className = 'accent big';
  back.textContent = 'Back To Main Menu >';
  back.addEventListener('click', vm.onMenu);
  foot.append(action('Legacy Upgrades', vm.onUpgrades), back);
  p.appendChild(foot);

  mount(p);
}

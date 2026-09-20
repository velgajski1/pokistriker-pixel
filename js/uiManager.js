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
};

let verdictTimer = 0;

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
}

// ---------------------------------------------------------------------------
// Match presentation
// ---------------------------------------------------------------------------

/** SIMULATING dims the arena; HIGHLIGHT clears it instantly. */
export function setDimmed(on) { el.dim.classList.toggle('clear', !on); }

export function showHud(on) { el.hud.classList.toggle('hidden', !on); }

export function setScore(match, clock, goals, chances) {
  el.left.textContent = `MATCH ${match} | CLOCK: ${clock}'`;
  el.right.textContent = `GOALS: ${goals} | CHANCES LEFT: ${chances}`;
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

function mount(node) {
  el.overlay.replaceChildren(node);
  el.overlay.classList.remove('hidden');
}

function pips(level, max) {
  let out = '';
  for (let i = 0; i < max; i++) out += i < level ? '[■]' : '<i>[ ]</i>';
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
  wrap.className = 'statline';

  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = `${row.icon ? row.icon + ' ' : ''}${row.name}`;

  const pip = document.createElement('span');
  pip.className = 'pips';
  pip.innerHTML = pips(row.level, row.max);

  const fx = document.createElement('span');
  fx.className = 'fx';
  fx.textContent = `(${row.fx})`;

  const btn = document.createElement('button');
  if (row.cost === null) {
    btn.textContent = 'MAXED';
    btn.disabled = true;
  } else {
    btn.textContent = `Buy Lv ${row.level + 1} · ${row.currency}${row.cost}`;
    btn.disabled = !row.affordable;
    btn.addEventListener('click', row.onBuy);
  }

  wrap.append(nm, pip, fx, btn);
  return wrap;
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

/** MAIN MENU - lifetime Legacy Point spending. */
export function showMenu(vm) {
  const p = panel();
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('BENCHED', "A STRIKER'S ROGUELITE"));
  p.append(head, divider());

  const row = document.createElement('div');
  row.className = 'row';
  const bank = document.createElement('div');
  bank.className = 'bank';
  bank.innerHTML = `LEGACY POINTS: <b>${vm.legacy}</b>`;
  const rec = document.createElement('div');
  rec.className = 'bank';
  rec.innerHTML = `CAREERS: <b>${vm.runs}</b> &nbsp; BEST: <b>${vm.bestRun} matches</b> &nbsp; LIFETIME GOALS: <b>${vm.lifetimeGoals}</b>`;
  row.append(bank, rec);
  p.append(row, divider());

  const h2 = document.createElement('h2');
  h2.textContent = 'Permanent Upgrades';
  p.appendChild(h2);
  for (const r of vm.rows) p.appendChild(statRow(r));

  p.appendChild(divider());
  const foot = document.createElement('div');
  foot.className = 'foot';
  const wipe = document.createElement('button');
  wipe.textContent = 'Wipe Career';
  wipe.addEventListener('click', vm.onWipe);
  const start = document.createElement('button');
  start.className = 'accent big';
  start.textContent = 'Start Career >';
  start.addEventListener('click', vm.onStart);
  foot.append(wipe, start);
  p.appendChild(foot);

  mount(p);
}

/** TRAINING ROOM - between-match Match Cash spending. */
export function showTraining(vm) {
  const p = panel();
  const head = document.createElement('div');
  head.className = 'center';
  head.append(header('TRAINING ROOM', `AFTER MATCH ${vm.match}`));
  p.append(head, divider());

  const summary = document.createElement('div');
  summary.className = 'row';
  const s1 = document.createElement('div');
  s1.className = 'bank';
  s1.innerHTML = `MATCH ${vm.match} SUMMARY: <b>${vm.matchGoals}</b> Goals Scored`;
  const s2 = document.createElement('div');
  s2.className = 'bank';
  s2.innerHTML = `CURRENT BANK: <b>$${vm.cash}</b>`;
  summary.append(s1, s2);
  p.appendChild(summary);

  const conf = document.createElement('div');
  conf.className = `statline conf${vm.confidence < 30 ? ' low' : ''}`;
  const cn = document.createElement('span');
  cn.className = 'nm';
  cn.textContent = 'MANAGER CONFIDENCE';
  const cp = document.createElement('span');
  cp.className = 'pips';
  cp.textContent = `[${meter(vm.confidence, vm.confidenceMax)}] ${Math.round(vm.confidence)}%`;
  conf.append(cn, cp);
  p.append(conf, divider());

  for (const r of vm.rows) p.appendChild(statRow(r));

  p.appendChild(divider());

  // Media Charm is a flat-fee consumable, not a tiered stat.
  const charm = document.createElement('div');
  charm.className = 'statline';
  const chn = document.createElement('span');
  chn.className = 'nm';
  chn.textContent = '❤️ MEDIA CHARM';
  const chf = document.createElement('span');
  chf.className = 'fx';
  chf.textContent = `[ Restore +${vm.charmRestore}% Manager Confidence ]`;
  const chb = document.createElement('button');
  chb.textContent = `Flat Fee · $${vm.charmCost}`;
  chb.disabled = !vm.charmAffordable;
  chb.addEventListener('click', vm.onCharm);
  charm.append(chn, chf, chb);
  p.appendChild(charm);

  const foot = document.createElement('div');
  foot.className = 'foot';
  const next = document.createElement('button');
  next.className = 'accent big';
  next.textContent = 'Proceed To Next Match >';
  next.addEventListener('click', vm.onProceed);
  foot.appendChild(next);
  p.append(divider(), foot);

  mount(p);
}

/** BENCHED - run over, goals convert to Legacy Points. */
export function showGameOver(vm) {
  const p = panel();
  p.className = 'panel center';
  p.append(header('BENCHED', 'MANAGER CONFIDENCE HIT ZERO'), divider());

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
  foot.appendChild(back);
  p.appendChild(foot);

  mount(p);
}

/**
 * app.js - bootstrapper and the arcade state machine.
 *
 * BLOCK STRIKER is one endless arcade run: a shooting chance, a target on the
 * goal, one shot. Precision scores (bullseye, target, plain goal) and builds a
 * combo; anything that is not a goal costs a heart. Every few goals the level
 * rises and the keeper and defence, useless at first, get sharper.
 *
 * This module owns ALL game data. The Three.js context in gameEngine.js is a
 * renderer, never a data store: it is told where meshes go and nothing else.
 */
import * as engine from './gameEngine.js';
import * as ui from './uiManager.js';
import * as save from './saveSystem.js';
import * as audio from './audio.js';
import * as poki from './poki.js';
import * as progress from './progress.js';
import {
  GOAL, PITCH, GROUND_Y, BALL_R, PHYS_DT, GRAVITY, hit,
  launchVector, stepBall, crossedGoalPlane, planeIntersection,
  classifyAtPlane, hitWoodwork, sweptCapsuleHit, reflect, predictCrossing,
  aimAngleFor, netContact, hitAdvertisingBoards, closestPointOnSegment, GROUND_Y as TURF,
  predictFromVelocity, velocityTo, BASE_VELOCITY,
} from './physics.js';

// ===========================================================================
// Arcade rules
// ===========================================================================
export const ARCADE = {
  HEARTS: 3,                 // hearts at the start of a run
  MAX_HEARTS: 5,             // extra lives can take you this far
  GOALS_PER_LEVEL: 3,
  EARLY_GOALS: 2,
  EARLY_LEVELS: 3,
  POINTS: { bullseye: 300, target: 200, goal: 100 },
  MAX_COMBO: 5,              // consecutive target hits multiply the points
  HEART_ODDS: .2,            // chance a target carries an extra life (never twice running)
  RAMP_LEVELS: 32,           // a gradual climb in keeper skill, range and timing difficulty
  SOFTEN_AFTER: 5,
  LATE_LEVEL_SCALE: .5,      // each level past 5 adds half a level of difficulty
  // The keeper is good from the first shot and better later (this share of the
  // elite profile, level 1 -> late), and dives at everything - but a shot that
  // crosses inside the target always beats him (see keeperBeaten).
  KEEPER_FLOOR: .55,
  KEEPER_CAP: .9,
  BEATEN_MARGIN: .4,         // ...and so does one just outside the ring: "through his fingers"
  KEEPER_MISS: .9,           // on-target shots: his dive aims this far short of the ball, metres
                             // (keepClearOf then keeps every limb clear of it)
  // Now and then, from the very first level, the keeper plays well above his
  // level for one chance: at least this skill. Early runs get real saves and
  // full-stretch dives instead of a keeper who never moves.
  KEEPER_MOMENT: { odds: 0, skill: .35 },   // off: the keeper is always good now
};

export const goalsForLevel = level => level <= ARCADE.EARLY_LEVELS ? ARCADE.EARLY_GOALS : ARCADE.GOALS_PER_LEVEL;
export const ADAPTIVE = { SHOTS: 2, KEEPER_SCALE: .65, SPEED: .85, COMBO_STEP: .025, COMBO_MAX: .1 };
export const timingFactor = (combo = 0, assisted = false) => assisted ? ADAPTIVE.SPEED
  : 1 + Math.min(ADAPTIVE.COMBO_MAX, Math.max(0, combo - 1) * ADAPTIVE.COMBO_STEP);

/**
 * Special chances. Golden balls, moving targets and free kicks turn up at
 * random from their first level (never two specials running); a boss keeper
 * opens level 4, then every fifth level from 10; every fourth level from 8
 * opens with a three-shot bonus round where misses are free.
 */
const SPECIALS = {
  golden: { from: 2, odds: .12, points: 2, label: 'GOLDEN BALL', note: 'DOUBLE POINTS', ring: 0xfff27a, bull: 0xffb000 },
  moving: { from: 3, odds: .1, points: 1.5, label: 'MOVING TARGET', note: 'x1.5 POINTS', ring: 0x54e0ff, bull: 0x2f8bff },
  freekick: { from: 5, odds: .1, points: 2, label: 'FREE KICK', note: 'CHIP THE WALL', ring: 0xffd23f, bull: 0xff4d3a },
  boss: { every: 5, points: 3, label: 'BOSS KEEPER', note: 'BEAT HIM: x3 AND A HEART', ring: 0xc07cff, bull: 0x8b3dff },
  bonus: { every: 4, shots: 3, points: 2, label: 'BONUS ROUND', note: 'NO KEEPER. MISSES ARE FREE', ring: 0x8dff5a, bull: 0x31c75a },
};
const GOLDEN_BALL = 0xffd23f;
/** The HUD tag for a keeper's moment (a normal chance with a sharp keeper). */
const HOT_KEEPER = { label: 'HOT KEEPER', note: 'HE IS ON FIRE THIS TIME' };
/**
 * The first run of a session shows what the game has in its first few shots
 * (players who see one repeated shot leave): a plain chance, a golden ball, a
 * plain one and a moving target. After that, the usual odds. No wall early:
 * the first levels are striker against keeper.
 */
const OPENING = [null, 'golden', null, 'moving'];
let sessionRuns = 0;
const BOSS_SKILL = 0;              // a boss keeper plays this much above the level's keeper (a showpiece, not a wall)
const MOVING_TARGET = { speed: 1.25, minTravel: .6 };   // radians/s; metres of room needed
const WALL = { range: [17, 22], lateral: 5, jump: 3.3, delay: [.08, .2] };

/** Seconds the result holds before the next chance (a tap skips it). */
const HOLD = { GOAL: 2.6, MISS: 1, REACTION_MAX: 2.4, CELEBRATION_MAX: 4.2 };

/** Where the target sits and how big it is: it shrinks as the level rises. */
const TARGET = {
  RING_HALF: [.7, .45],      // half-width at level 1 -> fully ramped
  BULL_HALF: [.34, .2],
  MARGIN_X: .55, MIN_Y: .5, // keep the whole ring inside the goal mouth
  KEEPER_CLEAR: 1.05,        // the ring's edge stays this far from the keeper's centre: an
                             // on-target ball never passes within a standing keeper's reach, metres
  BULL_CLEAR: 1.7,           // ...and the bullseye centre at least this far: out of his reach
  LENIENCY: .12,             // scoring counts a ball this far outside a painted ring as inside it
};

const SHOT = {
  BASE_SWEEP: 12.0,         // metres/sec ACROSS the goal plane when fully ramped
  EASY_SWEEP: 1.14,         // ...and this fraction of it at level 1
  HARD_SWEEP: 2,            // ...rising towards this multiple late in a run
  BOUNCE_BOOST: .05,        // the arrow and the meter speed up this much at every turn...
  MAX_BOOST: .2,            // ...with a modest cap so waiting remains manageable
  AIM_SPAN: 5.2,            // the arrow sweeps this far past the goal centre
  POWER_CYCLE: [1.4, 2.2],  // power oscillations per second: level 1 -> late in a run
  // The height meter is the height on the goal line, bottom to top, at any
  // distance: the top quarter goes over the bar, so a late press misses high.
  METER_HEIGHT: [.05, 3.3],
  WINDUP: 0.28,                   // strike animation before the ball leaves
  KEEPER_ANGLE_NARROW: 0.25,      // how far he shades toward the shooter
  KEEPER_LEAP: 2.8,               // upward launch of a dive, m/s
  KEEPER_LEAP_HIGH: 2.4,          // ...plus this much again for a high one
  KEEPER_COMMIT_TIME: .24,       // extend only shortly before the ball arrives
  RECOVER_DELAY: 0.30,            // beat on the ground before picking himself up
  RECOVER_RATE: 1.7,              // how fast the dive/lunge unwinds afterwards
  KEEPER_STAND_ZONE: 0.70,        // inside this he stays on his feet and blocks
  KEEPER_MAX_DIVE: 1.75,          // a dive displaces the body this far, at most
  SAVE_RESTITUTION: 0.42,
  DEFLECT_SCATTER: 0.14,     // bodies are not mirrors
  BLOCK_REACTION: 0.13,
  BLOCK_SPEED: 7.0,
  BLOCK_MAX_LUNGE: 1.0,
  BLOCK_LUNGE_TIME: 0.22,
  BLOCK_READ_ERROR: 1.8,
};

/**
 * Keeper profiles at the two ends of the ramp. Level 1 is a keeper who
 * barely reacts; the elite end is the original game's best keeper.
 */
const KEEPER_ROOKIE = { reaction: .3, diveSpeed: 2.6, setSpeed: 1.2, readError: 1.1, heightError: .6,
  setSpread: .6, diveTime: .45, catchSpeed: 5, parryBias: .2 };
const KEEPER_ELITE = { reaction: .065, diveSpeed: 10, setSpeed: 5.5, readError: .06, heightError: .045,
  setSpread: .10, diveTime: .18, catchSpeed: 18, parryBias: .82 };

export const difficultyLevel = level => Math.min(level, ARCADE.SOFTEN_AFTER)
  + Math.max(0, level - ARCADE.SOFTEN_AFTER) * ARCADE.LATE_LEVEL_SCALE;

/** 0 at level 1; slower growth after level 5, without a difficulty jump. */
export const levelRamp = level => 1 - Math.exp(-Math.max(0, difficultyLevel(level) - 1) / ARCADE.RAMP_LEVELS);

/** Keeper ability for a level; distance adds a little on top for long shots. */
/** The same keeper, `bonus` skill sharper (a weak shot gives him time to read it). */
function sharpenKeeper(ability, bonus) {
  const skill = Math.min(1, ability.skill + bonus), sharper = { ...ability, skill };
  for (const key of Object.keys(KEEPER_ROOKIE)) {
    sharper[key] = KEEPER_ROOKIE[key] + (KEEPER_ELITE[key] - KEEPER_ROOKIE[key]) * skill;
  }
  return sharper;
}

export function keeperAbility(level, distance = 10, special = null, moment = false, assisted = false) {
  const ramp = ARCADE.KEEPER_FLOOR + (ARCADE.KEEPER_CAP - ARCADE.KEEPER_FLOOR) * levelRamp(level);
  let skill = Math.min(ARCADE.KEEPER_CAP, ramp + Math.max(0, distance - 12) * .01 * ramp);
  if (moment) skill = Math.max(skill, ARCADE.KEEPER_MOMENT.skill);
  if (special === 'boss') skill = Math.min(1, skill + BOSS_SKILL);
  if (assisted) skill *= ADAPTIVE.KEEPER_SCALE;
  const ability = { skill, level };
  for (const key of Object.keys(KEEPER_ROOKIE)) {
    ability[key] = KEEPER_ROOKIE[key] + (KEEPER_ELITE[key] - KEEPER_ROOKIE[key]) * skill;
  }
  // Bonus round: he stands aside by the post and never moves.
  if (special === 'bonus') { ability.skill = 0; ability.reaction = 99; ability.setSpread = 0; }
  return ability;
}

/** Defenders: none early on, then one, then two; slow at first, sharper later. */
export function defenceFor(level, range, random = Math.random) {
  // The first levels are striker against keeper: no defenders until level 5.
  const difficulty = difficultyLevel(level);
  const strength = Math.max(0, Math.min(1, (difficulty - 5) / 6));
  let blockers = 0;
  // Gradual exposure: 40% at level 5, 55% at 7, guaranteed only at 13.
  if (level >= 5) blockers = random() < Math.min(1, .4 + (difficulty - 5) * .15) ? 1 : 0;
  // A second defender arrives much later, with odds that also build gradually.
  if (difficulty >= 11 && range > 13 && random() < Math.min(.55, (difficulty - 10) * .1)) blockers = 2;
  return { blockers, strength };
}

/** Chance spots move further out and wider as the level rises. */
export function chooseChanceOrigin(target, level = 1, random = Math.random) {
  const ramp = levelRamp(level);
  // Close and central at first; late in a run, long shots from 18-32 m.
  const minRange = 9 + 9 * ramp, maxRange = 13 + 19 * ramp;
  const range = minRange + random() * (maxRange - minRange);
  const lateral = Math.min(4 + 8 * ramp, range * .85);
  target.x = (random() * 2 - 1) * lateral;
  target.y = GROUND_Y;
  target.z = GOAL.PLANE_Z + range;
}


/** How a goal went in, keyed by the last thing that touched the ball. */
const GOAL_CALLS = {
  clean: '', post: 'IN OFF THE POST!', bar: 'OFF THE BAR AND IN!',
  keeper: 'THROUGH THE KEEPER!', defender: 'DEFLECTED IN!',
};

// A new kit for every level, so a level-up reads at a glance.
export const OPPONENT_COLORS = [
  { name: 'Crimson', pattern: 'solid', kit: 0xc92f43, shorts: 0x20232b, socks: 0xc92f43, accent: 0xf4e8d2,
    keeper: { kit: 0xf2af32, shorts: 0x252b33, socks: 0xf2af32 } },
  { name: 'Ivory', pattern: 'stripes', kit: 0xeee9db, shorts: 0x37333a, socks: 0xeee9db, accent: 0xb62e42,
    keeper: { kit: 0xef8235, shorts: 0x27222d, socks: 0xef8235 } },
  { name: 'Gold', pattern: 'stripes', kit: 0xf2c344, shorts: 0x28272b, socks: 0xf2c344, accent: 0x28272b,
    keeper: { kit: 0xd35b9d, shorts: 0x302439, socks: 0xd35b9d } },
  { name: 'Forest', pattern: 'hoops', kit: 0x268153, shorts: 0xece9db, socks: 0x268153, accent: 0xece9db,
    keeper: { kit: 0xf28a36, shorts: 0x2a2630, socks: 0xf28a36 } },
  { name: 'Plum', pattern: 'solid', kit: 0x963966, shorts: 0xe8e3db, socks: 0x963966, accent: 0xe8e3db,
    keeper: { kit: 0xd8da4c, shorts: 0x292c32, socks: 0xd8da4c } },
  { name: 'Redcastle', pattern: 'checks', kit: 0xc53039, shorts: 0xf2eee3, socks: 0xc53039, accent: 0xf2eee3,
    keeper: { kit: 0x28ac9a, shorts: 0x163832, socks: 0x28ac9a } },
  { name: 'Stone', pattern: 'stripes', kit: 0xe8e6df, shorts: 0x20242c, socks: 0xe8e6df, accent: 0x20242c,
    keeper: { kit: 0xe88e30, shorts: 0x302638, socks: 0xe88e30 } },
  { name: 'Crown', pattern: 'checks', kit: 0x672b87, shorts: 0x292036, socks: 0x672b87, accent: 0xe2b94b,
    keeper: { kit: 0x55ad78, shorts: 0x1c3428, socks: 0x55ad78 } },
  { name: 'Silver', pattern: 'hoops', kit: 0xd7e2e6, shorts: 0x194b50, socks: 0xd7e2e6, accent: 0x194b50,
    keeper: { kit: 0xcf497b, shorts: 0x332338, socks: 0xcf497b } },
  { name: 'Summit', pattern: 'stripes', kit: 0x222329, shorts: 0x222329, socks: 0xe5be58, accent: 0xe5be58,
    keeper: { kit: 0xece5d7, shorts: 0x303639, socks: 0xece5d7 } },
];

// ---- Application state ----------------------------------------------------
const state = {
  screen: 'MATCH',     // SELECT | MATCH | GAMEOVER
  phase: 'IDLE',       // IDLE | AIM | POWER | WINDUP | FLIGHT
  paused: false,
  run: null,
  best: save.loadBest(),
  elapsed: 0,
};
let ready = false;

// ---- Per-frame scratch. Nothing here is reallocated inside the loop. ------
const ballPos = { x: 0, y: 0, z: 0 };
const ballVel = { x: 0, y: 0, z: 0 };
const prevPos = { x: 0, y: 0, z: 0 };
const hitPoint = { x: 0, y: 0, z: 0 };
const contactPoint = { x: 0, y: 0, z: 0 };
const prediction = { x: 0, y: 0, t: 0 };
const keeperAim = { x: 0, y: 0, z: 0 };
const origin = { x: 0, y: GROUND_Y, z: 0 };
const aimTarget = { x: 0, y: 1.2, ring: TARGET.RING_HALF[0], bull: TARGET.BULL_HALF[0], heart: false,
  minX: 0, maxX: 0, phase: 0 };

/** Live defender state, one entry per blocker planted on the shot line. */
const blockers = [
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false,
    airY: 0, vy: 0, jumped: false },
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false,
    airY: 0, vy: 0, jumped: false },
];
let blockerCount = 0;
let balanceSimulation = false;

const shot = {
  tutorial: false, tutorialTime: 0,
  noTarget: false,           // pull mode's level 1: no target on the goal
  easy: false,               // one of a session's first (coached) pull shots: the keeper cannot reach it
  assisted: false, timingFactor: 1,
  defenseStrength: 0,
  snap: false,               // pull shot released at the top of the elastic's stretch
  weakShot: false,           // pull shot too soft: the keeper can save it even on target
  maxDive: 1.75,             // this shot's dive reach (SHOT.KEEPER_MAX_DIVE, longer against a weak shot)
  keeperBeaten: false,       // the shot crosses inside the target: the keeper's dive cannot reach it
  sweepBoost: 1, powerBoost: 1,   // timing mode: speed-ups earned by waiting (see SHOT.BOUNCE_BOOST)
  preset: false,             // a shot mode set the launch velocity (flick, free aim)
  curve: 0,                  // sideways acceleration from spin, m/s^2 (flick)
  keeperMoment: false,       // the keeper is playing above his level this chance
  wall: false,               // a free kick: the defenders stand as a jumping wall
  keeperAbility: keeperAbility(1),
  theta: 0, sweepDir: 1, power: 0, powerDir: 1,
  keeperSetX: 0, keeperX: 0, keeperTarget: 0, keeperDive: 0, keeperDepth: .75,
  keeperDelay: 0, keeperSide: 1, diveDepth: 1, keeperHigh: 0,
  aimX: 0, thetaCentre: 0,
  swing: 0, windup: 0, resolved: null, holdTimer: 0, flightTime: 0, acc: 0,
  touched: null, contactCool: 0, restTimer: 0, entered: false, follow: 0, bounced: false,
  reboundStart: -1, awayTimer: 0,
  clearer: null, clearanceTime: 0, clearanceCooldown: 0,
  keeperAirY: 0, keeperAirV: 0, keeperDown: 0, keeperLaunched: false,
  keeperGround: 0, keeperSpent: false,
  keeperReadX: 0, keeperReadY: 0, keeperJumpAt: 0,
  crossX: 0, crossY: 0, precision: null, points: 0,
};

/** The aim arrow and the height meter both speed up as the level rises. */
export const aimSpeedFactor = level => SHOT.EASY_SWEEP + (SHOT.HARD_SWEEP - SHOT.EASY_SWEEP) * levelRamp(level);
export const powerCycle = level => SHOT.POWER_CYCLE[0] + (SHOT.POWER_CYCLE[1] - SHOT.POWER_CYCLE[0]) * levelRamp(level);
/** The aim arrow's speed across the goal line, m/s, before its bounce bonus. */
export const sweepSpeedAt = level => SHOT.BASE_SWEEP * aimSpeedFactor(level);
export const BOUNCE = { STEP: SHOT.BOUNCE_BOOST, MAX: SHOT.MAX_BOOST };
const sweepSpeed = () => sweepSpeedAt(state.run.level) * shot.sweepBoost * shot.timingFactor;
const SPEED_SCALE = 1;

// ===========================================================================
// Run lifecycle
// ===========================================================================
function setGameplayActive(active) {
  engine.setGameplayActive(active);
  ui.setGameplayActive(active);
  audio.setScene(active ? 'match' : 'menu');
  if (!active) {
    audio.setFocus(false);
    audio.setPower(null);
  }
}

/**
 * A fresh run. Boot starts one straight away: no menus before the first shot.
 * `mode` is 'arcade', 'checkpoint' (start at `level`) or 'daily' (the day's
 * ten seeded chances, no hearts to lose).
 */
function startRun(mode = 'arcade', level = 1) {
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  const daily = mode === 'daily';
  const boosted = !daily && progress.hasBoost();
  if (boosted) progress.setBoost(false);
  state.run = {
    mode, daily, startLevel: level,
    random: daily ? progress.seededRandom('blockstriker-daily-' + progress.today()) : Math.random,
    score: 0, hearts: ARCADE.HEARTS + (boosted ? 1 : 0), level, goals: 0, levelGoals: 0,
    combo: 0, bestCombo: 0, shots: 0, targetHits: 0, bullseyes: 0,
    lastCelebration: undefined, kit: -1, heartOffered: false, extraLives: 0, continued: false,
    special: null, lastSpecial: null, bonusLeft: 0, bossPending: !daily && level === 4, paidScore: 0, missionsDone: [],
    opening: mode !== 'daily' && ++sessionRuns === 1 && level === 1, scriptedMoment: false,
    assistShots: 0, introPending: null, freeMiss: false, recoveryHeart: false,
    tally: progress.newTally(),
    // The pull tutorial: its own phase before level 1, played once per player
    // (?tutorial=1 replays it). Its shots never cost a heart or count toward a level.
    tutorial: shotMode === 'pull' && mode !== 'daily' && level === 1
      && (!progress.tutorialDone() || FORCE_TUTORIAL), tutorialShots: 0,
  };
  applyLevelLook();
  state.screen = 'MATCH';
  state.paused = false;
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  setGameplayActive(true);
  audio.play('kickoff');
  if (daily) progress.markDailyStarted(state.run);
  poki.measure('run', mode, 'start');
  poki.measure('level', String(level), 'start');
  if (daily) ui.showLevelUp('DAILY CHALLENGE', `${progress.DAILY_SHOTS} SHOTS. EVERY SHOT COUNTS`);
  else if (boosted) ui.showLevelUp('BOOST!', 'YOU START WITH AN EXTRA HEART');
  else if (mode === 'checkpoint') ui.showLevelUp(`LEVEL ${level}`, `${progress.rankFor(level).name} START`);
  pushHud();
  beginChance();
  engine.startCameraIntro();
}

/** Mute and freeze input for an ad; restore afterwards. */
const adPause = () => audio.setMuted(true);
const adResume = () => audio.setMuted(false);

/**
 * Ad breaks come before every third new run, not every one (the first run of
 * a session never has one); Poki may still skip a break it is asked for.
 * Resuming from pause keeps its own break.
 */
let runsPerBreak = 3, runsSinceBreak = 0;
async function runBreak() {
  if (++runsSinceBreak < runsPerBreak) return;
  runsSinceBreak = 0;
  await poki.commercialBreak(adPause, adResume);
}

/** Back into play from a menu: an ad may run first, then the new run. */
async function startFromMenu(mode, level = 1) {
  if (poki.isInBreak()) return;   // Enter on the still-focused button during the ad
  await runBreak();
  startRun(mode, level);
  poki.gameplayStart();
  pauseIfHidden();
}

/** PLAY AGAIN (Space or Enter on the game-over screen too). */
const replay = () => startFromMenu('arcade');
function playCheckpoint() {
  if (poki.isInBreak()) return;
  const level = progress.checkpoint();
  poki.measure('button', 'checkpoint', 'interact');
  startFromMenu(level ? 'checkpoint' : 'arcade', level || 1);
}
function playDaily() {
  if (poki.isInBreak()) return;
  poki.measure('button', 'daily', 'interact');
  startFromMenu('daily');
}

/** Rewarded continue: one extra heart, once per run, only if the ad completed. */
async function continueRun() {
  const run = state.run;
  if (run.continued || poki.isInBreak()) return;
  poki.measure('button', 'reward-continue', 'interact');
  const success = await poki.rewardedBreak(adPause, adResume);
  if (!success) { ui.dropContinue(); return; }
  run.continued = true;
  run.hearts = 1;
  state.screen = 'MATCH';
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  setGameplayActive(true);
  audio.play('extraLife');
  pushHud();
  beginChance();
  poki.gameplayStart();
  pauseIfHidden();
}

/** Rewarded boost: the next run starts with an extra heart. No play resumes here. */
async function boostNextRun() {
  if (poki.isInBreak() || progress.hasBoost()) return;
  poki.measure('button', 'reward-boost', 'interact');
  const success = await poki.rewardedBreak(adPause, adResume);
  if (success) {
    progress.setBoost(true);
    audio.play('extraLife');
  }
  showResults();
}

/**
 * Choose your striker, from the results screen: PLAY starts a new run (an ad
 * may run first) and BACK returns. Boot never shows it: play comes first.
 * ('play' mode, over the live chance, is the Alt+1 preview.) The pick is saved
 * and shows on the pitch at once.
 */
let selectPlay = null;
function openStrikerSelect(from) {
  if (poki.isInBreak()) return;
  state.screen = 'SELECT';
  if (from === 'play') {
    ui.showHud(false);
    ui.setDimmed(true);
    setGameplayActive(false);
  }
  poki.measure('button', 'striker', 'visible');
  selectPlay = () => {
    if (state.screen !== 'SELECT' || poki.isInBreak()) return;
    progress.markSeen('strikers');
    poki.measure('striker', progress.striker(), 'pick');
    if (from !== 'play') { startFromMenu('arcade'); return; }
    state.screen = 'MATCH';
    ui.hideOverlay();
    ui.showHud(true);
    ui.setDimmed(false);
    setGameplayActive(true);
  };
  ui.showStrikerSelect({
    strikers: progress.strikerItems().map(item => ({ id: item.key, name: item.name, style: item.style,
      unlocked: item.unlocked, xp: item.xp, isNew: item.isNew,
      sprite: engine.strikerSprite(item.key, progress.kit(), progress.bootsColor()) })),
    selected: progress.striker(),
    onPick: id => { if (progress.setStriker(id)) engine.setStrikerLook(id); },
    onPlay: () => selectPlay(),
    onBack: from === 'play' ? null : () => { progress.markSeen('strikers'); state.screen = 'GAMEOVER'; showResults(); },
  });
}

/** The locker: equip what the XP bar has unlocked, one tab at a time. Back returns to the results. */
function openLocker(tab = null) {
  if (poki.isInBreak()) return;
  const items = progress.lockerItems();
  if (!tab) {
    poki.measure('button', 'locker', 'interact');
    tab = items.find(item => item.isNew)?.type || progress.LOCKER_TABS[0][0];
  }
  ui.showLocker({ items, tab, tabs: progress.LOCKER_TABS, onTab: openLocker, xp: progress.xp(), next: progress.nextUnlock(),
    collection: progress.collection(), game: progress.gameProgress(),
    onEquip: id => {
      if (!progress.equip(id)) return;
      applyCosmetics();
      openLocker(id.split(':')[0]);
    },
    onBack: () => { progress.markSeen(); showResults(); } });
}

/** The equipped kit, boots and ball; a golden ball overrides the tint for its chance. */
function applyCosmetics() {
  engine.setHomeKit(progress.kit(), progress.bootsColor());
  engine.setBallTint(state.run?.special === 'golden' ? GOLDEN_BALL : progress.ballColor());
}

/**
 * Clicking an ad usually opens a new tab. The tab-hidden pause is ignored
 * during the break, so check again once play would resume.
 */
function pauseIfHidden() {
  if (document.hidden) pause();
}

/** Esc / P / the pause button, and a hidden tab: stop play and show the pause panel. */
function pause() {
  if (state.screen !== 'MATCH' || state.paused || poki.isInBreak()) return;
  state.paused = true;
  poki.gameplayStop();
  audio.setPaused(true);
  engine.setAnimationsPaused(true);
  ui.setDimmed(true);
  showPausePanel();
  setGameplayActive(false);
}

function showPausePanel() {
  ui.showPause({ onResume: resume, onRestart: restart, missions: progress.missions(state.run) });
}

async function resume() {
  if (!state.paused || poki.isInBreak()) return;
  ui.hideOverlay();
  await poki.commercialBreak(adPause, adResume);
  // Still hidden after the ad (it opened a tab): stay paused.
  if (document.hidden) { showPausePanel(); return; }
  state.paused = false;
  audio.setPaused(false);
  ui.setDimmed(false);
  setGameplayActive(true);
  poki.gameplayStart();
}

async function restart() {
  if (poki.isInBreak()) return;
  ui.hideOverlay();
  audio.setPaused(false);
  await runBreak();
  startRun(state.run.mode, state.run.startLevel);
  poki.gameplayStart();
  pauseIfHidden();
}

/** Every level brings a new opponent kit and pitch (seeded in the daily challenge). */
function applyLevelLook() {
  const run = state.run;
  let kit = Math.floor(run.random() * (OPPONENT_COLORS.length - (run.kit < 0 ? 0 : 1)));
  if (run.kit >= 0 && kit >= run.kit) kit++;
  run.kit = kit;
  engine.setMatchColors(OPPONENT_COLORS[kit], Math.floor(run.random() * 0xffffffff));
  engine.setPitchSurface((run.level - 1) % engine.PITCH_SURFACES.length);
}

function pushHud() {
  const run = state.run;
  // Music builds with the run: level does most of it, a hot combo adds the rest.
  audio.setIntensity(levelRamp(run.level) * 1.4 + run.combo * .06);
  audio.setLevel(run.level);   // a new song every few levels
  const special = run.special ? SPECIALS[run.special]
    : shot.keeperMoment && state.phase !== 'IDLE' ? HOT_KEEPER : null;
  ui.setArcadeHud({ score: run.score, hearts: run.hearts, maxHearts: Math.max(ARCADE.HEARTS, run.hearts), level: run.level,
    combo: run.combo, levelProgress: run.levelGoals / goalsForLevel(run.level), levelSteps: goalsForLevel(run.level),
    best: state.best, rank: progress.rankFor(run.level).name, progress: progress.gameProgress().percent,
    daily: run.daily ? { shot: Math.min(run.shots + 1, progress.DAILY_SHOTS), of: progress.DAILY_SHOTS } : null,
    tutorial: run.tutorial ? { shot: Math.min(run.tutorialShots + 1, COACH_SHOTS), of: COACH_SHOTS } : null,
    special: special && { label: run.special === 'bonus'
      ? `${special.label} ${special.shots - run.bonusLeft}/${special.shots}` : special.label,
      note: run.freeMiss ? `${special.note} · FREE MISS` : special.note, kind: run.special || 'keeper' } });
}

/** Results of the last finished run, kept so the locker can return to them. */
let results = null;

function gameOver() {
  const run = state.run;
  const isBest = !run.daily && run.score > state.best;
  if (isBest) { state.best = run.score; save.saveBest(state.best); }
  state.screen = 'GAMEOVER';
  state.phase = 'IDLE';
  poki.gameplayStop();
  endSpecial();
  engine.showTarget(false);
  engine.showAimRig(false, false);
  engine.frameAmbient();
  ui.showHud(false);
  ui.setDimmed(true);
  setGameplayActive(false);
  const outcome = progress.finishRun(run);
  poki.measure('level', String(run.level), run.daily ? 'complete' : 'fail');
  poki.measure('run', run.mode, 'complete');
  for (const mission of outcome.missions) poki.measure('mission', mission.id, 'complete');
  for (const item of outcome.unlocked) poki.measure('unlock', item.id, 'complete');
  audio.play((isBest && run.score > 0) || outcome.daily?.newBest ? 'newBest' : 'gameOver');
  results = { run, isBest, outcome };
  showResults();
}

/** The game-over (or daily results) panel, rebuilt from the kept results. */
function showResults() {
  if (!results) return;
  const { run, isBest, outcome } = results;
  const continueOffer = !run.daily && !run.continued && poki.rewardsAvailable();
  const boostOffer = !continueOffer && poki.rewardsAvailable() && !progress.hasBoost();
  const checkpoint = progress.checkpoint();
  if (continueOffer) poki.measure('button', 'reward-continue', 'visible');
  if (boostOffer) poki.measure('button', 'reward-boost', 'visible');
  ui.showGameOver({ score: run.score, best: state.best, isBest, level: run.level, goals: run.goals,
    bullseyes: run.bullseyes, bestCombo: run.bestCombo,
    precision: run.shots ? Math.round(100 * run.targetHits / run.shots) : 0,
    rank: progress.rankFor(run.level).name,
    toBest: !run.daily && !isBest ? state.best - run.score : 0,
    daily: run.daily ? outcome.daily : null,
    xpGained: outcome.gained, unlocked: outcome.unlocked, next: progress.nextUnlock(),
    rewards: outcome.unlocked.map(item => {
      const info = progress.unlockInfo(item.id);
      if (info.type === 'striker') info.sprite = engine.strikerSprite(info.key, progress.kit(), progress.bootsColor());
      info.inUse = info.type === 'striker' ? progress.striker() === info.key
        : info.type !== 'celebration' && progress.equipped()[info.type] === info.key;
      return info;
    }),
    onUseUnlock: id => {
      const [type, key] = id.split(':');
      if (type === 'striker') { if (progress.setStriker(key)) engine.setStrikerLook(key); }
      else if (!progress.equip(id)) return;
      applyCosmetics();
      audio.play('confirm');
      showResults();
    },
    missions: progress.missions(null), finished: [...run.missionsDone, ...outcome.missions],
    boosted: progress.hasBoost(), lockerNew: progress.hasNewItems(), collection: progress.collection(),
    game: progress.gameProgress(),
    dailyStatus: progress.dailyStatus(),
    onReplay: replay, onContinue: continueOffer ? continueRun : null, onBoost: boostOffer ? boostNextRun : null,
    onCheckpoint: checkpoint ? playCheckpoint : null, checkpoint,
    onDaily: playDaily, onLocker: () => openLocker(), onStriker: () => openStrikerSelect('results') });
}

// ===========================================================================
// A chance
// ===========================================================================
function prepareChance() {
  const run = state.run;
  if (run.daily && run.level !== 1 + run.shots) {
    // The daily challenge climbs a level with every shot, goal or not.
    run.level = 1 + run.shots;
    applyLevelLook();
  }
  run.special = planSpecial(run);
  const random = run.random;
  shot.wall = run.special === 'freekick';
  if (shot.wall) {
    const range = WALL.range[0] + random() * (WALL.range[1] - WALL.range[0]);
    origin.x = (random() * 2 - 1) * WALL.lateral;
    origin.y = GROUND_Y;
    origin.z = GOAL.PLANE_Z + range;
    blockerCount = 2;
    shot.defenseStrength = 1;
    return;
  }
  chooseChanceOrigin(origin, run.level, random);
  const defence = defenceFor(run.level, origin.z - GOAL.PLANE_Z, random);
  blockerCount = run.special === 'bonus' ? 0 : defence.blockers;
  shot.defenseStrength = defence.strength;
}

/** Which special, if any, this chance is. Never two random specials running. */
function planSpecial(run) {
  let special = null;
  run.freeMiss = false;
  run.scriptedMoment = false;
  if (shot.tutorial) { run.freeMiss = true; return null; }
  if (state.forceSpecial) { special = state.forceSpecial; state.forceSpecial = null; }   // test hook
  else if (openingLevel(run)) special = null;   // level 1: just the goal and the keeper
  else if (run.introPending) {
    special = run.introPending;
    run.introPending = null;
    run.freeMiss = true;
  }
  else if (run.bossPending && run.level === 4) { run.bossPending = false; special = 'boss'; }
  else if (run.opening && run.shots < OPENING.length) {
    special = OPENING[run.shots] === 'moment' ? null : OPENING[run.shots];
    run.scriptedMoment = OPENING[run.shots] === 'moment';
  }
  else if (run.bonusLeft > 0) { run.bonusLeft--; special = 'bonus'; }
  else if (run.bossPending) { run.bossPending = false; special = 'boss'; }
  else if (run.daily && run.shots === progress.DAILY_SHOTS - 1) special = 'boss';
  else if (!run.lastSpecial) {
    const roll = run.random();
    let edge = 0;
    for (const kind of ['freekick', 'moving', 'golden']) {
      if (run.level < SPECIALS[kind].from) continue;
      edge += SPECIALS[kind].odds;
      if (roll < edge) { special = kind; break; }
    }
  }
  run.lastSpecial = special;
  return special;
}

/**
 * The pull shot's first level is only the goal and the keeper: learn the
 * pull, score, then meet targets on level 2. A rookie keeper makes proper
 * pulls score; weak ones are still saved, which teaches "pull harder".
 */
const ROOKIE_SKILL = .15;
const openingLevel = run => shotMode === 'pull' && run.level === 1 && !run.daily;

/** Undo a special chance's looks: keeper size and kit, target colours, ball tint. */
function endSpecial() {
  engine.setKeeperBoss(false);
  engine.setTargetStyle();
  engine.setBallTint(progress.ballColor());
}

/** The moving target slides across its side of the goal until the kick. */
function updateMovingTarget(dt) {
  if (state.run.special !== 'moving') return;
  aimTarget.phase += MOVING_TARGET.speed * dt;
  aimTarget.x = aimTarget.minX + (aimTarget.maxX - aimTarget.minX) * (.5 + .5 * Math.sin(aimTarget.phase));
  engine.setTargetX(aimTarget.x);
}

/**
 * Target: anywhere its whole ring fits inside the goal mouth, but never over
 * the keeper - it goes to one side of where he has set himself.
 */
export function chooseTarget(out, level, keeperX, random = Math.random) {
  const ramp = levelRamp(level);
  out.ring = TARGET.RING_HALF[0] + (TARGET.RING_HALF[1] - TARGET.RING_HALF[0]) * ramp;
  out.bull = TARGET.BULL_HALF[0] + (TARGET.BULL_HALF[1] - TARGET.BULL_HALF[0]) * ramp;
  const spanX = GOAL.HALF_W - out.ring - TARGET.MARGIN_X * .5;
  const gap = Math.max(out.ring + TARGET.KEEPER_CLEAR, TARGET.BULL_CLEAR);
  // Free space either side of the keeper, as intervals of allowed centres.
  const left = [-spanX, Math.min(spanX, keeperX - gap)], right = [Math.max(-spanX, keeperX + gap), spanX];
  const leftRoom = Math.max(0, left[1] - left[0]), rightRoom = Math.max(0, right[1] - right[0]);
  if (leftRoom + rightRoom <= 0) {
    out.x = keeperX > 0 ? -spanX : spanX;
    out.minX = out.maxX = out.x;
  } else {
    const pick = random() * (leftRoom + rightRoom);
    const side = pick < leftRoom ? left : right;
    out.x = pick < leftRoom ? left[0] + pick : right[0] + (pick - leftRoom);
    // The room on the chosen side of the keeper: a moving target stays inside it.
    out.minX = side[0]; out.maxX = side[1];
  }
  const minY = Math.max(TARGET.MIN_Y, out.ring + .08);
  out.y = minY + random() * Math.max(0, GOAL.HEIGHT - out.ring - .08 - minY);
  return out;
}

function beginChance() {
  const run = state.run;
  shot.tutorial = shotMode === 'timing' && !run.daily && run.startLevel === 1 && run.shots === 0;
  shot.tutorialTime = 0;
  engine.stopCelebration();
  engine.stopReactions();
  engine.settlePlayers();   // never carry a celebration or reaction pose into the aim
  engine.captureSelectionPoses();
  prepareChance();
  shot.keeperDepth = .75;
  engine.setKeeperBoss(run.special === 'boss');
  engine.setSlingshotView(shotMode === 'sling');
  engine.setupChance(origin, blockerCount, false, shot.wall ? 'wall' : 'marking');
  for (let i = 0; i < blockerCount; i++) {
    const src = engine.chance.blockers[i];
    const b = blockers[i];
    b.z = src.z; b.baseX = src.baseX; b.x = src.baseX;
    b.side = 1; b.lunge = 0; b.depth = 1; b.delay = 0; b.down = 0; b.spent = false;
    b.airY = 0; b.vy = 0; b.jumped = false;
  }

  // The arrow sweeps in goal-plane metres, so a shot from 9m and one from 18m
  // demand the same precision instead of the far one being trivially easy.
  shot.thetaCentre = aimAngleFor(origin, 0);
  shot.aimX = 0;
  shot.theta = shot.thetaCentre;
  shot.sweepDir = Math.random() < 0.5 ? 1 : -1;
  shot.sweepBoost = 1;
  shot.powerBoost = 1;
  shot.power = 0;
  shot.powerDir = 1;
  shot.assisted = !run.daily && run.assistShots > 0;
  shot.timingFactor = shot.tutorial ? .5 : run.daily ? 1 : timingFactor(run.combo, shot.assisted);
  shot.swing = 0;
  shot.windup = 0;
  shot.resolved = null;
  shot.precision = null;
  shot.points = 0;
  shot.holdTimer = 0;
  shot.flightTime = 0;
  shot.bounced = false;
  shot.reboundStart = -1;
  shot.awayTimer = 0;
  shot.acc = 0;
  // A real keeper narrows the angle: he shades along his line toward the
  // shooter rather than standing centrally and waiting.
  const narrow = Math.max(-2.6, Math.min(2.6, origin.x * SHOT.KEEPER_ANGLE_NARROW));
  // A keeper's moment: not on special chances, which have their own keeper rules.
  shot.keeperMoment = !run.special && (run.scriptedMoment
    || (!(run.opening && run.shots < OPENING.length) && run.random() < ARCADE.KEEPER_MOMENT.odds));
  shot.keeperAbility = keeperAbility(run.level, Math.hypot(origin.x, origin.z - GOAL.PLANE_Z), run.special,
    shot.keeperMoment, shot.assisted);
  shot.noTarget = openingLevel(run) && !run.special;
  if (shot.noTarget) shot.keeperAbility = sharpenKeeper(shot.keeperAbility, ROOKIE_SKILL - shot.keeperAbility.skill);
  shot.keeperSetX = run.special === 'bonus' ? (run.random() < .5 ? -1 : 1) * (GOAL.HALF_W + 1.3)
    : narrow + (run.random() * 2 - 1) * shot.keeperAbility.setSpread;
  shot.keeperX = shot.keeperSetX;
  shot.keeperDive = 0;
  shot.keeperSide = 1;
  shot.diveDepth = 1;
  engine.setKeeper(shot.keeperX, 0, 1, 0, 0, 0, null, shot.keeperDepth);
  chooseTarget(aimTarget, run.level, shot.keeperSetX, run.random);
  if (shot.tutorial) {
    shot.aimX = aimTarget.x;
    shot.theta = aimAngleFor(origin, shot.aimX);
    engine.setAim(shot.theta);
  }
  // A moving target needs room to travel on its side of the keeper.
  if (run.special === 'moving' && aimTarget.maxX - aimTarget.minX < MOVING_TARGET.minTravel) {
    if (run.freeMiss) {
      // The guaranteed introduction uses the roomier side of the keeper.
      chooseTarget(aimTarget, run.level, shot.keeperSetX, () => shot.keeperSetX >= 0 ? 0 : .999999);
    } else run.special = run.lastSpecial = 'golden';
  }
  // No target: park it far off the goal, so no shot scores as on target or beats the keeper by it.
  if (shot.noTarget) { aimTarget.x = 99; aimTarget.minX = aimTarget.maxX = 99; }
  aimTarget.phase = run.random() * Math.PI * 2;
  // Now and then the target carries an extra life; never on two targets running.
  aimTarget.heart = !shot.tutorial && !shot.noTarget && !run.daily && run.special !== 'bonus' && !run.heartOffered
    && run.hearts < ARCADE.MAX_HEARTS && run.random() < ARCADE.HEART_ODDS;
  run.heartOffered = aimTarget.heart;
  engine.setTarget(aimTarget.x, aimTarget.y, aimTarget.ring, aimTarget.bull, aimTarget.heart);
  const style = run.special && SPECIALS[run.special];
  engine.setTargetStyle(style?.ring, style?.bull);
  applyCosmetics();
  updateMovingTarget(0);
  if (run.special) poki.measure('special', run.special, 'start');
  engine.showTarget(!shot.noTarget);
  engine.restoreSelectionPoses();
  engine.faceStrikerForSelection();

  prepareShotMode();
  state.phase = 'AIM';
  ui.clearVerdict();
  if (shot.tutorial) ui.showTutorialStep(1);
  else if (shotMode === 'pull' && coachActive()) coachPull(true);
  else if (shotMode === 'pull' && run.level >= 2 && !run.targetIntroShown && !run.daily) {
    run.targetIntroShown = true;
    ui.coach('NEW: TARGETS', 'Shoot inside the ring', 'The keeper can never stop a strong shot on target.', false);
  } else ui.setPrompt(shotPrompt(run));
  pushHud();
}

/** Keeps the arena alive while you are aiming. */
function updateAim(dt) {
  if (shot.tutorial) {
    // Smooth, visible travel; both axes stay inside the round target together.
    shot.tutorialTime += dt;
    shot.aimX = aimTarget.x + aimTarget.ring * .6 * Math.sin(shot.tutorialTime * .9);
    shot.theta = aimAngleFor(origin, shot.aimX);
    engine.setAim(shot.theta);
    return;
  }
  // Triangle sweep across the goalmouth, delta-scaled.
  const low = -SHOT.AIM_SPAN;
  const high = SHOT.AIM_SPAN;
  shot.aimX += shot.sweepDir * sweepSpeed() * dt;
  if (shot.aimX > high) { shot.aimX = 2 * high - shot.aimX; shot.sweepDir = -1; bounceBoost('sweepBoost'); }
  if (shot.aimX < low) { shot.aimX = 2 * low - shot.aimX; shot.sweepDir = 1; bounceBoost('sweepBoost'); }
  shot.theta = aimAngleFor(origin, shot.aimX);
  engine.setAim(shot.theta);
}

/** Timing mode: the meter's height on the goal line. */
const meterHeight = power => shot.tutorial ? aimTarget.y + (power - .5) * aimTarget.ring * 1.2
  : SHOT.METER_HEIGHT[0] + (SHOT.METER_HEIGHT[1] - SHOT.METER_HEIGHT[0]) * power;

/** Timing mode's launch: the arrow's line, the meter's height, and pace rising with the meter. */
function timingVelocity(theta, power, out) {
  const x = origin.x + Math.tan(theta) * (origin.z - GOAL.PLANE_Z);
  return velocityTo(origin, x, meterHeight(power), BASE_VELOCITY * SPEED_SCALE * (.6 + .4 * power), out, 0);
}

/** Every turn of the arrow or the meter makes it a little faster, up to the cap. */
function bounceBoost(key) {
  if (shot.tutorial) return;
  shot[key] = Math.min(1 + SHOT.MAX_BOOST, shot[key] + SHOT.BOUNCE_BOOST);
}

function updatePower(dt) {
  shot.power += shot.powerDir * powerCycle(state.run.level) * shot.powerBoost * shot.timingFactor * dt;
  if (shot.power > 1) { shot.power = 1; shot.powerDir = -1; bounceBoost('powerBoost'); }
  if (shot.power < 0) { shot.power = 0; shot.powerDir = 1; bounceBoost('powerBoost'); }

  // Preview where this power crosses the goal line (also the test hook's `prediction`).
  prediction.y = meterHeight(shot.power);
  engine.setElevation(Math.max(0.1, prediction.y));
}

// ===========================================================================
// Shot modes. Five ways to take a shot, one launch: each mode ends in a
// launch velocity (and, for flick, a sideways curve), then the same windup,
// flight, keeper and scoring.
//   flick  - swipe up from anywhere: direction aims, length sets the height,
//            speed sets the pace, a bent swipe curls the ball.
//   aim    - press a point on the goal, then hold to charge pace; the crosshair
//            drifts farther from that frozen point, so overcharging misses.
//   timing - the original sweeping arrow and height meter, two presses.
//   drag   - classic direction + power: hold to charge, drag the crosshair, release.
//   sling  - pull a line from behind the ball through it; hold raises the shot.
//   pull   - touch anywhere and pull back like a slingshot: the pull's angle aims,
//            its length sets height and pace, a dotted arc shows the start of
//            the flight. Held too long at full stretch, the band trembles.
// ?shot=flick|aim|timing|drag|sling|pull picks one (default: pull); localhost Alt+9 cycles them.
// ===========================================================================
export const SHOT_MODES = ['pull', 'flick', 'aim', 'timing', 'drag', 'sling'];
const DEFAULT_SHOT_MODE = 'pull';     // releases: pull back and release
const _shotParam = new URLSearchParams(location.search).get('shot');
let shotMode = SHOT_MODES.includes(_shotParam) ? _shotParam : DEFAULT_SHOT_MODE;

const FLICK = {
  MIN_UP: .05,            // a swipe must travel this much of the screen height upward
  MAX_TIME: 1.4,          // ...within this many seconds
  AIM: 5.5,               // metres across the goal line per unit of swipe slope (sideways / up)
  HEIGHT: [.07, .5],      // swipe length (screen heights) for the lowest and the highest shot
  TOP: 2.9,               // height on the line of the longest swipe, metres
  SWIPE_SPEED: [.8, 4],   // screen heights per second for the slowest and the fastest pace
  SPEED: [25, 40],        // horizontal ball speed, m/s
  CURVE: 32,              // m/s^2 of sideways curl per unit of swipe bend
  CURVE_MAX: 14,
  DEAD: .035,             // a bend below this is a straight shot
};
const FREE_AIM = {
  CHARGE_TIME: .8,        // seconds to full charge
  DRIFT_MAX: 4.8,         // full charge moves beyond the goal, metres
  DRIFT_CURVE: 2.4,       // accurate early, increasingly unstable near full charge
  DRIFT_SPEED: 4.2,       // radians/sec around the pressed point
  DRIFT_Y: .75,           // slightly flatter vertically than horizontally
  SPEED: [25, 40],
  KEYS: 2.6,              // m/s the arrow keys move the crosshair
};
const HOLD_DRAG = {
  CHARGE_TIME: .9,        // classic power bar: empty -> full
  AIM_X: 8,               // goal metres moved by a full-screen horizontal drag
  AIM_Y: 4,               // goal metres moved by a full-screen vertical drag
  SPEED: [24, 41],        // horizontal ball speed, m/s
  KEYS: 3.2,              // keyboard alternative while Space is held
};
const SLING_SHOT = {
  CHARGE_TIME: 1.15,      // holding raises the arrow from turf to over the bar
  HEIGHT: [.18, 3.15],    // height where the guide reaches the goal plane
  SPEED: [25, 40],        // horizontal ball speed, m/s
  AIM_LIMIT: 5.1,         // keeps the forward half of the full arrow on screen
};
const PULL = {
  MIN: .05,               // screen heights: a shorter pull is no shot
  FULL: .34,              // screen heights for a full pull
  OVER: 1.15,             // pulling past full keeps rising (and sails over the bar)
  AIM: 4.2,               // metres across the goal line per unit of pull slope (sideways / down)
  HEIGHT: [.12, 2.2],     // height on the goal line at the shortest and at a full pull (just under the bar);
                          // only an over-pull (red) sails over
  // The zones tighten with the level (instead of anything speeding up): the
  // weak (blue) end grows, the height climbs faster so the bar (red) comes
  // sooner, and the comfortable green middle narrows. Gold is a fixed band under the bar.
  ZONE_RAMP: 12,          // levels over which the zones reach their late values
  WEAK_LATE: .55,         // weak threshold late in a run (PULL.WEAK at level 1)
  TOP_LATE: 2.8,          // height of a full pull late in a run (HEIGHT[1] at level 1)
  GOLD: .14,              // width of the gold band under the bar, in pull power
  // A session's first (coached) shots are nearly impossible to miss: almost any
  // pull is strong, none goes over the bar, the aim is gentle and stays inside
  // the posts, no tremble, and the keeper cannot reach an on-frame shot.
  EASY_WEAK: 0,            // any pull long enough to shoot is strong
  EASY_TOP: 1.9,          // a full (even an over-) pull stays under the bar
  EASY_AIM: .55,          // share of the normal aim swing
  EASY_POST: .45,         // metres inside the posts the aim is kept
  SPEED: [17, 39],        // horizontal ball speed, m/s: a short pull is a soft shot
  WEAK: .35,              // below this power a shot is weak: no target guarantee, a sharper keeper
  WEAK_KEEPER: .3,        // skill the keeper gains against a weak shot
  WEAK_REACH: 1.9,        // ...and his dive reaches this much further
  PREVIEW: [.75, .3],     // share of the flight the dots show: level 1 -> late in a run
  PREVIEW_RAMP: 10,       // levels over which the preview shortens
  LEARN_SHOTS: 2,         // a session's first shots show the whole flight
  STEADY: .8,             // seconds a pull can be held before the band trembles
  TREMBLE: 1.2,           // metres of aim wobble a long hold builds up to
  TREMBLE_RATE: 14,       // radians/s: how fast it swings left and right
  TREMBLE_GROW: 1.1,      // metres of amplitude added per second of trembling
  TREMBLE_Y: .6,          // vertical wobble as a share of the sideways one (out of phase: it circles)
  // The elastic: once the finger stops, the band bounces. Power (height and
  // pace) swings with it; a release at the top of a stretch is a SNAP.
  BOUNCE: .16,            // power swing either way (a full pull is 1)
  BOUNCE_HZ: 1.7,         // stretches per second
  SETTLE: .12,            // seconds the finger must be still before the band starts bouncing
  STILL_PX: 3,            // finger movement per frame that counts as still
  BOUNCE_IN: .3,          // seconds for the bounce to reach full swing
  SNAP_WINDOW: .82,       // release with the stretch above this (of its peak) for a SNAP
  SNAP_PACE: 1.12,        // a SNAP leaves this much faster
  KEY_RATE: .4,           // screen heights per second Space pulls by itself
  KEY_AIM: .35,           // arrow keys: screen heights per second sideways
};
const pull = { active: false, keyboard: false, ax: 0, ay: 0, x: 0, y: 0, held: 0, slope: 0, power: 0,
  armed: false, wobble: 0, wobbleY: 0, lastX: 0, lastY: 0, still: 0, stretch: 0, snapReady: false };
let sessionPullShots = 0;
const SWIPE_SAMPLES = 96;
const swipe = { active: false, count: 0, x: new Float32Array(SWIPE_SAMPLES), y: new Float32Array(SWIPE_SAMPLES),
  t: new Float32Array(SWIPE_SAMPLES) };
const aimPoint = { x: 0, y: 1.2, swayX: 0, swayY: 0, time: 0, driftSide: 1 };
const aimKeys = { left: false, right: false, up: false, down: false };
const holdDrag = { active: false, startX: 0, startY: 0, aimX: 0, aimY: 1.2 };
const slingshot = { active: false, hover: false, x: 0, z: 0, pullX: 0, pullZ: 0, aimX: 0, aimY: .18 };
const launchVelocity = { x: 0, y: 0, z: 0 };
let charge = 0;

/** Switches the shot mode (localhost Alt+9 cycles); the current chance is dealt again. */
function setShotMode(mode) {
  if (!SHOT_MODES.includes(mode)) return;
  shotMode = mode;
  if (state.screen === 'MATCH' && (state.phase === 'AIM' || state.phase === 'POWER')) beginChance();
}

/** The first shots of a run explain the controls of the current mode. */
function shotPrompt(run) {
  if (run.shots > 2) return '';
  if (shotMode === 'flick') return run.shots === 0 ? 'SWIPE UP TOWARD THE GOAL TO SHOOT' : 'BEND YOUR SWIPE TO CURL THE BALL';
  if (shotMode === 'aim') return run.shots === 0
    ? `${ui.pressWord() === 'TAP' ? 'TOUCH' : 'POINT'} TO AIM, HOLD BRIEFLY FOR POWER · OVERCHARGING MISSES` : '';
  if (shotMode === 'drag') return run.shots === 0 ? 'HOLD FOR POWER · DRAG TO AIM · RELEASE TO SHOOT' : '';
  if (shotMode === 'sling') return run.shots === 0
    ? 'MOVE BEHIND THE BALL TO AIM · HOLD TO LIFT · RELEASE TO SHOOT' : '';
  if (shotMode === 'pull') return run.shots === 0
    ? `${ui.pressWord() === 'TAP' ? 'TOUCH' : 'CLICK'} ANYWHERE, PULL BACK AND LET GO`
    : run.shots === 1 ? 'PULL SIDEWAYS TO AIM · PULL FURTHER TO SHOOT HIGHER' : '';
  return run.shots === 0 ? `${ui.pressWord()} TO LOCK YOUR AIM ON THE TARGET` : '';
}

/** A chance begins: show the mode's aiming aids. */
function prepareShotMode() {
  swipe.active = false;
  holdDrag.active = false;
  slingshot.active = false;
  slingshot.hover = false;
  charge = 0;
  shot.preset = false;
  shot.curve = 0;
  ui.setCharge(null);
  engine.showSlingshotGuide(false);
  pull.active = false;
  shot.snap = false;
  shot.easy = false;
  shot.weakShot = false;
  engine.hideTrajectory();
  ui.hidePull();
  engine.showAimRig(shotMode === 'timing', false);
  engine.showCrosshair(shotMode === 'aim' || shotMode === 'drag');
  if (shotMode === 'aim' || shotMode === 'drag') {
    aimPoint.x = aimTarget.x; aimPoint.y = aimTarget.y;
    aimPoint.swayX = 0; aimPoint.swayY = 0; aimPoint.time = 0;
    engine.setCrosshair(aimPoint.x, aimPoint.y, 0);
  }
}

/** Commits a mode's shot: the ball leaves with `launchVelocity` (and `curve`) after the windup. */
function commitShot(curve) {
  shot.preset = true;
  shot.curve = curve;
  shot.theta = Math.atan2(launchVelocity.x, -launchVelocity.z);
  audio.play('power');
  audio.setPower(null);
  ui.setPrompt('');
  ui.setCharge(null);
  engine.showAimRig(false, false);
  engine.showCrosshair(false);
  engine.showSlingshotGuide(false);
  engine.placeStrikerContact(shot.theta);
  shot.windup = 0;
  state.phase = 'WINDUP';
}

const shotInputOpen = () => state.screen === 'MATCH' && !state.paused && !poki.isInBreak()
  && (state.phase === 'AIM' || state.phase === 'POWER');

// ---- Flick --------------------------------------------------------------------
function swipeSample(e) {
  const i = Math.min(swipe.count, SWIPE_SAMPLES - 1);
  swipe.x[i] = e.clientX; swipe.y[i] = e.clientY; swipe.t[i] = e.timeStamp / 1000;
  swipe.count = i + 1;
}

/** Reads a finished swipe into a shot, or explains why it was not one. */
function flickShot() {
  const n = swipe.count, H = innerHeight;
  const dx = swipe.x[n - 1] - swipe.x[0], dy = swipe.y[n - 1] - swipe.y[0];
  const up = -dy / H, side = dx / H, length = Math.hypot(dx, dy) / H;
  const time = Math.max(.016, swipe.t[n - 1] - swipe.t[0]);
  if (n < 2 || up < FLICK.MIN_UP || time > FLICK.MAX_TIME) {
    ui.setPrompt('SWIPE UP TOWARD THE GOAL, IN ONE QUICK MOVE');
    return false;
  }
  // Bend: the farthest the path strays from its straight line, signed (right of it positive).
  let bend = 0;
  for (let i = 1; i < n - 1; i++) {
    const cross = (dx * (swipe.y[i] - swipe.y[0]) - dy * (swipe.x[i] - swipe.x[0])) / (Math.hypot(dx, dy) * H);
    if (Math.abs(cross) > Math.abs(bend)) bend = cross;
  }
  bend /= Math.max(length, .05);
  // The ball follows the swipe's shape: a path bowing right starts right and curls back left.
  const curve = Math.abs(bend) < FLICK.DEAD ? 0
    : -Math.sign(bend) * Math.min(FLICK.CURVE_MAX, (Math.abs(bend) - FLICK.DEAD) * FLICK.CURVE);
  const x = side / up * FLICK.AIM;
  const y = GROUND_Y + FLICK.TOP * Math.max(0, Math.min(1, (length - FLICK.HEIGHT[0]) / (FLICK.HEIGHT[1] - FLICK.HEIGHT[0])));
  const pace = Math.max(0, Math.min(1, (length / time - FLICK.SWIPE_SPEED[0]) / (FLICK.SWIPE_SPEED[1] - FLICK.SWIPE_SPEED[0])));
  velocityTo(origin, x, y, FLICK.SPEED[0] + (FLICK.SPEED[1] - FLICK.SPEED[0]) * pace, launchVelocity, curve);
  shot.power = pace;
  commitShot(curve);
  return true;
}

// ---- Free aim ---------------------------------------------------------------------
/** The crosshair stays on the pressed point at first, then spirals away as charge grows. */
function updateFreeAim(dt) {
  if (state.phase === 'AIM' && (aimKeys.left || aimKeys.right || aimKeys.up || aimKeys.down)) {
    aimPoint.x += ((aimKeys.right ? 1 : 0) - (aimKeys.left ? 1 : 0)) * FREE_AIM.KEYS * dt;
    aimPoint.y += ((aimKeys.up ? 1 : 0) - (aimKeys.down ? 1 : 0)) * FREE_AIM.KEYS * dt;
  }
  aimPoint.x = Math.max(-GOAL.HALF_W - 1.2, Math.min(GOAL.HALF_W + 1.2, aimPoint.x));
  aimPoint.y = Math.max(.15, Math.min(GOAL.HEIGHT + .8, aimPoint.y));
  if (state.phase === 'POWER') {
    charge = Math.min(1, charge + dt / FREE_AIM.CHARGE_TIME);
    shot.power = charge;
    ui.setCharge(charge);
    aimPoint.time += dt;
    const drift = FREE_AIM.DRIFT_MAX * Math.pow(charge, FREE_AIM.DRIFT_CURVE);
    aimPoint.swayX = Math.cos(aimPoint.time * FREE_AIM.DRIFT_SPEED) * drift * aimPoint.driftSide;
    aimPoint.swayY = Math.sin(aimPoint.time * FREE_AIM.DRIFT_SPEED) * drift * FREE_AIM.DRIFT_Y;
  } else {
    aimPoint.swayX = 0;
    aimPoint.swayY = 0;
  }
  engine.setCrosshair(aimPoint.x + aimPoint.swayX, aimPoint.y + aimPoint.swayY, charge * .6);
}

function startFreeAimCharge() {
  audio.play('aim');
  charge = 0;
  shot.power = 0;
  aimPoint.swayX = 0; aimPoint.swayY = 0; aimPoint.time = 0;
  aimPoint.driftSide = state.run.random() < .5 ? -1 : 1;
  engine.setCrosshair(aimPoint.x, aimPoint.y, 0);
  state.phase = 'POWER';
}

function releaseFreeAim() {
  if (state.phase !== 'POWER' || shotMode !== 'aim') return;
  velocityTo(origin, aimPoint.x + aimPoint.swayX, aimPoint.y + aimPoint.swayY,
    FREE_AIM.SPEED[0] + (FREE_AIM.SPEED[1] - FREE_AIM.SPEED[0]) * charge, launchVelocity, 0);
  commitShot(0);
}

// ---- Hold + drag ---------------------------------------------------------------
function clampDragAim() {
  aimPoint.x = Math.max(-GOAL.HALF_W - 1.2, Math.min(GOAL.HALF_W + 1.2, aimPoint.x));
  aimPoint.y = Math.max(.15, Math.min(GOAL.HEIGHT + .8, aimPoint.y));
}

function startHoldDrag(clientX = 0, clientY = 0, pointer = false) {
  holdDrag.active = pointer;
  holdDrag.startX = clientX; holdDrag.startY = clientY;
  holdDrag.aimX = aimPoint.x; holdDrag.aimY = aimPoint.y;
  charge = 0;
  shot.power = 0;
  audio.play('aim');
  ui.setCharge(0);
  state.phase = 'POWER';
}

function moveHoldDrag(clientX, clientY) {
  if (!holdDrag.active) return;
  aimPoint.x = holdDrag.aimX + (clientX - holdDrag.startX) / innerWidth * HOLD_DRAG.AIM_X;
  aimPoint.y = holdDrag.aimY - (clientY - holdDrag.startY) / innerHeight * HOLD_DRAG.AIM_Y;
  clampDragAim();
}

function updateHoldDrag(dt) {
  charge = Math.min(1, charge + dt / HOLD_DRAG.CHARGE_TIME);
  shot.power = charge;
  ui.setCharge(charge);
  if (aimKeys.left || aimKeys.right || aimKeys.up || aimKeys.down) {
    aimPoint.x += ((aimKeys.right ? 1 : 0) - (aimKeys.left ? 1 : 0)) * HOLD_DRAG.KEYS * dt;
    aimPoint.y += ((aimKeys.up ? 1 : 0) - (aimKeys.down ? 1 : 0)) * HOLD_DRAG.KEYS * dt;
    clampDragAim();
  }
  engine.setCrosshair(aimPoint.x, aimPoint.y, charge * .35);
}

function releaseHoldDrag() {
  if (state.phase !== 'POWER' || shotMode !== 'drag') return;
  holdDrag.active = false;
  velocityTo(origin, aimPoint.x, aimPoint.y,
    HOLD_DRAG.SPEED[0] + (HOLD_DRAG.SPEED[1] - HOLD_DRAG.SPEED[0]) * charge, launchVelocity, 0);
  commitShot(0);
}

// ---- Slingshot line -------------------------------------------------------------
function slingshotHeight() {
  return SLING_SHOT.HEIGHT[0] + (SLING_SHOT.HEIGHT[1] - SLING_SHOT.HEIGHT[0]) * charge;
}

function pointSlingshot(clientX, clientY, hideInvalid = true) {
  if (!engine.pointerToSlingshot(clientX, clientY, slingshot)) {
    if (hideInvalid && !slingshot.active) engine.showSlingshotGuide(false);
    slingshot.hover = false;
    return false;
  }
  const forwardX = origin.x - slingshot.x;
  const forwardZ = origin.z - slingshot.z;
  if (forwardZ >= -.05) return false;
  const atGoal = (GOAL.PLANE_Z - origin.z) / forwardZ;
  const aimX = origin.x + forwardX * atGoal;
  if (Math.abs(aimX) > SLING_SHOT.AIM_LIMIT) {
    if (hideInvalid && !slingshot.active) engine.showSlingshotGuide(false);
    slingshot.hover = false;
    return false;
  }
  slingshot.pullX = slingshot.x;
  slingshot.pullZ = slingshot.z;
  slingshot.aimX = aimX;
  slingshot.aimY = slingshotHeight();
  slingshot.hover = true;
  engine.setSlingshotGuide(slingshot.pullX, slingshot.pullZ, slingshot.aimX, slingshot.aimY);
  return true;
}

function startSlingshot() {
  slingshot.active = true;
  charge = 0;
  shot.power = 0;
  slingshot.aimY = slingshotHeight();
  audio.play('aim');
  ui.setCharge(0);
  state.phase = 'POWER';
}

function updateSlingshot(dt) {
  charge = Math.min(1, charge + dt / SLING_SHOT.CHARGE_TIME);
  shot.power = charge;
  ui.setCharge(charge);
  slingshot.aimY = slingshotHeight();
  engine.setSlingshotGuide(slingshot.pullX, slingshot.pullZ, slingshot.aimX, slingshot.aimY);
}

function releaseSlingshot() {
  if (state.phase !== 'POWER' || shotMode !== 'sling' || !slingshot.active) return;
  slingshot.active = false;
  velocityTo(origin, slingshot.aimX, slingshot.aimY,
    SLING_SHOT.SPEED[0] + (SLING_SHOT.SPEED[1] - SLING_SHOT.SPEED[0]) * charge, launchVelocity, 0);
  commitShot(0);
}

// ---- Pull (slingshot) ---------------------------------------------------------------
/** Reads the pull: armed or not, its slope (aim) and power (height and pace). */
function pullShape() {
  const H = innerHeight, dx = (pull.x - pull.ax) / H, dy = (pull.y - pull.ay) / H;
  const length = Math.hypot(dx, dy);
  pull.armed = dy > PULL.MIN * .6 && length >= PULL.MIN;
  pull.power = Math.min(PULL.OVER, Math.max(0, (length - PULL.MIN) / (PULL.FULL - PULL.MIN)));
  pull.slope = dy > .001 ? -dx / dy : 0;
}

/** The launch for the current pull: pulling down-left shoots right, further shoots higher. */
function pullVelocity(out, pace = 1) {
  const power = Math.max(0, pull.power + pull.stretch * PULL.BOUNCE);
  const easy = coachActive(), edge = easy ? GOAL.HALF_W - PULL.EASY_POST : GOAL.HALF_W + 2;
  const x = Math.max(-edge, Math.min(edge, pull.slope * PULL.AIM * (easy ? PULL.EASY_AIM : 1) + pull.wobble));
  const y = Math.max(.05, PULL.HEIGHT[0] + (pullZones().top - PULL.HEIGHT[0]) * power + pull.wobbleY);
  return velocityTo(origin, x, y, (PULL.SPEED[0] + (PULL.SPEED[1] - PULL.SPEED[0]) * Math.min(1, power)) * pace, out, 0);
}

/** How much of the flight the dots show: all of it while learning, less as the run goes on. */
function pullPreviewShare() {
  if (sessionPullShots < PULL.LEARN_SHOTS) return 1;
  const ramp = Math.min(1, (state.run.level - 1) / PULL.PREVIEW_RAMP);
  return PULL.PREVIEW[0] + (PULL.PREVIEW[1] - PULL.PREVIEW[0]) * ramp;
}

/** This level's zones, in pull power: weak below `weak`, over the bar above `over`, gold just under it. */
const zones = { weak: 0, gold: 0, over: 0, top: 0 };
function pullZones() {
  const r = Math.min(1, Math.max(0, (state.run.level - 1) / PULL.ZONE_RAMP));
  const easy = coachActive();
  zones.weak = easy ? PULL.EASY_WEAK : PULL.WEAK + (PULL.WEAK_LATE - PULL.WEAK) * r;
  zones.top = easy ? PULL.EASY_TOP : PULL.HEIGHT[1] + (PULL.TOP_LATE - PULL.HEIGHT[1]) * r;
  zones.over = (GOAL.HEIGHT - PULL.HEIGHT[0]) / (zones.top - PULL.HEIGHT[0]);   // the power that reaches the bar
  zones.gold = zones.over - PULL.GOLD;
  return zones;
}
const PULL_COLOURS = { weak: [0x8fb3d9, '#8fb3d9'], green: [0x6ef3a8, '#6ef3a8'], gold: [0xffd24a, '#ffd24a'],
  over: [0xff6b6b, '#ff6b6b'] };
function pullColour() {
  const z = pullZones(), power = pull.power + pull.stretch * PULL.BOUNCE;
  return PULL_COLOURS[power < z.weak ? 'weak' : power < z.gold ? 'green' : power < z.over ? 'gold' : 'over'];
}

function startPull(x, y, keyboard) {
  pull.active = true;
  pull.keyboard = keyboard;
  pull.ax = pull.x = x;
  pull.ay = pull.y = y;
  pull.held = 0;
  pull.wobble = pull.wobbleY = 0;
  pull.lastX = x; pull.lastY = y;
  pull.still = 0; pull.stretch = 0; pull.snapReady = false;
  audio.play('aim');
  state.phase = 'POWER';
}

function updatePull(dt) {
  if (pull.keyboard) {
    // Space pulls by itself; the arrows lean it (left aims left: the band goes right).
    pull.y = Math.min(pull.ay + PULL.FULL * PULL.OVER * innerHeight, pull.y + PULL.KEY_RATE * innerHeight * dt);
    pull.x -= ((aimKeys.right ? 1 : 0) - (aimKeys.left ? 1 : 0)) * PULL.KEY_AIM * innerHeight * dt;
  }
  pullShape();
  // The elastic: moving the finger settles the band; holding still lets it bounce.
  const moved = Math.hypot(pull.x - pull.lastX, pull.y - pull.lastY);
  pull.lastX = pull.x; pull.lastY = pull.y;
  pull.still = moved > PULL.STILL_PX || !pull.armed ? 0 : pull.still + dt;
  const bouncing = Math.max(0, pull.still - PULL.SETTLE);
  const swing = Math.min(1, bouncing / PULL.BOUNCE_IN);
  pull.stretch = swing * Math.sin(bouncing * PULL.BOUNCE_HZ * Math.PI * 2);
  const snapReady = swing > .9 && pull.stretch > PULL.SNAP_WINDOW;
  if (snapReady && !pull.snapReady) audio.play('hover');
  pull.snapReady = snapReady;
  // Held armed for too long, the band trembles: waiting for the perfect moment costs.
  pull.held = pull.armed ? pull.held + dt : 0;
  const tremble = coachActive() ? 0 : Math.min(PULL.TREMBLE, Math.max(0, pull.held - PULL.STEADY) * PULL.TREMBLE_GROW);
  pull.wobble = Math.sin(pull.held * PULL.TREMBLE_RATE) * tremble;
  pull.wobbleY = Math.sin(pull.held * PULL.TREMBLE_RATE * 1.3 + 1.2) * tremble * PULL.TREMBLE_Y;
  shot.power = Math.min(1, pull.power);
  const [tint, css] = pullColour();
  if (pull.armed) {
    pullVelocity(launchVelocity);
    engine.showTrajectory(origin, launchVelocity, 0, pullPreviewShare(), tint);
  } else engine.hideTrajectory();
  // The knob rides the elastic along the band; at the top of a stretch it flashes white.
  const reach = 1 + pull.stretch * .12;
  const kx = pull.ax + (pull.x - pull.ax) * reach, ky = pull.ay + (pull.y - pull.ay) * reach;
  if (!pull.keyboard) ui.drawPull(pull.ax, pull.ay, kx, ky, pull.snapReady ? '#ffffff' : css);
  if (coachActive()) coachPull();
  else if (pull.keyboard && pull.snapReady) ui.setPrompt('SNAP!');
  else if (pull.keyboard && pull.armed) ui.setPrompt('');
}

function releasePull() {
  if (state.phase !== 'POWER' || shotMode !== 'pull' || !pull.active) return;
  pull.active = false;
  ui.hidePull();
  engine.hideTrajectory();
  pullShape();
  if (!pull.armed) {
    state.phase = 'AIM';
    if (coachActive()) coachPull(true);
    else ui.setPrompt('PULL BACK A LITTLE FURTHER, THEN LET GO');
    return;
  }
  // A release at the top of the stretch is a SNAP: the same aim, a sharper strike.
  shot.snap = pull.snapReady;
  shot.easy = coachActive();
  if (shot.easy) state.run.tutorialShots++;
  shot.weakShot = pull.power + pull.stretch * PULL.BOUNCE < pullZones().weak;
  pullVelocity(launchVelocity, shot.snap ? PULL.SNAP_PACE : 1);
  sessionPullShots++;
  coachKey = '';
  commitShot(0);
  if (shot.snap) { audio.play('combo', 3); engine.shake(.35); }
}

// ---- Pull coach: live, step-by-step help for a session's first shots ----------------
const COACH_SHOTS = 3;
const coachActive = () => state.run?.tutorial === true;
const FORCE_TUTORIAL = new URLSearchParams(location.search).get('tutorial') === '1';
let coachKey = '';

/** Shows the step that matches what the finger is doing right now. `fresh` resets it for a new chance. */
function coachPull(fresh = false) {
  if (!coachActive()) { if (coachKey) { coachKey = ''; ui.setPrompt(''); } return; }
  const touch = ui.pressWord() === 'TAP';
  const shotNo = `TUTORIAL · SHOT ${state.run.tutorialShots + 1} OF ${COACH_SHOTS}`;
  let step;
  if (fresh || !pull.active) step = ['hold', `${shotNo} · STEP 1`, touch ? 'Touch anywhere and hold' : 'Click anywhere and hold',
    touch ? 'Then drag your finger down toward you.' : 'Then drag down toward you (or hold Space).', true];
  else if (!pull.armed) step = ['pull', `${shotNo} · STEP 2`, 'Pull back', 'Drag down, away from the goal.', true];
  else {
    const [, css] = pullColour();
    step = css === PULL_COLOURS.weak[1] ? ['weak', `${shotNo} · STEP 2`, 'Further!', 'A short pull is too weak: the keeper saves it.', false]
      : css === PULL_COLOURS.over[1] ? ['over', `${shotNo} · STEP 3`, 'Too far!', 'Red goes over the bar. Ease back a little.', false]
        : ['go', `${shotNo} · STEP 3`, 'Let go to shoot!', !shot.noTarget
          ? 'Aim for the ring: the keeper cannot stop a shot inside it.' : state.run.tutorialShots > 0
            ? 'Tip: pull left or right to aim the other way.' : 'Green or gold is a good strong shot.', false];
  }
  if (step[0] === coachKey && !fresh) return;
  coachKey = step[0];
  ui.coach(step[1], step[2], step[3], step[4]);
}

// ---- Input ---------------------------------------------------------------------------
function shotPointerDown(e) {
  if (shotMode === 'timing' || state.phase === 'FLIGHT') { advance(); return; }
  if (!shotInputOpen()) return;
  poki.gameplayStart();
  if (shotMode === 'flick' && state.phase === 'AIM') {
    swipe.active = true;
    swipe.count = 0;
    swipeSample(e);
    ui.drawSwipe(swipe.x, swipe.y, swipe.count);
  } else if (shotMode === 'aim' && state.phase === 'AIM') {
    engine.pointerToGoal(e.clientX, e.clientY, aimPoint);
    startFreeAimCharge();
  } else if (shotMode === 'drag' && state.phase === 'AIM') {
    startHoldDrag(e.clientX, e.clientY, true);
  } else if (shotMode === 'sling' && state.phase === 'AIM'
    && pointSlingshot(e.clientX, e.clientY)) {
    startSlingshot();
  } else if (shotMode === 'pull' && state.phase === 'AIM') {
    startPull(e.clientX, e.clientY, false);
  }
}

function shotPointerMove(e) {
  if (shotMode === 'flick' && swipe.active) {
    swipeSample(e);
    ui.drawSwipe(swipe.x, swipe.y, swipe.count);
  } else if (shotMode === 'aim' && state.phase === 'AIM' && shotInputOpen()
    && (e.pointerType === 'mouse' || e.buttons)) {
    engine.pointerToGoal(e.clientX, e.clientY, aimPoint);
  } else if (shotMode === 'drag' && holdDrag.active && shotInputOpen()) {
    moveHoldDrag(e.clientX, e.clientY);
  } else if (shotMode === 'sling' && shotInputOpen()) {
    pointSlingshot(e.clientX, e.clientY, !slingshot.active);
  } else if (shotMode === 'pull' && pull.active && !pull.keyboard) {
    pull.x = e.clientX;
    pull.y = e.clientY;
  }
}

function shotPointerUp(e) {
  if (shotMode === 'flick' && swipe.active) {
    swipe.active = false;
    swipeSample(e);
    ui.fadeSwipe();
    if (shotInputOpen()) flickShot();
  } else if (shotMode === 'aim') releaseFreeAim();
  else if (shotMode === 'drag' && holdDrag.active) releaseHoldDrag();
  else if (shotMode === 'sling') releaseSlingshot();
  else if (shotMode === 'pull' && !pull.keyboard) releasePull();
}

/** Space and the arrow keys, for the modes that use them. */
function shotKey(e, down) {
  const arrow = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
  if ((shotMode === 'aim' || shotMode === 'drag' || shotMode === 'pull') && arrow) { aimKeys[arrow] = down; return true; }
  if (e.code !== 'Space' && e.code !== 'Enter') return false;
  if (shotMode === 'timing' || state.phase === 'FLIGHT') { if (down && !e.repeat) advance(); return true; }
  if (shotMode === 'aim') {
    if (down && !e.repeat && shotInputOpen() && state.phase === 'AIM') {
      poki.gameplayStart();
      startFreeAimCharge();
    } else if (!down) releaseFreeAim();
    return true;
  }
  if (shotMode === 'drag') {
    if (down && !e.repeat && shotInputOpen() && state.phase === 'AIM') {
      poki.gameplayStart();
      startHoldDrag();
    } else if (!down) releaseHoldDrag();
    return true;
  }
  if (shotMode === 'sling') {
    if (down && !e.repeat && state.phase === 'AIM') ui.setPrompt('MOVE THE POINTER BEHIND THE BALL, THEN HOLD AND RELEASE');
    return true;
  }
  if (shotMode === 'pull') {
    // Hold Space to pull (it stretches by itself), steer with the arrows, let go to shoot.
    if (down && !e.repeat && shotInputOpen() && state.phase === 'AIM') {
      poki.gameplayStart();
      startPull(innerWidth / 2, innerHeight * .5, true);
    } else if (!down && pull.keyboard) releasePull();
    return true;
  }
  if (down && !e.repeat && shotInputOpen()) ui.setPrompt('SWIPE UP TOWARD THE GOAL TO SHOOT');
  return true;
}

/** Input handler: one press per phase; a press during the replay skips it. */
function advance() {
  if (state.screen !== 'MATCH' || state.paused || poki.isInBreak()) return;
  poki.gameplayStart();   // the first press of a session starts gameplay; later calls are no-ops

  if (shotMode !== 'timing' && (state.phase === 'AIM' || state.phase === 'POWER')) return;
  if (state.phase === 'AIM') {
    audio.play('aim');
    state.phase = 'POWER';
    engine.showAimRig(true, true);
    if (shot.tutorial) ui.showTutorialStep(2);
    else ui.setPrompt(state.run.shots === 0 ? `${ui.pressWord()} AGAIN TO SET THE HEIGHT` : '');
    return;
  }
  if (state.phase === 'POWER') {
    audio.play('power');
    audio.setPower(null);
    ui.setPrompt('');
    engine.showAimRig(false, false);
    engine.placeStrikerContact(shot.theta);
    shot.windup = 0;
    state.phase = 'WINDUP';
    return;
  }
  if (state.phase === 'FLIGHT' && shot.resolved !== null && shot.holdTimer > .25) {
    shot.holdTimer = .25;
  }
}

function launch() {
  if (!balanceSimulation) {
    audio.play('kick');
    audio.play('whoosh');
  }
  ballPos.x = origin.x; ballPos.y = origin.y; ballPos.z = origin.z;
  if (shot.preset) {
    ballVel.x = launchVelocity.x; ballVel.y = launchVelocity.y; ballVel.z = launchVelocity.z;
  } else {
    timingVelocity(shot.theta, shot.power, ballVel);
    shot.curve = 0;
  }
  const theta = shot.theta;
  engine.placeStrikerContact(theta);
  engine.setStrikerKick(1);
  engine.recordStrikerLaunch();

  // Read the arrival at the keeper, with uncertainty and reaction delay. He cannot
  // slide the length of the line either: a dive displaces him KEEPER_MAX_DIVE
  // at most, and his arms have to cover the rest.
  if (shot.weakShot) shot.keeperAbility = sharpenKeeper(shot.keeperAbility, PULL.WEAK_KEEPER);
  // A weak shot gives him time to cover more ground: a longer dive.
  shot.maxDive = SHOT.KEEPER_MAX_DIVE * (shot.weakShot ? PULL.WEAK_REACH : 1);
  predictFromVelocity(origin, ballVel, prediction, engine.keeperLineZ());
  const err = (Math.random() * 2 - 1) * shot.keeperAbility.readError;
  shot.keeperReadX = err;
  shot.keeperReadY = (Math.random() * 2 - 1) * shot.keeperAbility.heightError;
  const read = Math.max(-GOAL.HALF_W - 0.4, Math.min(GOAL.HALF_W + 0.4, prediction.x + err));
  shot.keeperTarget = Math.max(
    shot.keeperSetX - shot.maxDive,
    Math.min(shot.keeperSetX + shot.maxDive, read)
  );
  const travel = Math.abs(shot.keeperTarget - shot.keeperSetX);
  const readY = prediction.y + shot.keeperReadY;
  shot.keeperHigh = Math.max(0, Math.min(1, (readY - 1.05) / 1.3));
  shot.keeperSide = Math.sign(shot.keeperTarget - shot.keeperSetX) || 1;
  // How committed the dive is. A keeper reaching 20cm stays on his feet and
  // blocks with his body; only a full-stretch save goes horizontal.
  shot.diveDepth = Math.max(0, Math.min(1, (travel - SHOT.KEEPER_STAND_ZONE)
    / (shot.maxDive - SHOT.KEEPER_STAND_ZONE)));
  // On target: he still flies at it, full stretch, but finishes short of the ball.
  predictFromVelocity(origin, ballVel, crossing, GOAL.PLANE_Z, shot.curve);
  shot.keeperBeaten = !shot.weakShot && Math.abs(crossing.x) < GOAL.HALF_W && crossing.y < GOAL.HEIGHT
    && (shot.easy || Math.hypot(crossing.x - aimTarget.x, crossing.y - aimTarget.y) <= aimTarget.ring + ARCADE.BEATEN_MARGIN);
  if (shot.keeperBeaten) {
    shot.keeperTarget = keeperShortOf(prediction.x, shot.keeperSetX);
    shot.keeperSide = Math.sign(shot.keeperTarget - shot.keeperSetX) || 1;
    shot.diveDepth = 1;
  }
  shot.ghosted = false;
  shot.keeperJumpAt = Math.max(shot.keeperAbility.reaction, prediction.t - .25);
  shot.keeperDelay = shot.keeperAbility.reaction;
  shot.keeperDive = 0;
  shot.keeperAirY = 0;
  shot.keeperAirV = 0;
  shot.keeperDown = 0;
  shot.keeperLaunched = false;
  shot.keeperSpent = false;
  shot.clearer = null;
  shot.clearanceTime = 0;
  shot.clearanceCooldown = 0;
  shot.touched = null;
  shot.contactCool = 0;
  shot.restTimer = 0;
  shot.reboundStart = -1;
  shot.awayTimer = 0;
  shot.bounced = false;
  shot.entered = false;
  shot.follow = 0;
  shot.keeperGround = 0;
  shot.flightTime = 0;
  shot.acc = 0;

  // Each defender reads the ball's line across HIS plane, not the goal line,
  // and steps across it with his body and leading boot.
  for (let i = 0; i < blockerCount; i++) {
    const b = blockers[i];
    predictFromVelocity(origin, ballVel, prediction, b.z);
    const guess = prediction.x + (Math.random() * 2 - 1) * SHOT.BLOCK_READ_ERROR * (1 - .65 * shot.defenseStrength);
    b.target = Math.max(b.baseX - SHOT.BLOCK_MAX_LUNGE,
                        Math.min(b.baseX + SHOT.BLOCK_MAX_LUNGE, guess));
    b.side = Math.sign(b.target - b.baseX) || 1;
    b.depth = Math.min(1, Math.abs(b.target - b.baseX) / SHOT.BLOCK_MAX_LUNGE);
    // Early defenders are slow to react; the delay tightens with strength.
    b.delay = SHOT.BLOCK_REACTION * (2.2 - 1.65 * shot.defenseStrength);
    b.lowSlide = prediction.y < .65 && Math.random() < .65;
    b.slideTime = -1;
    b.lunge = 0;
    b.down = 0;
    b.spent = false;
    b.x = b.baseX;
    if (shot.wall) {
      // A wall holds its line and jumps as the ball is struck.
      b.target = b.baseX;
      b.lowSlide = false;
      b.delay = WALL.delay[0] + Math.random() * (WALL.delay[1] - WALL.delay[0]);
      b.airY = 0; b.vy = 0; b.jumped = false;
    }
  }

  state.phase = 'FLIGHT';
}

const crossing = { x: 0, y: 0, t: 0 };
const _arrivalPoint = { x: 0, y: 0, z: 0 }, _ahead1 = { x: 0, y: 0, z: 0 }, _ahead2 = { x: 0, y: 0, z: 0 };
const _clearPoints = [_arrivalPoint, ballPos, _ahead1, _ahead2];
const KEEPER_CLEARANCE = .12;   // metres between his nearest limb and a ball that beats him

/**
 * An on-target shot beats the keeper: every substep his real limbs are kept
 * clear of where the ball will cross his line (and of the ball itself), by
 * easing him away from it. He still flies at it; it goes just past his fingertips.
 */
function keepClearOf(aim, arrival) {
  const t = Math.max(0, arrival);
  _arrivalPoint.x = aim.x + .5 * shot.curve * t * t;
  _arrivalPoint.y = aim.y;
  _arrivalPoint.z = aim.z;
  // The ball now and over its next two substeps, so it cannot slip between checks.
  for (const [out, k] of [[_ahead1, 1], [_ahead2, 2]]) {
    out.x = ballPos.x + ballVel.x * PHYS_DT * k;
    out.y = ballPos.y + ballVel.y * PHYS_DT * k;
    out.z = ballPos.z + ballVel.z * PHYS_DT * k;
  }
  const points = arrival >= 0 ? 4 : 3;
  for (let pass = 0; pass < 4; pass++) {
    let deficit = 0;
    const caps = engine.getKeeperCapsules();
    for (let i = 0; i < caps.length; i++) {
      const cap = caps[i], reach = cap.r + BALL_R + KEEPER_CLEARANCE;
      for (let p = 4 - points; p < 4; p++) {
        const point = _clearPoints[p];
        closestPointOnSegment(point, cap.a, cap.b, contactPoint);
        const gap = Math.hypot(point.x - contactPoint.x, point.y - contactPoint.y, point.z - contactPoint.z);
        deficit = Math.max(deficit, reach - gap);
      }
    }
    if (deficit <= 0) return;
    const away = Math.sign(shot.keeperX - _arrivalPoint.x) || -shot.keeperSide;
    shot.keeperX += away * (deficit + .01);
    shot.keeperTarget += away * (deficit + .01);
    engine.setKeeper(shot.keeperX, shot.keeperDive, shot.keeperSide, shot.keeperHigh,
      shot.keeperAirY, shot.keeperGround, null, shot.keeperDepth);
  }
}

/** Where a beaten keeper's dive ends: toward the ball but KEEPER_MISS short, within his reach. */
function keeperShortOf(ballX, fromX) {
  const side = Math.sign(ballX - fromX) || 1;
  const x = ballX - side * ARCADE.KEEPER_MISS;
  return Math.max(fromX - shot.maxDive, Math.min(fromX + shot.maxDive, x));
}

/** Backswing. The ball does not move until the boot actually reaches it. */
function updateWindup(dt) {
  shot.windup += dt;
  engine.setStrikerKick(shot.windup / SHOT.WINDUP);
  engine.watchBall(dt, false);
  engine.faceKeeper(dt, 0.45);
  engine.setStrikerSwing(Math.min(0.55, (shot.windup / SHOT.WINDUP) * 0.55));
  engine.setKeeper(shot.keeperSetX, 0, shot.keeperSide, 0, 0, 0, null, shot.keeperDepth);
  if (shot.windup >= SHOT.WINDUP) launch();
}

/**
 * Push the ball clear of a limb it just struck and bounce it off. The contact
 * is resolved against the ball's CURRENT position rather than the swept
 * closest-approach point, which would shove it backwards along its own line.
 */
function deflect(cap, restitution) {
  closestPointOnSegment(ballPos, cap.a, cap.b, contactPoint);
  let nx = ballPos.x - contactPoint.x;
  let ny = ballPos.y - contactPoint.y;
  let nz = ballPos.z - contactPoint.z;
  let len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) {                       // dead centre: fall back to the sweep
    nx = hit.ax - hit.bx; ny = hit.ay - hit.by; nz = hit.az - hit.bz;
    len = Math.hypot(nx, ny, nz) || 1;
  }
  nx /= len; ny /= len; nz /= len;

  const reach = BALL_R + cap.r;
  if (len < reach) {
    ballPos.x = contactPoint.x + nx * reach;
    ballPos.y = contactPoint.y + ny * reach;
    ballPos.z = contactPoint.z + nz * reach;
  }
  reflect(ballVel, nx, ny, nz, restitution);

  // A shin or a glove is not a mirror; scatter the rebound a little.
  const sc = SHOT.DEFLECT_SCATTER;
  ballVel.x += (Math.random() * 2 - 1) * sc * Math.abs(ballVel.x || 1);
  ballVel.y += (Math.random() * 2 - 1) * sc * 3;
  ballVel.z += (Math.random() * 2 - 1) * sc * Math.abs(ballVel.z || 1);
}

/**
 * A keeper does not rebound the ball off a rigid limb - he pushes it away
 * from his goal, wide and up. Rebounds can still squirm in.
 */
function parryAway() {
  const sp = Math.hypot(ballVel.x, ballVel.y, ballVel.z);
  if (sp < 1e-3) return;
  let px = (ballPos.x >= 0 ? 1 : -1) * 0.6, py = 0.3, pz = 1;   // +z is upfield
  const pl = Math.hypot(px, py, pz);
  px /= pl; py /= pl; pz /= pl;

  const b = shot.keeperAbility.parryBias;
  ballVel.x = (ballVel.x / sp * (1 - b) + px * b) * sp;
  ballVel.y = (ballVel.y / sp * (1 - b) + py * b) * sp;
  ballVel.z = (ballVel.z / sp * (1 - b) + pz * b) * sp;
}

/**
 * One fixed physics substep: keeper, ball, then every collision test as a
 * swept query. Running this at PHYS_DT rather than per frame is what stops a
 * 40 m/s ball from stepping straight over the keeper or the woodwork.
 */
export function substep(h) {
  shot.flightTime += h;

  // --- Keeper --------------------------------------------------------------
  const keeperZ = engine.keeperLineZ();
  const arrival = ballVel.z < -.1 ? (keeperZ + .25 - ballPos.z) / ballVel.z : -1;
  if (!shot.keeperLaunched && shot.keeperDelay <= 0 && arrival >= 0 && shot.resolved === null) {
    // More flight time means more observation and more grounded positioning.
    // Refine the same read error rather than drawing fresh random noise.
    const uncertainty = 1 / (1 + shot.flightTime * 3);
    const readX = ballPos.x + ballVel.x * arrival + shot.keeperReadX * uncertainty;
    const readY = Math.max(BALL_R, ballPos.y + ballVel.y * arrival + .5 * GRAVITY * arrival * arrival)
      + shot.keeperReadY * uncertainty;
    shot.keeperTarget = Math.max(-GOAL.HALF_W + .25, Math.min(GOAL.HALF_W - .25,
      shot.keeperBeaten && shot.touched === null ? keeperShortOf(readX, shot.keeperX) : readX));
    if (arrival <= SHOT.KEEPER_COMMIT_TIME) {
      shot.keeperTarget = Math.max(shot.keeperX - shot.maxDive,
        Math.min(shot.keeperX + shot.maxDive, shot.keeperTarget));
    }
    shot.keeperJumpAt = shot.flightTime + Math.max(0, arrival - SHOT.KEEPER_COMMIT_TIME);
    shot.keeperHigh = Math.max(0, Math.min(1, (readY - 1.05) / 1.3));
    const remaining = Math.abs(shot.keeperTarget - shot.keeperX);
    shot.keeperSide = Math.sign(shot.keeperTarget - shot.keeperX) || shot.keeperSide;
    shot.diveDepth = Math.max(0, Math.min(1, (remaining - SHOT.KEEPER_STAND_ZONE)
      / (shot.maxDive - SHOT.KEEPER_STAND_ZONE)));
    if (shot.keeperBeaten) shot.diveDepth = 1;
  }
  if (shot.keeperDelay > 0) {
    shot.keeperDelay -= h;
    // Short grounded side steps set his feet before committing to the leap.
    const gap = shot.keeperTarget - shot.keeperX;
    const step = 1.8 * shot.keeperAbility.skill * h;
    shot.keeperX += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
  } else if (!shot.keeperLaunched && shot.flightTime < shot.keeperJumpAt) {
    const gap = shot.keeperTarget - shot.keeperX;
    const step = shot.keeperAbility.setSpeed * h;
    shot.keeperX += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
    // Do not consume the dive/recovery while the ball is still far away.
    shot.keeperDive = 0;
    shot.keeperSpent = false;
    shot.keeperGround = 0;
  } else {
    if (!shot.keeperLaunched && shot.flightTime >= shot.keeperJumpAt) {
      // He leaves the ground as the dive starts: a low sprawl barely gets air,
      // a leap for the top corner gets plenty.
      shot.keeperLaunched = true;
      shot.keeperAirV = (SHOT.KEEPER_LEAP + SHOT.KEEPER_LEAP_HIGH * shot.keeperHigh) * shot.diveDepth;
    }

    // He keeps working across his line whatever his feet are doing.
    const gap = shot.keeperTarget - shot.keeperX;
    const step = shot.keeperAbility.diveSpeed * h;
    shot.keeperX += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;

    const airborne = shot.keeperAirV !== 0 || shot.keeperAirY > 0;
    if (airborne) {
      shot.keeperDive = Math.min(shot.diveDepth, shot.keeperDive + h / shot.keeperAbility.diveTime);
      if (shot.keeperDive >= shot.diveDepth) shot.keeperSpent = true;
      shot.keeperAirV += GRAVITY * h;
      shot.keeperAirY += shot.keeperAirV * h;
      if (shot.keeperAirY <= 0) { shot.keeperAirY = 0; shot.keeperAirV = 0; }
    } else if (!shot.keeperSpent) {
      // Still extending, on his feet. Once the dive is complete he is spent.
      shot.keeperDive = Math.min(shot.diveDepth, shot.keeperDive + h / shot.keeperAbility.diveTime);
      if (shot.keeperDive >= shot.diveDepth) shot.keeperSpent = true;
    } else {
      // Down. Take a beat, then push himself back up off the turf.
      shot.keeperDown += h;
      shot.keeperGround = Math.min(1, shot.keeperGround + h / 0.18);
      if (shot.keeperDown > SHOT.RECOVER_DELAY) {
        shot.keeperDive = Math.max(0, shot.keeperDive - SHOT.RECOVER_RATE * h);
      }
    }
  }
  // Standing saves track the actual incoming trajectory, including low bounces.
  // Hands follow this target through real rig joints; no enlarged hit area.
  const tracking = !shot.keeperBeaten && shot.keeperDelay <= 0 && shot.diveDepth < .35 && arrival >= 0 && arrival < .65
    && shot.resolved === null;
  keeperAim.x = ballPos.x + ballVel.x * Math.max(0, arrival);
  keeperAim.y = Math.max(BALL_R, ballPos.y + ballVel.y * Math.max(0, arrival)
    + .5 * GRAVITY * Math.max(0, arrival) ** 2);
  keeperAim.z = keeperZ + .25;
  engine.setKeeper(shot.keeperX, shot.keeperDive, shot.keeperSide, shot.keeperHigh,
    shot.keeperAirY, shot.keeperGround, tracking ? keeperAim : null, shot.keeperDepth);
  if (shot.keeperBeaten && shot.touched === null && shot.resolved === null) keepClearOf(keeperAim, arrival);

  // --- Defenders -----------------------------------------------------------
  // A wall jumps once and lands even after the shot is decided.
  for (let i = 0; shot.wall && i < blockerCount; i++) {
    const b = blockers[i];
    if (b.delay > 0) b.delay -= h;
    else if (!b.jumped) { b.jumped = true; b.vy = WALL.jump; }
    if (b.jumped && (b.airY > 0 || b.vy > 0)) {
      b.vy += GRAVITY * h;
      b.airY = Math.max(0, b.airY + b.vy * h);
    }
    b.x = engine.setBlocker(i, b.baseX, 0, 1, b.airY);
  }
  for (let i = 0; !shot.wall && i < blockerCount && shot.resolved === null; i++) {
    const b = blockers[i];
    if (b.delay > 0) {
      b.delay -= h;
    } else if (!b.spent) {
      const gap = b.target - b.x;
      const step = SHOT.BLOCK_SPEED * (.55 + .75 * shot.defenseStrength) * h;
      b.x += Math.abs(gap) <= step ? gap : Math.sign(gap) * step;
      b.lunge = Math.min(b.depth, b.lunge + h / SHOT.BLOCK_LUNGE_TIME);
      if (b.lunge >= b.depth) b.spent = true;
    } else {
      // Hold the block briefly, then recover the standing posture.
      b.down += h;
      if (b.down > SHOT.RECOVER_DELAY) {
        b.lunge = Math.max(0, b.lunge - SHOT.RECOVER_RATE * h);
      }
    }
    if (b.lowSlide && b.delay <= 0 && b.slideTime < 0 && engine.blockerBallDistance(i) < 8) b.slideTime = 0;
    if (b.slideTime >= 0) b.slideTime += h;
    b.x = engine.setBlocker(i, b.x, b.lunge, b.side, 0, b.slideTime);
  }

  // --- Ball ----------------------------------------------------------------
  prevPos.x = ballPos.x; prevPos.y = ballPos.y; prevPos.z = ballPos.z;
  if (shot.curve !== 0 && shot.touched === null && !shot.bounced) ballVel.x += shot.curve * h;
  stepBall(ballPos, ballVel, h);
  if (prevPos.y > TURF + 1e-4 && ballPos.y <= TURF) {
    shot.bounced = true;
    if (!balanceSimulation && Math.abs(ballVel.y) > .4) audio.play('bounce');
  }
  if (shot.reboundStart < 0 && (shot.bounced || shot.touched !== null)) shot.reboundStart = shot.flightTime;

  if ((shot.resolved === null || missedBallInPlay()) && !shot.entered) updateClearance(h);

  if (shot.resolved === null) tryResolve();

  // --- Netting: a spring-damper the ball sinks into, every substep ---------
  netContact(ballPos, ballVel, h, shot.entered, prevPos);
  hitAdvertisingBoards(prevPos, ballPos, ballVel, h);
}

export function updateClearance(h) {
  shot.clearanceCooldown = Math.max(0, shot.clearanceCooldown - h);
  if (shot.clearer) {
    shot.clearanceTime += h;
    if (shot.clearanceTime >= .28) {
      if (ballPos.y < .45 && engine.clearanceInReach(shot.clearer, ballPos)) {
        const heading = shot.clearer.rig.root.rotation.y;
        ballVel.x = Math.sin(heading) * 18;
        ballVel.z = Math.cos(heading) * 18;
        ballVel.y = 4;
        // Clearing a ball the keeper already stopped does not turn his save into a block.
        if (shot.touched === 'keeper') { shot.contactCool = .05; if (!balanceSimulation) audio.play('block'); }
        else touch('defender', .3);
      }
      shot.clearer = null;
      shot.clearanceCooldown = .8;
    }
  } else if (shot.flightTime > .35 && shot.clearanceCooldown === 0 && ballPos.y < .35
      && Math.hypot(ballVel.x, ballVel.y, ballVel.z) < BALL_PURSUIT.clearanceMaxSpeed
      && Math.abs(ballPos.x) < PITCH.WIDTH / 2 && ballPos.z > GOAL.PLANE_Z) {
    shot.clearer = engine.prepareClearance(ballPos, ballVel);
    shot.clearanceTime = 0;
  }
}

/** What a dead ball was, given the last thing that touched it. */
function terminalOutcome(planeVerdict) {
  if (shot.touched === 'keeper') return 'save';
  if (shot.touched === 'defender') return 'blocked';
  if (shot.touched === 'post' || shot.touched === 'bar') return 'woodwork';
  return planeVerdict === 'HIGH' ? 'high' : 'wide';
}

function touch(what, shakeAmp) {
  if (!balanceSimulation) audio.play(what === 'keeper' ? 'save' : what === 'defender' ? 'block' : what);
  shot.touched = what;
  shot.contactCool = 0.05;
  if (!balanceSimulation) engine.shake(shakeAmp);
}

/**
 * Runs the shot's outcome tests, nearest obstacle first. A deflection does
 * NOT end the chance: the ball stays live off a post, a keeper's hand or a
 * defender's shin, and if it ends up over the line it is a goal like any other.
 */
function tryResolve() {
  if (shot.contactCool > 0) {
    shot.contactCool -= PHYS_DT;
  } else {
    // --- Block: the defenders are nearer, so they get first refusal --------
    if (blockerCount > 0) {
      const blocks = engine.getBlockerCapsules();
      for (let i = 0; i < blocks.length; i++) {
        if (!sweptCapsuleHit(prevPos, ballPos, blocks[i])) continue;
        deflect(blocks[i], SHOT.SAVE_RESTITUTION);
        touch('defender', 0.3);
        return;
      }
    }

    // --- Save: swept ball path vs the keeper's live limb capsules ----------
    const caps = engine.getKeeperCapsules();
    for (let i = 0; i < caps.length; i++) {
      if (!sweptCapsuleHit(prevPos, ballPos, caps[i])) continue;
      // An untouched on-target shot always beats him. The target's clearance and
      // his short dive keep him from reaching it; `ghosted` records it if he ever
      // does (tools/keeper-reach.mjs checks it never happens).
      if (shot.keeperBeaten && shot.touched === null) { shot.ghosted = true; continue; }
      const speed = Math.hypot(ballVel.x, ballVel.y, ballVel.z);
      deflect(caps[i], SHOT.SAVE_RESTITUTION);
      if (speed < shot.keeperAbility.catchSpeed) {
        ballVel.x = ballVel.y = ballVel.z = 0;    // gathered cleanly
        shot.touched = 'keeper';
        resolve('save');
        return;
      }
      parryAway();
      touch('keeper', 0.25);
      return;
    }

    // --- Woodwork ----------------------------------------------------------
    if (hitWoodwork(prevPos, ballPos, ballPos, ballVel)) {
      touch(ballPos.y > GOAL.HEIGHT - 0.5 ? 'bar' : 'post', 0.6);
    }
  }

  // --- Crossing the goal line ----------------------------------------------
  // A crossing inside the frame only marks the ball as having entered; the
  // crossing point is what the target scores. It still has to get the whole
  // way over the line, which the state test below picks up later.
  if (crossedGoalPlane(prevPos.z, ballPos.z)) {
    planeIntersection(prevPos, ballPos, hitPoint);
    const verdict = classifyAtPlane(hitPoint.x, hitPoint.y);
    if (verdict === 'GOAL') {
      shot.entered = true;
      shot.crossX = hitPoint.x;
      shot.crossY = hitPoint.y;
    } else {
      resolve(terminalOutcome(verdict));
      return;
    }
  }

  // --- In the goal ---------------------------------------------------------
  if (shot.entered
      && ballPos.z < GOAL.PLANE_Z - BALL_R
      && Math.abs(ballPos.x) < GOAL.HALF_W
      && ballPos.y < GOAL.HEIGHT) {
    resolve('goal');
    return;
  }

  // Resolve a clearly cleared rebound before waiting for rolling drag.
  const away = ballPos.z > GOAL.PLANE_Z + 6 && ballVel.z > .8;
  shot.awayTimer = shot.reboundStart >= 0 && away ? shot.awayTimer + PHYS_DT : 0;
  const reboundOver = shot.reboundStart >= 0
    && reboundIsOver(ballPos, ballVel, shot.flightTime - shot.reboundStart, shot.awayTimer);

  // --- Dead ball: come to rest, out of play, or simply taking too long -----
  const speed2 = ballVel.x * ballVel.x + ballVel.y * ballVel.y + ballVel.z * ballVel.z;
  shot.restTimer = (speed2 < 0.4 && ballPos.y <= TURF + 0.02) ? shot.restTimer + PHYS_DT : 0;

  if (reboundOver || (!shot.clearer && shot.restTimer > 0.35)
      || Math.abs(ballPos.x) > 34 || ballPos.z > 26
      || shot.flightTime > 6) {
    resolve(terminalOutcome(null));
  }
}

/** Rebounds get at most three seconds; clearances upfield can finish sooner. */
export function reboundIsOver(position, velocity, elapsed, awayFor) {
  return elapsed >= 3 || (elapsed >= .45 && awayFor >= .35
    && position.z > GOAL.PLANE_Z + 6 && velocity.z > .8);
}

export const BALL_PURSUIT = { sprintSpeed: 7.2, attackerRange: 18, clearanceMaxSpeed: 7 };

export function missedBallInPlay() {
  return shot.resolved !== null && shot.resolved !== 'goal'
    && Math.abs(ballPos.x) <= PITCH.WIDTH / 2 + BALL_R
    && ballPos.z >= GOAL.PLANE_Z - BALL_R
    && ballPos.z <= GOAL.PLANE_Z + PITCH.LENGTH + BALL_R;
}

function updateFlight(dt) {
  const continuePlay = missedBallInPlay();
  // Follow only nearby loose rebounds; distant teammates retain their lanes.
  engine.watchBall(dt, shot.resolved === null || continuePlay,
    continuePlay || (shot.resolved === null && (shot.bounced || shot.touched !== null)),
    BALL_PURSUIT, shot.flightTime >= .9, continuePlay);
  engine.faceKeeper(dt, 0);            // square up to dive along the goal line
  if (shot.flightTime > 0.12 && shot.resolved === null && shot.follow < 2.4) {
    shot.follow += 3.4 * dt;
    engine.strikerFollowThrough(dt, 3.4);
  }

  // Follow through, then recover to a standing pose.
  const t = 0.55 + shot.flightTime * 1.8;
  shot.swing = t <= 1 ? t : Math.max(0, 1 - (t - 1) * 0.5);
  engine.setStrikerSwing(shot.swing);

  // Fixed-step accumulator: identical behaviour at 30Hz, 60Hz or 144Hz.
  shot.acc += dt;
  let guard = 0;
  while (shot.acc >= PHYS_DT && guard++ < 300) {
    shot.acc -= PHYS_DT;
    substep(PHYS_DT);
  }

  if (!(engine.formation.attacker?.rig.root === engine.striker.root && engine.formation.attacker.chasing)) {
    engine.setStrikerKick(1, shot.flightTime);
  }
  engine.setBall(ballPos);
  engine.spinBall(ballVel.x, ballVel.z, dt);
  if (shot.resolved === null) {
    if (shot.bounced || shot.touched !== null) engine.followReboundCamera(dt);
    else engine.followShotCamera();
  }

  if (shot.resolved !== null) {
    shot.holdTimer -= dt;
    if (shot.holdTimer <= 0) finishChance();
  }
}

/** Precision tier of a goal: how close its crossing came to the target's centre (round rings).
 * A ball grazing a ring's painted edge counts: TARGET.LENIENCY is added to both radii. */
export function precisionTier(crossX, crossY, target) {
  const off = Math.hypot(crossX - target.x, crossY - target.y) - TARGET.LENIENCY;
  return off <= target.bull ? 'bullseye' : off <= target.ring ? 'target' : 'goal';
}

/**
 * Scores a finished shot and updates hearts, combo and level. Pure run maths.
 * `heart` says the target carried an extra life: a shot inside the ring takes it.
 * `special` multiplies the points; a beaten boss also gives a heart; a bonus
 * round shot costs nothing and leaves the combo and level progress alone; the
 * daily challenge never costs hearts and levels by shot count instead.
 */
export function scoreShot(run, outcome, tier, heart = false, special = null, practice = false) {
  run.shots += 1;
  const bonus = special === 'bonus' || practice;
  run.recoveryHeart = false;
  if (!run.daily) run.assistShots = outcome === 'goal'
    ? Math.max(0, (run.assistShots || 0) - 1) : ADAPTIVE.SHOTS;
  if (outcome !== 'goal') {
    if (!bonus && !run.daily && !run.freeMiss) run.hearts = Math.max(0, run.hearts - 1);
    if (!bonus) run.combo = 0;
    return { points: 0, levelUp: false, extraLife: false };
  }
  run.goals += 1;
  if (!bonus) run.levelGoals += 1;
  const onTarget = tier !== 'goal';
  if (!bonus) run.combo = onTarget ? Math.min(ARCADE.MAX_COMBO, run.combo + 1) : 0;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  if (onTarget) run.targetHits += 1;
  if (tier === 'bullseye') run.bullseyes += 1;
  const multiplier = special ? SPECIALS[special].points : 1;
  const points = Math.round(ARCADE.POINTS[tier] * Math.max(1, run.combo) * multiplier / 10) * 10;
  run.score += points;
  const extraLife = !run.daily && ((heart && onTarget) || special === 'boss') && run.hearts < ARCADE.MAX_HEARTS;
  if (extraLife) { run.hearts += 1; run.extraLives += 1; }
  const levelUp = !run.daily && !bonus && run.levelGoals >= goalsForLevel(run.level);
  if (levelUp) {
    run.level += 1; run.levelGoals = 0;
    if (run.level === 2 || run.level === 3) {
      run.introPending = shotMode === 'pull' ? (run.level === 3 ? 'golden' : null)
        : run.level === 2 ? 'golden' : 'moving';
      if (run.hearts < ARCADE.HEARTS) {
        run.hearts++;
        run.recoveryHeart = true;
      }
    }
  }
  return { points, levelUp, extraLife };
}

/** What a level-up banner says underneath the level. */
function levelNote(run, rankUp) {
  if (shotMode === 'pull' && (run.level === 2 || run.level === 3)) return `${run.level === 2
    ? 'TARGETS! THE KEEPER CAN\'T STOP A SHOT IN THE RING' : 'GOLDEN SHOTS UNLOCKED · x2'}${run.recoveryHeart ? ' · +1 HEART' : ''}`;
  if (run.level === 2 || run.level === 3) return `${run.level === 2
    ? 'GOLDEN SHOTS UNLOCKED · x2' : 'MOVING TARGETS UNLOCKED · x1.5'}${run.recoveryHeart ? ' · +1 HEART' : ''}`;
  if (rankUp) return `NEW RANK: ${progress.rankFor(run.level).name}${run.bossPending ? ' · BOSS KEEPER' : ''}`;
  if (run.bonusLeft) return 'BONUS ROUND: MISSES ARE FREE';
  if (run.bossPending) return 'A BOSS KEEPER IS WAITING';
  const level = run.level;
  return level === 2 ? 'THE KEEPER IS WAKING UP' : level === 5 ? 'DEFENDERS INCOMING'
    : level === 13 ? 'A DEFENDER EVERY TIME' : level === 17 ? 'DOUBLE DEFENCE'
      : level % 3 === 0 ? 'SMALLER TARGETS' : 'THEY ARE GETTING BETTER';
}

function resolve(outcome) {
  shot.resolved = outcome;
  if (balanceSimulation) return;
  const run = state.run;
  engine.cheerCrowd(outcome === 'goal');
  const tier = outcome === 'goal' ? precisionTier(shot.crossX, shot.crossY, aimTarget) : null;
  shot.precision = tier;
  const special = run.special;
  const result = scoreShot(run, outcome, tier, aimTarget.heart, special, run.tutorial);
  if (result.extraLife && special !== 'boss') engine.collectTargetHeart();
  shot.points = result.points;
  run.levelUpPending = result.levelUp;
  if (special) poki.measure('special', special, outcome === 'goal' ? 'complete' : 'fail');

  // Mission counters for this shot; finished missions pay out straight away.
  const goal = outcome === 'goal', onTarget = goal && tier !== 'goal';
  const finished = progress.recordShot(run, {
    goals: goal ? 1 : 0, bullseyes: tier === 'bullseye' ? 1 : 0,
    golden: goal && special === 'golden' ? 1 : 0, hearts: result.extraLife ? 1 : 0,
    moving: onTarget && special === 'moving' ? 1 : 0, freekick: goal && special === 'freekick' ? 1 : 0,
    woodwork: goal && (shot.touched === 'post' || shot.touched === 'bar') ? 1 : 0,
    boss: goal && special === 'boss' ? 1 : 0, bonus: onTarget && special === 'bonus' ? 1 : 0 });
  for (const mission of finished) {
    run.missionsDone.push(mission);
    ui.toast(`MISSION COMPLETE: ${mission.text}`, `+${mission.xp} XP`);
    poki.measure('mission', mission.id, 'complete');
    audio.play('levelUp');
  }

  // A goal gets room to breathe (the celebration, the points); a miss moves on
  // quickly. A tap skips either.
  shot.holdTimer = outcome === 'goal' ? HOLD.GOAL : HOLD.MISS;
  const reactionIndex = Math.floor(Math.random() * engine.REACTIONS.length);
  const reaction = engine.startReaction(outcome === 'goal' ? 'keeper' : 'shooter', engine.REACTIONS[reactionIndex]);
  shot.holdTimer = Math.min(HOLD.REACTION_MAX, Math.max(shot.holdTimer, reaction));

  if (outcome === 'goal') {
    audio.play('net');
    audio.play(tier === 'bullseye' ? 'bigCheer' : 'cheer');
    audio.play(tier === 'goal' ? 'goal' : tier);
    if (run.combo > 1) audio.play('combo', run.combo);
    if (result.extraLife) audio.play('extraLife');
    engine.startDefenderReactions({ sadSpeed: .65, slowMin: .7, slowMax: 1.05 });
    // A different unlocked celebration from last time, when there is a choice.
    const moves = progress.celebrations();
    const choices = moves.length > 1 ? moves.filter(name => name !== run.lastCelebration) : moves;
    run.lastCelebration = choices[Math.floor(Math.random() * choices.length)];
    shot.holdTimer = Math.min(HOLD.CELEBRATION_MAX, Math.max(shot.holdTimer, engine.startCelebration(run.lastCelebration)));
    engine.shake(tier === 'bullseye' ? .7 : .5);
    if (tier !== 'goal') engine.burstTarget(tier);
    const label = special === 'boss' ? 'BOSS BEATEN!' : special === 'freekick' ? 'OVER THE WALL!'
      : tier === 'bullseye' ? 'BULLSEYE!' : tier === 'target' ? 'ON TARGET!' : 'GOAL!';
    const detail = [special === 'boss' && tier !== 'goal' ? tier.toUpperCase() : '',
      special && special !== 'boss' && special !== 'freekick' ? SPECIALS[special].label : '',
      shot.snap ? 'PERFECT SNAP!' : '',
      shot.keeperBeaten && !GOAL_CALLS[shot.touched] ? 'JUST PAST HIS FINGERTIPS!' : '',
      GOAL_CALLS[shot.touched] || '', result.extraLife ? 'EXTRA LIFE!' : ''].filter(Boolean).join('  ');
    ui.flashVerdict(label, tier, `+${result.points}${run.combo > 1 ? `  x${run.combo} COMBO` : ''}`, detail);
  } else {
    if (outcome === 'save') engine.shake(0.25);
    if (outcome === 'blocked') engine.shake(0.3);
    const label = { save: shot.keeperMoment ? 'WHAT A SAVE!' : 'SAVED!', blocked: 'BLOCKED!', woodwork: shot.touched === 'bar' ? 'CROSSBAR!' : 'POST!',
      high: 'OVER!', wide: 'WIDE!' }[outcome];
    ui.flashVerdict(label, 'miss', special === 'bonus' ? 'FREE MISS' : run.daily
      ? `SHOT ${run.shots}/${progress.DAILY_SHOTS}` : run.freeMiss ? 'FREE MISS' : run.hearts > 0 ? '-1 HEART' : 'OUT OF HEARTS',
      shot.weakShot && outcome === 'save' ? 'HIT IT HARDER!' : '');
    audio.play('groan');
    audio.play('miss');
    if (special !== 'bonus' && !run.daily && !run.freeMiss) audio.play('loseHeart');
    if (run.hearts === 1 && !run.daily) audio.play('warning');
  }
  pushHud();
}

function finishChance() {
  const run = state.run;
  engine.stopCelebration();
  engine.stopReactions();
  engine.showTarget(false);
  endSpecial();
  run.special = null;
  if (run.daily ? run.shots >= progress.DAILY_SHOTS : run.hearts <= 0) { gameOver(); return; }
  if (run.tutorial && run.tutorialShots >= COACH_SHOTS) {
    run.tutorial = false;
    progress.setTutorialDone();
    poki.measure('tutorial', 'pull', 'complete');
    audio.play('levelUp');
    ui.showLevelUp('TUTORIAL COMPLETE', 'LEVEL 1 · GO!');
  }
  if (run.levelUpPending) {
    run.levelUpPending = false;
    applyLevelLook();
    audio.play('levelUp');
    poki.measure('level', String(run.level - 1), 'complete');
    poki.measure('level', String(run.level), 'start');
    if (run.level > 4 && run.level % SPECIALS.bonus.every === 0) run.bonusLeft = SPECIALS.bonus.shots;
    if (run.level === 4 || (run.level > 5 && run.level % SPECIALS.boss.every === 0)) run.bossPending = true;
    const rankUp = progress.rankFor(run.level) !== progress.rankFor(run.level - 1);
    ui.showLevelUp(`LEVEL ${run.level}`, levelNote(run, rankUp));
  }
  pushHud();
  beginChance();
}

/* @dev */
// ===========================================================================
// Screen previews (localhost only, stripped from releases): Alt+1..8 opens a
// screen with sample data so it can be checked without playing to it; Alt+0
// returns to play.
// ===========================================================================
const PREVIEW_SPECIALS = ['golden', 'moving', 'freekick', 'boss', 'bonus'];
let previewSpecial = 0;

/** Sample results (nothing is saved): a middling run, or a finished daily. */
function previewResults(daily) {
  poki.gameplayStop();
  state.paused = false;
  audio.setPaused(false);
  engine.showTarget(false);
  engine.showAimRig(false, false);
  ui.showHud(false);
  ui.setDimmed(true);
  setGameplayActive(false);
  state.screen = 'GAMEOVER';
  state.phase = 'IDLE';
  results = {
    run: { ...state.run, daily, mode: daily ? 'daily' : 'arcade', score: daily ? 2400 : 2750, level: daily ? 10 : 5,
      goals: 9, bullseyes: 6, bestCombo: 3, shots: 14, targetHits: 7, continued: false,
      missionsDone: [{ id: 'woodwork1', text: 'SCORE IN OFF THE POST OR BAR', xp: 200 }] },
    isBest: false,
    outcome: { gained: 275, unlocked: daily ? [] : [{ id: 'kit:sky', name: 'SKY BLUE' }], missions: [],
      daily: daily ? { best: 2400, newBest: true, streak: 3 } : null },
  };
  showResults();
}

/** Back to the live chance from any preview. */
function previewBackToPlay() {
  state.screen = 'MATCH';
  state.paused = false;
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  audio.setPaused(false);
  setGameplayActive(true);
  if (state.phase === 'IDLE') beginChance();
}

function previewScreen(key) {
  if (poki.isInBreak()) return;
  if (state.screen === 'GAMEOVER' && key !== 3 && key !== 4 && key !== 5) previewBackToPlay();
  const labels = { 0: 'PLAY', 1: 'STRIKER SELECT', 2: 'PAUSE', 3: 'GAME OVER', 4: 'DAILY RESULTS', 5: 'LOCKER',
    6: 'LEVEL UP / NEW RANK', 7: 'MISSION TOAST', 8: 'SPECIAL CHANCE', 9: 'SHOT MODE' };
  if (!(key in labels)) return;
  if (key === 0) previewBackToPlay();
  if (key === 1) { if (state.screen !== 'SELECT') openStrikerSelect('play'); }
  if (key === 2) { if (state.screen === 'SELECT') previewBackToPlay(); pause(); }
  if (key === 3 || key === 4) previewResults(key === 4);
  if (key === 5) { previewResults(false); openLocker(); }
  if (key === 6) ui.showLevelUp(`LEVEL ${state.run.level + 1}`, `NEW RANK: ${progress.rankFor(state.run.level + 3).name}`);
  if (key === 7) ui.toast('MISSION COMPLETE: SCORE 5 GOALS IN ONE RUN', '+100 XP');
  let label = labels[key];
  if (key === 8 && state.screen === 'MATCH' && !state.paused) {
    // Re-deal the current chance as the next special in the cycle.
    const kind = PREVIEW_SPECIALS[previewSpecial++ % PREVIEW_SPECIALS.length];
    state.forceSpecial = kind;
    if (kind === 'bonus') state.run.bonusLeft = 1;
    engine.stopCelebration();
    beginChance();
    label = `SPECIAL: ${SPECIALS[kind].label}`;
  }
  if (key === 9) {
    if (state.screen !== 'MATCH') previewBackToPlay();
    setShotMode(SHOT_MODES[(SHOT_MODES.indexOf(shotMode) + 1) % SHOT_MODES.length]);
    label = `SHOT MODE: ${shotMode.toUpperCase()}`;
  }
  ui.devTag(`ALT+${key} \u00b7 ${label}`);
}
/* @end-dev */

// ===========================================================================
// Test harness (local only): drives the production shot at a given level.
// ===========================================================================
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Deterministic shot for tools/balance-simulation.mjs: production setup, keeper
 * and defender AI, swept collisions and goal-line verdict, no presentation. */
export function simulateArcadeShotForTest(config) {
  shot.tutorial = false;
  if (!localHost) throw new Error('The balance harness is only available locally');
  balanceSimulation = true;
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  const level = Math.max(1, config.level | 0);
  origin.x = config.x;
  origin.y = GROUND_Y;
  origin.z = GOAL.PLANE_Z + config.range;
  const defence = defenceFor(level, config.range);
  blockerCount = config.blockers ?? defence.blockers;
  shot.defenseStrength = defence.strength;
  shot.wall = false;
  shot.keeperDepth = .75;
  engine.setupChance(origin, blockerCount, false);
  for (let i = 0; i < blockerCount; i++) {
    const src = engine.chance.blockers[i], b = blockers[i];
    b.z = src.z; b.baseX = src.baseX; b.x = src.baseX;
    b.side = 1; b.lunge = 0; b.depth = 1; b.delay = 0; b.down = 0; b.spent = false;
  }
  shot.theta = aimAngleFor(origin, (config.targetX ?? 0) + (config.aimError ?? 0));
  const aimY = (config.targetY ?? 1.35) + (config.heightOffset ?? 0);
  const meterAt = (aimY - SHOT.METER_HEIGHT[0]) / (SHOT.METER_HEIGHT[1] - SHOT.METER_HEIGHT[0]);
  shot.power = Math.max(0, Math.min(1, meterAt + (config.powerError ?? 0)));
  shot.resolved = null;
  shot.preset = false;
  shot.ghosted = false;
  aimTarget.x = config.targetX ?? 0; aimTarget.y = config.targetY ?? 1.35;
  aimTarget.ring = config.ring ?? TARGET.RING_HALF[0]; aimTarget.bull = config.bull ?? TARGET.BULL_HALF[0];
  shot.keeperAbility = keeperAbility(level, Math.hypot(origin.x, config.range), null,
    config.moment ?? Math.random() < ARCADE.KEEPER_MOMENT.odds, config.assisted ?? false);
  const narrow = Math.max(-2.6, Math.min(2.6, origin.x * SHOT.KEEPER_ANGLE_NARROW));
  shot.keeperSetX = narrow + (Math.random() * 2 - 1) * shot.keeperAbility.setSpread;
  shot.keeperX = shot.keeperSetX;
  shot.keeperDive = 0; shot.keeperSide = 1; shot.diveDepth = 1;
  engine.setKeeper(shot.keeperX, 0, 1, 0, 0, 0, null, shot.keeperDepth);
  launch();
  let steps = 0;
  while (shot.resolved === null && steps++ < 2400) substep(PHYS_DT);
  const target = { x: config.targetX ?? 0, y: config.targetY ?? 1.35,
    ring: config.ring ?? TARGET.RING_HALF[0], bull: config.bull ?? TARGET.BULL_HALF[0] };
  const result = { outcome: shot.resolved || 'unresolved', level, blockers: blockerCount,
    beaten: shot.keeperBeaten, ghosted: shot.ghosted, keeperX: shot.keeperSetX,
    keeperSkill: shot.keeperAbility.skill,
    tier: shot.resolved === 'goal' ? precisionTier(shot.crossX, shot.crossY, target) : null };
  engine.stopCelebration();
  engine.stopReactions();
  return result;
}

export function endArcadeSimulationForTest() {
  balanceSimulation = false;
}

// ===========================================================================
// Frame loop and boot
// ===========================================================================
function frame(dt) {
  audio.setFocus(state.phase === 'AIM' || state.phase === 'POWER');
  audio.setPower(state.phase === 'POWER' ? shot.power : null);
  state.elapsed += dt;
  if (state.paused || state.screen !== 'MATCH') return;

  if (state.phase === 'AIM' || state.phase === 'POWER') updateMovingTarget(dt);
  switch (state.phase) {
    case 'AIM':    if (shotMode === 'timing') updateAim(dt); else if (shotMode === 'aim') updateFreeAim(dt); break;
    case 'POWER':  if (shotMode === 'timing') updatePower(dt); else if (shotMode === 'aim') updateFreeAim(dt);
      else if (shotMode === 'drag') updateHoldDrag(dt); else if (shotMode === 'sling') updateSlingshot(dt);
      else if (shotMode === 'pull') updatePull(dt); break;
    case 'WINDUP': updateWindup(dt); break;
    case 'FLIGHT': updateFlight(dt); break;
  }
  engine.setAnimationsPaused(state.phase === 'AIM' || state.phase === 'POWER');
}

async function boot() {
  ui.init();
  const audioSettings = save.loadAudio();
  audio.configure(audioSettings);
  ui.initAudioControls(audioSettings, () => {
    audio.configure(audioSettings);
    save.saveAudio(audioSettings);
  }, audio.play);
  ui.initPauseButton(pause);
  document.addEventListener('pointerdown', audio.unlock, true);
  document.addEventListener('keydown', audio.unlock, true);
  document.addEventListener('visibilitychange', () => {
    audio.visibility();
    if (document.hidden) pause();
  });
  // The page must never scroll inside Poki's frame.
  addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' ', 'Space'].includes(e.key) || e.code === 'Space') e.preventDefault();
  });
  addEventListener('wheel', e => e.preventDefault(), { passive: false });
  addEventListener('contextmenu', e => e.preventDefault());
  await poki.init();
  // Let the static loading screen paint before synchronous scene construction.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const canvas = document.getElementById('pitch');
  engine.init(canvas);
  // A lost graphics context (a phone reclaiming the GPU, a driver reset) cannot
  // be drawn to again safely: pause and explain; the player reloads with TRY
  // AGAIN. No automatic reload: straight after a loss Chrome may refuse a new
  // context ("caused context loss and was blocked"). Progress is saved.
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    pause();
    ui.showLoadingError('THE GRAPHICS WERE RESET. TAP TRY AGAIN TO RELOAD.');
  });
  await Promise.all([engine.loadStriker(), engine.loadBall()]);
  engine.onFrame(frame);
  applyCosmetics();
  if (!progress.striker()) progress.setStriker(progress.randomFreeStriker());
  engine.setStrikerLook(progress.striker());
  // The test hook, for tools/: local development only, never in a release.
  if (localHost) {
    window.__demo = {
      renderer: engine.renderer, scene: engine.scene, camera: engine.camera,
      state, shot, ball: engine.objects.ball, ready: false, audio: audio.status,
      ballState: { position: ballPos, velocity: ballVel },
      target: aimTarget, arcade: ARCADE, prediction, goalsForLevel,
      crowd: engine.crowd, formation: engine.formation,
      matchView: engine.matchView, pixel: engine.pixelLook,
      renderState: engine.renderState,
      dimensions: { goal: GOAL, pitch: PITCH, ballRadius: BALL_R },
      striker: engine.striker, players: engine.players, lastLaunch: engine.lastLaunch,
      poki: { pause, resume, playing: poki.isPlaying },
      progress: progress.debugData, specials: SPECIALS,
      /** The next chance is this special ('golden', 'moving', 'freekick', 'boss', 'bonus'). */
      forceSpecial: kind => { state.forceSpecial = kind; },
      get shotMode() { return shotMode; }, setShotMode,
      /** Ad-break tests: a break before every n-th new run (the game uses 3). */
      setRunsPerBreak: n => { runsPerBreak = n; runsSinceBreak = 0; },
    };
  }

  /* @dev */
  if (localHost) addEventListener('keydown', e => {
    if (!ready || !e.altKey || !/^Digit\d$/.test(e.code)) return;
    e.preventDefault();
    previewScreen(Number(e.code.slice(5)));
  });
  /* @end-dev */
  addEventListener('pointerdown', (e) => {
    if (!ready) return;
    if (e.target.closest('button, .audio-controls')) return;   // overlay controls own their clicks
    shotPointerDown(e);
  });
  addEventListener('pointermove', (e) => { if (ready) shotPointerMove(e); });
  addEventListener('pointerup', (e) => { if (ready) shotPointerUp(e); });
  addEventListener('pointercancel', (e) => { if (ready) shotPointerUp(e); });
  addEventListener('keyup', (e) => { if (ready && !poki.isInBreak()) shotKey(e, false); });
  addEventListener('keydown', (e) => {
    if (!ready || poki.isInBreak()) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((e.code === 'Escape' || e.code === 'KeyP') && state.screen === 'MATCH') {
      e.preventDefault();
      if (state.paused) resume(); else pause();
      return;
    }
    if (state.screen === 'SELECT') {
      const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.code];
      if (step) { e.preventDefault(); ui.stepStriker(step); }
      else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); selectPlay?.(); }
      return;
    }
    if (e.target.closest('button')) return;
    if (e.code.startsWith('Arrow') && state.screen === 'MATCH') shotKey(e, true);
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.repeat) return;
      if (state.paused) resume();
      else if (state.screen === 'GAMEOVER') replay();
      else shotKey(e, true);
    }
  });

  // Straight into the first chance: no menu before play.
  startRun();
  await new Promise(resolve => {
    const afterRender = engine.scene.onAfterRender;
    engine.scene.onAfterRender = function (...args) {
      afterRender.apply(this, args);
      engine.scene.onAfterRender = afterRender;
      resolve();
    };
  });
  await ui.finishLoading();
  engine.startCameraIntro();   // the intro plays once the loading screen is gone
  poki.loadingFinished();
  poki.movePill(ui.scoreBottom() + 8);
  ready = true;
  try { sessionStorage.removeItem('blockstriker.retried'); } catch { /* storage blocked */ }
  if (window.__demo) window.__demo.ready = true;
}

const NO_WEBGL = /webgl|context could not be created/i;
boot().catch(error => {
  console.error('Game startup failed:', error);
  if (NO_WEBGL.test(String(error?.message || error))) {
    ui.showLoadingError('YOUR BROWSER COULD NOT START 3D GRAPHICS. RELOAD THE PAGE; IF THAT FAILS, RESTART THE BROWSER OR TURN ON HARDWARE ACCELERATION.');
    return;
  }
  // A network hiccup while loading: reload once by itself before asking the player.
  let retried = false;
  try { retried = sessionStorage.getItem('blockstriker.retried') === '1'; } catch { /* storage blocked */ }
  if (!retried) {
    try { sessionStorage.setItem('blockstriker.retried', '1'); } catch { /* storage blocked */ }
    location.reload();
    return;
  }
  ui.showLoadingError();
});

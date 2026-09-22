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
import {
  GOAL, PITCH, GROUND_Y, BALL_R, PHYS_DT, GRAVITY, hit,
  launchVector, stepBall, crossedGoalPlane, planeIntersection,
  classifyAtPlane, hitWoodwork, sweptCapsuleHit, reflect, predictCrossing,
  aimAngleFor, netContact, hitAdvertisingBoards, closestPointOnSegment, GROUND_Y as TURF,
} from './physics.js';

// ===========================================================================
// Arcade rules
// ===========================================================================
export const ARCADE = {
  HEARTS: 3,                 // hearts at the start of a run
  MAX_HEARTS: 5,             // extra lives can take you this far
  GOALS_PER_LEVEL: 2,
  POINTS: { bullseye: 300, target: 200, goal: 100 },
  MAX_COMBO: 5,              // consecutive target hits multiply the points
  HEART_ODDS: .2,            // chance a target carries an extra life (never twice running)
  RAMP_LEVELS: 4,            // difficulty eases in over roughly this many levels
  KEEPER_CAP: 1,             // the keeper tops out at this share of the elite profile
};

/** Where the target sits and how big it is: it shrinks as the level rises. */
const TARGET = {
  RING_HALF: [.85, .45],     // half-width at level 1 -> fully ramped
  BULL_HALF: [.42, .2],
  MARGIN_X: .55, MIN_Y: .5, // keep the whole ring inside the goal mouth
  KEEPER_CLEAR: .7,          // the ring's edge stays this far from the keeper's centre, metres
  BULL_CLEAR: 1.7,           // ...and the bullseye centre at least this far: out of his reach
};

const SHOT = {
  BASE_SWEEP: 12.0,         // metres/sec ACROSS the goal plane when fully ramped
  EASY_SWEEP: .62,          // ...and this fraction of it at level 1
  HARD_SWEEP: 1.9,          // ...rising towards this multiple late in a run
  AIM_SPAN: 5.2,            // the arrow sweeps this far past the goal centre
  POWER_CYCLE: [.95, 2],    // power oscillations per second: level 1 -> late in a run
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
const KEEPER_ROOKIE = { reaction: .55, diveSpeed: 2.6, setSpeed: 1.2, readError: 1.1, heightError: .6,
  setSpread: .6, diveTime: .45, catchSpeed: 5, parryBias: .2 };
const KEEPER_ELITE = { reaction: .065, diveSpeed: 10, setSpeed: 5.5, readError: .06, heightError: .045,
  setSpread: .10, diveTime: .18, catchSpeed: 18, parryBias: .82 };

/** 0 at level 1, approaching 1 as the run goes on. */
export const levelRamp = level => 1 - Math.exp(-Math.max(0, level - 1) / ARCADE.RAMP_LEVELS);

/** Keeper ability for a level; distance adds a little on top for long shots. */
export function keeperAbility(level, distance = 10) {
  const ramp = levelRamp(level) * ARCADE.KEEPER_CAP;
  const skill = Math.min(ARCADE.KEEPER_CAP, ramp + Math.max(0, distance - 12) * .01 * ramp);
  const ability = { skill, level };
  for (const key of Object.keys(KEEPER_ROOKIE)) {
    ability[key] = KEEPER_ROOKIE[key] + (KEEPER_ELITE[key] - KEEPER_ROOKIE[key]) * skill;
  }
  return ability;
}

/** Defenders: none early on, then one, then two; slow at first, sharper later. */
export function defenceFor(level, range, random = Math.random) {
  const strength = Math.max(0, Math.min(1, (level - 3) / 5));
  let blockers = 0;
  if (level >= 6) blockers = range > 13 ? (random() < .55 ? 2 : 1) : 1;
  else if (level >= 5) blockers = 1;
  else if (level >= 3) blockers = random() < .45 ? 1 : 0;
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

export const DISTANCE_AIM = { baseRange: 10, increasePerMetre: .05, maxMultiplier: 2.5 };
export function aimDistanceMultiplier(distance) {
  return Math.min(DISTANCE_AIM.maxMultiplier,
    1 + Math.max(0, distance - DISTANCE_AIM.baseRange) * DISTANCE_AIM.increasePerMetre);
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
  screen: 'MATCH',     // MATCH | GAMEOVER
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
const aimTarget = { x: 0, y: 1.2, ring: TARGET.RING_HALF[0], bull: TARGET.BULL_HALF[0], heart: false };

/** Live defender state, one entry per blocker planted on the shot line. */
const blockers = [
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false },
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false },
];
let blockerCount = 0;
let balanceSimulation = false;

const shot = {
  defenseStrength: 0,
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
const sweepSpeed = () => SHOT.BASE_SWEEP * aimSpeedFactor(state.run.level)
  * aimDistanceMultiplier(Math.hypot(origin.x, origin.z - GOAL.PLANE_Z));
const SPEED_SCALE = 1;

// ===========================================================================
// Run lifecycle
// ===========================================================================
/** A fresh run. Boot starts one straight away: no menus before the first shot. */
function startRun() {
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  state.run = {
    score: 0, hearts: ARCADE.HEARTS, level: 1, goals: 0, levelGoals: 0,
    combo: 0, bestCombo: 0, shots: 0, targetHits: 0, bullseyes: 0,
    lastCelebration: undefined, kit: -1, heartOffered: false, extraLives: 0, continued: false,
  };
  applyLevelLook();
  state.screen = 'MATCH';
  state.paused = false;
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  audio.play('kickoff');
  pushHud();
  beginChance();
}

/** Mute and freeze input for an ad; restore afterwards. */
const adPause = () => audio.setMuted(true);
const adResume = () => audio.setMuted(false);

/** PLAY AGAIN: an ad may run first (the player chose to continue), then a new run. */
async function replay() {
  await poki.commercialBreak(adPause, adResume);
  startRun();
  poki.gameplayStart();
}

/** Rewarded continue: one extra heart, once per run, only if the ad completed. */
async function continueRun() {
  const run = state.run;
  if (run.continued) return;
  const success = await poki.rewardedBreak(adPause, adResume);
  if (!success) { ui.dropContinue(); return; }
  run.continued = true;
  run.hearts = 1;
  state.screen = 'MATCH';
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  audio.play('extraLife');
  pushHud();
  beginChance();
  poki.gameplayStart();
}

/** Esc / P / the pause button, and a hidden tab: stop play and show the pause panel. */
function pause() {
  if (state.screen !== 'MATCH' || state.paused || poki.isInBreak()) return;
  state.paused = true;
  poki.gameplayStop();
  audio.setPaused(true);
  engine.setAnimationsPaused(true);
  ui.setDimmed(true);
  ui.showPause({ onResume: resume, onRestart: restart });
}

async function resume() {
  if (!state.paused) return;
  ui.hideOverlay();
  await poki.commercialBreak(adPause, adResume);
  state.paused = false;
  audio.setPaused(false);
  ui.setDimmed(false);
  poki.gameplayStart();
}

async function restart() {
  ui.hideOverlay();
  audio.setPaused(false);
  await poki.commercialBreak(adPause, adResume);
  startRun();
  poki.gameplayStart();
}

/** Every level brings a new opponent kit and pitch. */
function applyLevelLook() {
  const run = state.run;
  let kit = Math.floor(Math.random() * (OPPONENT_COLORS.length - (run.kit < 0 ? 0 : 1)));
  if (run.kit >= 0 && kit >= run.kit) kit++;
  run.kit = kit;
  engine.setMatchColors(OPPONENT_COLORS[kit], Math.floor(Math.random() * 0xffffffff));
  engine.setPitchSurface((run.level - 1) % engine.PITCH_SURFACES.length);
}

function pushHud() {
  const run = state.run;
  // Music builds with the run: level does most of it, a hot combo adds the rest.
  audio.setIntensity(levelRamp(run.level) * 1.4 + run.combo * .06);
  ui.setArcadeHud({ score: run.score, hearts: run.hearts, maxHearts: Math.max(ARCADE.HEARTS, run.hearts), level: run.level,
    combo: run.combo, levelProgress: run.levelGoals / ARCADE.GOALS_PER_LEVEL, best: state.best });
}

function gameOver() {
  const run = state.run;
  const isBest = run.score > state.best;
  if (isBest) { state.best = run.score; save.saveBest(state.best); }
  state.screen = 'GAMEOVER';
  state.phase = 'IDLE';
  poki.gameplayStop();
  engine.showTarget(false);
  engine.showAimRig(false, false);
  engine.frameAmbient();
  ui.showHud(false);
  ui.setDimmed(true);
  audio.play(isBest && run.score > 0 ? 'newBest' : 'gameOver');
  ui.showGameOver({ score: run.score, best: state.best, isBest, level: run.level, goals: run.goals,
    bullseyes: run.bullseyes, bestCombo: run.bestCombo,
    precision: run.shots ? Math.round(100 * run.targetHits / run.shots) : 0,
    onReplay: replay, onContinue: !run.continued && poki.rewardsAvailable() ? continueRun : null });
}

// ===========================================================================
// A chance
// ===========================================================================
function prepareChance() {
  const run = state.run;
  chooseChanceOrigin(origin, run.level);
  const defence = defenceFor(run.level, origin.z - GOAL.PLANE_Z);
  blockerCount = defence.blockers;
  shot.defenseStrength = defence.strength;
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
  if (leftRoom + rightRoom <= 0) out.x = keeperX > 0 ? -spanX : spanX;
  else {
    const pick = random() * (leftRoom + rightRoom);
    out.x = pick < leftRoom ? left[0] + pick : right[0] + (pick - leftRoom);
  }
  const minY = Math.max(TARGET.MIN_Y, out.ring + .08);
  out.y = minY + random() * Math.max(0, GOAL.HEIGHT - out.ring - .08 - minY);
  return out;
}

function beginChance() {
  const run = state.run;
  engine.stopCelebration();
  engine.stopReactions();
  engine.settlePlayers();   // never carry a celebration or reaction pose into the aim
  engine.captureSelectionPoses();
  prepareChance();
  shot.keeperDepth = .75;
  engine.setupChance(origin, blockerCount, false);
  for (let i = 0; i < blockerCount; i++) {
    const src = engine.chance.blockers[i];
    const b = blockers[i];
    b.z = src.z; b.baseX = src.baseX; b.x = src.baseX;
    b.side = 1; b.lunge = 0; b.depth = 1; b.delay = 0; b.down = 0; b.spent = false;
  }
  engine.showAimRig(true, false);

  // The arrow sweeps in goal-plane metres, so a shot from 9m and one from 18m
  // demand the same precision instead of the far one being trivially easy.
  shot.thetaCentre = aimAngleFor(origin, 0);
  shot.aimX = 0;
  shot.theta = shot.thetaCentre;
  shot.sweepDir = Math.random() < 0.5 ? 1 : -1;
  shot.power = 0;
  shot.powerDir = 1;
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
  shot.keeperAbility = keeperAbility(run.level, Math.hypot(origin.x, origin.z - GOAL.PLANE_Z));
  shot.keeperSetX = narrow + (Math.random() * 2 - 1) * shot.keeperAbility.setSpread;
  shot.keeperX = shot.keeperSetX;
  shot.keeperDive = 0;
  shot.keeperSide = 1;
  shot.diveDepth = 1;
  engine.setKeeper(shot.keeperX, 0, 1, 0, 0, 0, null, shot.keeperDepth);
  chooseTarget(aimTarget, run.level, shot.keeperSetX);
  // Now and then the target carries an extra life; never on two targets running.
  aimTarget.heart = !run.heartOffered && run.hearts < ARCADE.MAX_HEARTS && Math.random() < ARCADE.HEART_ODDS;
  run.heartOffered = aimTarget.heart;
  engine.setTarget(aimTarget.x, aimTarget.y, aimTarget.ring, aimTarget.bull, aimTarget.heart);
  engine.showTarget(true);
  engine.restoreSelectionPoses();
  engine.faceStrikerForSelection();

  state.phase = 'AIM';
  ui.setPrompt(run.shots === 0 ? `${ui.pressWord()} TO LOCK YOUR AIM ON THE TARGET` : '');
}

/** Keeps the arena alive while you are aiming. */
function updateAim(dt) {
  // Triangle sweep across the goalmouth, delta-scaled.
  const span = SHOT.AIM_SPAN;
  shot.aimX += shot.sweepDir * sweepSpeed() * dt;
  if (shot.aimX > span)  { shot.aimX = 2 * span - shot.aimX; shot.sweepDir = -1; }
  if (shot.aimX < -span) { shot.aimX = -2 * span - shot.aimX; shot.sweepDir = 1; }
  shot.theta = aimAngleFor(origin, shot.aimX);
  engine.setAim(shot.theta);
}

function updatePower(dt) {
  shot.power += shot.powerDir * powerCycle(state.run.level) * dt;
  if (shot.power > 1) { shot.power = 1; shot.powerDir = -1; }
  if (shot.power < 0) { shot.power = 0; shot.powerDir = 1; }

  // Preview where this power lands on the goal plane.
  predictCrossing(origin, shot.theta, shot.power, SPEED_SCALE, prediction);
  engine.setElevation(Math.max(0.1, prediction.y));
}

/** Input handler: one press per phase; a press during the replay skips it. */
function advance() {
  if (state.screen !== 'MATCH' || state.paused || poki.isInBreak()) return;
  poki.gameplayStart();   // the first press of a session starts gameplay; later calls are no-ops

  if (state.phase === 'AIM') {
    audio.play('aim');
    state.phase = 'POWER';
    engine.showAimRig(true, true);
    ui.setPrompt(state.run.shots === 0 ? `${ui.pressWord()} AGAIN TO SET THE HEIGHT` : '');
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
  const theta = shot.theta;
  ballPos.x = origin.x; ballPos.y = origin.y; ballPos.z = origin.z;
  launchVector(theta, shot.power, SPEED_SCALE, ballVel);
  engine.placeStrikerContact(theta);
  engine.setStrikerKick(1);
  engine.recordStrikerLaunch();

  // Read the arrival at the keeper, with uncertainty and reaction delay. He cannot
  // slide the length of the line either: a dive displaces him KEEPER_MAX_DIVE
  // at most, and his arms have to cover the rest.
  predictCrossing(origin, theta, shot.power, SPEED_SCALE, prediction, engine.keeperLineZ());
  const err = (Math.random() * 2 - 1) * shot.keeperAbility.readError;
  shot.keeperReadX = err;
  shot.keeperReadY = (Math.random() * 2 - 1) * shot.keeperAbility.heightError;
  const read = Math.max(-GOAL.HALF_W - 0.4, Math.min(GOAL.HALF_W + 0.4, prediction.x + err));
  shot.keeperTarget = Math.max(
    shot.keeperSetX - SHOT.KEEPER_MAX_DIVE,
    Math.min(shot.keeperSetX + SHOT.KEEPER_MAX_DIVE, read)
  );
  const travel = Math.abs(shot.keeperTarget - shot.keeperSetX);
  const readY = prediction.y + shot.keeperReadY;
  shot.keeperHigh = Math.max(0, Math.min(1, (readY - 1.05) / 1.3));
  shot.keeperSide = Math.sign(shot.keeperTarget - shot.keeperSetX) || 1;
  // How committed the dive is. A keeper reaching 20cm stays on his feet and
  // blocks with his body; only a full-stretch save goes horizontal.
  shot.diveDepth = Math.max(0, Math.min(1, (travel - SHOT.KEEPER_STAND_ZONE)
    / (SHOT.KEEPER_MAX_DIVE - SHOT.KEEPER_STAND_ZONE)));
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
    predictCrossing(origin, theta, shot.power, SPEED_SCALE, prediction, b.z);
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
  }

  state.phase = 'FLIGHT';
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
    shot.keeperTarget = Math.max(-GOAL.HALF_W + .25, Math.min(GOAL.HALF_W - .25, readX));
    if (arrival <= SHOT.KEEPER_COMMIT_TIME) {
      shot.keeperTarget = Math.max(shot.keeperX - SHOT.KEEPER_MAX_DIVE,
        Math.min(shot.keeperX + SHOT.KEEPER_MAX_DIVE, shot.keeperTarget));
    }
    shot.keeperJumpAt = shot.flightTime + Math.max(0, arrival - SHOT.KEEPER_COMMIT_TIME);
    shot.keeperHigh = Math.max(0, Math.min(1, (readY - 1.05) / 1.3));
    const remaining = Math.abs(shot.keeperTarget - shot.keeperX);
    shot.keeperSide = Math.sign(shot.keeperTarget - shot.keeperX) || shot.keeperSide;
    shot.diveDepth = Math.max(0, Math.min(1, (remaining - SHOT.KEEPER_STAND_ZONE)
      / (SHOT.KEEPER_MAX_DIVE - SHOT.KEEPER_STAND_ZONE)));
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
  const tracking = shot.keeperDelay <= 0 && shot.diveDepth < .35 && arrival >= 0 && arrival < .65
    && shot.resolved === null;
  keeperAim.x = ballPos.x + ballVel.x * Math.max(0, arrival);
  keeperAim.y = Math.max(BALL_R, ballPos.y + ballVel.y * Math.max(0, arrival)
    + .5 * GRAVITY * Math.max(0, arrival) ** 2);
  keeperAim.z = keeperZ + .25;
  engine.setKeeper(shot.keeperX, shot.keeperDive, shot.keeperSide, shot.keeperHigh,
    shot.keeperAirY, shot.keeperGround, tracking ? keeperAim : null, shot.keeperDepth);

  // --- Defenders -----------------------------------------------------------
  for (let i = 0; i < blockerCount && shot.resolved === null; i++) {
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
        touch('defender', .3);
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

/** Precision tier of a goal: how close its crossing came to the target's centre. */
export function precisionTier(crossX, crossY, target) {
  const off = Math.max(Math.abs(crossX - target.x), Math.abs(crossY - target.y));
  return off <= target.bull ? 'bullseye' : off <= target.ring ? 'target' : 'goal';
}

/** Scores a finished shot and updates hearts, combo and level. Pure run maths.
 * `heart` says the target carried an extra life: a shot inside the ring takes it. */
export function scoreShot(run, outcome, tier, heart = false) {
  run.shots += 1;
  if (outcome !== 'goal') {
    run.hearts = Math.max(0, run.hearts - 1);
    run.combo = 0;
    return { points: 0, levelUp: false, extraLife: false };
  }
  run.goals += 1;
  run.levelGoals += 1;
  const onTarget = tier !== 'goal';
  run.combo = onTarget ? Math.min(ARCADE.MAX_COMBO, run.combo + 1) : 0;
  run.bestCombo = Math.max(run.bestCombo, run.combo);
  if (onTarget) run.targetHits += 1;
  if (tier === 'bullseye') run.bullseyes += 1;
  const points = ARCADE.POINTS[tier] * Math.max(1, run.combo);
  run.score += points;
  const extraLife = heart && onTarget && run.hearts < ARCADE.MAX_HEARTS;
  if (extraLife) { run.hearts += 1; run.extraLives += 1; }
  const levelUp = run.levelGoals >= ARCADE.GOALS_PER_LEVEL;
  if (levelUp) { run.level += 1; run.levelGoals = 0; }
  return { points, levelUp, extraLife };
}

function resolve(outcome) {
  shot.resolved = outcome;
  if (balanceSimulation) return;
  const run = state.run;
  engine.cheerCrowd(outcome === 'goal');
  const tier = outcome === 'goal' ? precisionTier(shot.crossX, shot.crossY, aimTarget) : null;
  shot.precision = tier;
  const result = scoreShot(run, outcome, tier, aimTarget.heart);
  if (result.extraLife) engine.collectTargetHeart();
  shot.points = result.points;
  run.levelUpPending = result.levelUp;

  // Short, arcade-paced replays: tap skips them, and they never run long.
  shot.holdTimer = outcome === 'goal' ? 1.6 : .9;
  const reactionIndex = Math.floor(Math.random() * engine.REACTIONS.length);
  const reaction = engine.startReaction(outcome === 'goal' ? 'keeper' : 'shooter', engine.REACTIONS[reactionIndex]);
  shot.holdTimer = Math.min(2.2, Math.max(shot.holdTimer, reaction));

  if (outcome === 'goal') {
    audio.play('net');
    audio.play(tier === 'bullseye' ? 'bigCheer' : 'cheer');
    audio.play(tier === 'goal' ? 'goal' : tier);
    if (run.combo > 1) audio.play('combo', run.combo);
    if (result.extraLife) audio.play('extraLife');
    engine.startDefenderReactions({ sadSpeed: .65, slowMin: .7, slowMax: 1.05 });
    let celebrationIndex = Math.floor(Math.random() * (engine.CELEBRATIONS.length - (run.lastCelebration === undefined ? 0 : 1)));
    if (run.lastCelebration !== undefined && celebrationIndex >= run.lastCelebration) celebrationIndex++;
    run.lastCelebration = celebrationIndex;
    shot.holdTimer = Math.min(3.2, Math.max(shot.holdTimer, engine.startCelebration(engine.CELEBRATIONS[celebrationIndex])));
    engine.shake(tier === 'bullseye' ? .7 : .5);
    const label = tier === 'bullseye' ? 'BULLSEYE!' : tier === 'target' ? 'ON TARGET!' : 'GOAL!';
    const detail = [GOAL_CALLS[shot.touched] || '', result.extraLife ? 'EXTRA LIFE!' : ''].filter(Boolean).join('  ');
    ui.flashVerdict(label, tier, `+${result.points}${run.combo > 1 ? `  x${run.combo} COMBO` : ''}`, detail);
  } else {
    if (outcome === 'save') engine.shake(0.25);
    if (outcome === 'blocked') engine.shake(0.3);
    const label = { save: 'SAVED!', blocked: 'BLOCKED!', woodwork: shot.touched === 'bar' ? 'CROSSBAR!' : 'POST!',
      high: 'OVER!', wide: 'WIDE!' }[outcome];
    ui.flashVerdict(label, 'miss', run.hearts > 0 ? '-1 HEART' : 'OUT OF HEARTS');
    audio.play('groan');
    audio.play('miss');
    audio.play('loseHeart');
    if (run.hearts === 1) audio.play('warning');
  }
  pushHud();
}

function finishChance() {
  const run = state.run;
  engine.stopCelebration();
  engine.stopReactions();
  engine.showTarget(false);
  if (run.hearts <= 0) { gameOver(); return; }
  if (run.levelUpPending) {
    run.levelUpPending = false;
    applyLevelLook();
    audio.play('levelUp');
    ui.showLevelUp(run.level);
  }
  pushHud();
  beginChance();
}

// ===========================================================================
// Test harness (local only): drives the production shot at a given level.
// ===========================================================================
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Deterministic shot for tools/balance-simulation.mjs: production setup, keeper
 * and defender AI, swept collisions and goal-line verdict, no presentation. */
export function simulateArcadeShotForTest(config) {
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
  shot.keeperDepth = .75;
  engine.setupChance(origin, blockerCount, false);
  for (let i = 0; i < blockerCount; i++) {
    const src = engine.chance.blockers[i], b = blockers[i];
    b.z = src.z; b.baseX = src.baseX; b.x = src.baseX;
    b.side = 1; b.lunge = 0; b.depth = 1; b.delay = 0; b.down = 0; b.spent = false;
  }
  shot.theta = aimAngleFor(origin, (config.targetX ?? 0) + (config.aimError ?? 0));
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    predictCrossing(origin, shot.theta, mid, SPEED_SCALE, prediction);
    if (prediction.y < (config.targetY ?? 1.35)) low = mid; else high = mid;
  }
  shot.power = Math.max(0, Math.min(1, (low + high) / 2 + (config.powerError ?? 0)));
  shot.resolved = null;
  shot.keeperAbility = keeperAbility(level, Math.hypot(origin.x, config.range));
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
  audio.setScene(state.screen === 'MATCH' ? 'match' : 'menu');
  audio.setFocus(state.screen === 'MATCH' && (state.phase === 'AIM' || state.phase === 'POWER'));
  audio.setPower(state.screen === 'MATCH' && state.phase === 'POWER' ? shot.power : null);
  state.elapsed += dt;
  if (state.paused) { engine.setAnimationsPaused(true); return; }
  // The pitch keeps playing behind the game-over panel.
  if (state.screen !== 'MATCH') { engine.setAnimationsPaused(false); engine.runAmbient(dt); return; }

  switch (state.phase) {
    case 'AIM':    updateAim(dt); break;
    case 'POWER':  updatePower(dt); break;
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
  engine.init(document.getElementById('pitch'));
  await Promise.all([engine.loadStriker(), engine.loadBall()]);
  engine.onFrame(frame);
  // The test hook, for tools/: local development only, never in a release.
  if (localHost) {
    window.__demo = {
      renderer: engine.renderer, scene: engine.scene, camera: engine.camera,
      state, shot, ball: engine.objects.ball, ready: false, audio: audio.status,
      ballState: { position: ballPos, velocity: ballVel },
      target: aimTarget, arcade: ARCADE, prediction,
      crowd: engine.crowd, formation: engine.formation,
      matchView: engine.matchView, pixel: engine.pixelLook,
      dimensions: { goal: GOAL, pitch: PITCH, ballRadius: BALL_R },
      striker: engine.striker, players: engine.players, lastLaunch: engine.lastLaunch,
      poki: { pause, resume, playing: poki.isPlaying },
    };
  }

  addEventListener('pointerdown', (e) => {
    if (!ready) return;
    if (e.target.closest('button, .audio-controls')) return;   // overlay controls own their clicks
    advance();
  });
  addEventListener('keydown', (e) => {
    if (!ready || poki.isInBreak()) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((e.code === 'Escape' || e.code === 'KeyP') && state.screen === 'MATCH') {
      e.preventDefault();
      if (state.paused) resume(); else pause();
      return;
    }
    if (e.target.closest('button')) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.repeat) return;
      if (state.paused) resume();
      else if (state.screen === 'GAMEOVER') replay();
      else advance();
    }
  });

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
  poki.loadingFinished();
  poki.movePill(ui.scoreBottom() + 8);
  ready = true;
  if (window.__demo) window.__demo.ready = true;
}

boot().catch(error => {
  console.error('Game startup failed:', error);
  ui.showLoadingError();
});

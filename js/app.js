/**
 * app.js - bootstrapper and main application state machine.
 *
 * This module owns ALL game data. The Three.js context in gameEngine.js is a
 * renderer, never a data store: it is told where meshes go and nothing else.
 */
import * as engine from './gameEngine.js';
import * as ui from './uiManager.js';
import * as save from './saveSystem.js';
import {
  GOAL, PITCH, GROUND_Y, BALL_R, PHYS_DT, GRAVITY, hit,
  launchVector, stepBall, crossedGoalPlane, planeIntersection,
  classifyAtPlane, hitWoodwork, sweptCapsuleHit, reflect, predictCrossing,
  aimAngleFor, netContact, hitAdvertisingBoards, closestPointOnSegment, GROUND_Y as TURF,
} from './physics.js';

// ===========================================================================
// Data model
// ===========================================================================
const MAX_LEVEL = 5;

// Portraits and on-pitch looks describe the same eight career identities.
const CHARACTERS = [
  { id: 'barry', name: 'Barry Benchwarmer', portrait: 'assets/portraits/barry.webp',
    tagline: 'Warming benches. Chilling keepers.',
    look: { skin: 0xeac3a0, hair: 0x9d4b1f, style: 'crop',
      build: 1.08, height: 1, beard: 0, moustache: 1, brow: 1 } },
  { id: 'lars', name: 'Lars Offsidesen', portrait: 'assets/portraits/lars.webp',
    tagline: 'Always ahead of his time.',
    look: { skin: 0xf1d0b4, hair: 0xcaa75f, style: 'ponytail',
      build: 0.94, height: 1, beard: 0, moustache: 0, brow: 1 } },
  { id: 'nico', name: 'Nico Nearlyaldo', portrait: 'assets/portraits/nico.webp',
    tagline: 'Almost a living legend.',
    look: { skin: 0xcf9a70, hair: 0x2b1b11, style: 'curls',
      build: 1.03, height: 1, beard: 0.7, moustache: 0, brow: 1 } },
  { id: 'ravi', name: 'Ravi Rocketboots', portrait: 'assets/portraits/ravi.webp',
    tagline: 'No brakes. Questionable steering.',
    look: { skin: 0x96603a, hair: 0x131010, style: 'swept',
      build: 0.97, height: 1, beard: 0.65, moustache: 0, brow: 1 } },
  { id: 'milo', name: 'Milo Misfire', portrait: 'assets/portraits/milo.webp',
    tagline: 'Aiming for greatness. Eventually.',
    look: { skin: 0xa8734e, hair: 0x2b1b11, style: 'floppy',
      build: 1, height: 1, beard: 0, moustache: 0, brow: 1 } },
  { id: 'felix', name: 'Felix Fumble', portrait: 'assets/portraits/felix.webp',
    tagline: 'Trips over the ball. Calls it skill.',
    look: { skin: 0x6d4527, hair: 0x131010, style: 'curls',
      build: 0.96, height: 1, beard: 0, moustache: 0, brow: 1 } },
  { id: 'theo', name: 'Theo Thunderthighs', portrait: 'assets/portraits/theo.webp',
    tagline: 'Leg day is every day.',
    look: { skin: 0x4e3119, hair: 0x131010, style: 'bald',
      build: 1.12, height: 1, beard: 0, moustache: 0, brow: 1 } },
  { id: 'kai', name: 'Kai Crossbar', portrait: 'assets/portraits/kai.webp',
    tagline: 'Has unfinished business with the woodwork.',
    look: { skin: 0xe0b089, hair: 0x131010, style: 'swept',
      build: 0.94, height: 1, beard: 0, moustache: 0, brow: 1 } },
];

const CLOCK = {
  MINUTES_PER_SECOND: 200 / 60, // 200x clock: 90 match minutes in 27 real seconds.
  FULL_TIME: 90,
  TICKER_INTERVAL: 1.5,
};
const MATCH_PLAY = { SPEED: 2, MIN_GAP: 3.5, APPROACH: 2.4 };
const DEFENDER_REACTION = { sadSpeed: .65, slowMin: .7, slowMax: 1.05 };

const ECONOMY = {
  GOAL_PAYOUT: 100,
  BOOT_BONUS: 10,           // per Golden Boot level
  CHARM_COST: 100,
  CHARM_RESTORE: 25,
  LEGACY_PER_GOAL: 10,
};

const MORALE = {
  START: 100,
  BASE_MAX: 100,
  ON_GOAL: +8,
  ON_SAVE: -10,
  ON_MISS: -15,
  ON_BLANK_MATCH: -12,      // a match without a single goal
  SUPER_SUB_AT: 30,
};

const SHOT = {
  BASE_SWEEP: 12.0,         // metres/sec ACROSS the goal plane at Target Practice 1
  AIM_SPAN: 5.2,            // the arrow sweeps this far past the goal centre
  POWER_CYCLE: 1.15,        // power oscillations per second
  WINDUP: 0.28,                   // strike animation before the ball leaves
  KEEPER_REACTION: 0.10,
  KEEPER_SPEED: 8.2,
  KEEPER_SET_SPEED: 3.8,          // grounded repositioning while tracking flight
  KEEPER_COMMIT_TIME: .24,       // extend only shortly before the ball arrives
  KEEPER_READ_ERROR: 0.24,        // lateral uncertainty after seeing the strike
  KEEPER_READ_ERROR_Y: 0.18,
  KEEPER_SET_SPREAD: 0.25,
  KEEPER_ANGLE_NARROW: 0.25,      // how far he shades toward the shooter
  KEEPER_LEAP: 2.8,               // upward launch of a dive, m/s
  KEEPER_LEAP_HIGH: 2.4,          // ...plus this much again for a high one
  RECOVER_DELAY: 0.30,            // beat on the ground before picking himself up
  RECOVER_RATE: 1.7,              // how fast the dive/lunge unwinds afterwards
  KEEPER_STAND_ZONE: 0.70,        // inside this he stays on his feet and blocks
  KEEPER_MAX_DIVE: 1.75,          // a dive displaces the body this far, at most
  KEEPER_DIVE_TIME: 0.25,         // ...and takes this long to fully extend
  SAVE_RESTITUTION: 0.42,
  KEEPER_CATCH_SPEED: 12,    // anything softer than this he simply holds
  KEEPER_PARRY_BIAS: 0.62,   // how hard he steers a parry away from his goal
  DEFLECT_SCATTER: 0.14,     // bodies are not mirrors
  BLOCK_REACTION: 0.13,
  BLOCK_SPEED: 7.0,
  BLOCK_MAX_LUNGE: 1.0,
  BLOCK_LUNGE_TIME: 0.22,
  BLOCK_READ_ERROR: 1.8,
};

/** Where a chance comes from: range to the goal line and how wide it can be. */
const SPOT = { MIN_RANGE: 9, MAX_RANGE: 16, MAX_LATERAL: 11,
  LONG_ODDS: .35, LONG_MIN: 18, LONG_MAX: 25 };

/** How long before a scheduled chance the move that creates it kicks off. */
const BUILDUP_LEAD = 2.4;

const TRAINING = [
  { key: 'poacher', icon: '🦅', name: 'POACHER INSTINCT', base: 150, fx: '+Odds For Extra Chance' },
  { key: 'target',  icon: '🎯', name: 'TARGET PRACTICE',  base: 100, fx: 'Slower Arrow Sweep' },
  { key: 'legday',  icon: '🦵', name: 'LEG DAY',          base: 120, fx: 'Faster Shot Velocity' },
  { key: 'icebath', icon: '🩹', name: 'ICE BATH',         base: 100, fx: 'Corner Shot Magnetism' },
];

const META = [
  { key: 'star',   name: 'STAR PLAYER STATUS', base: 40, fx: 'More chances; L5 guarantees 5 per match' },
  { key: 'subnet', name: 'SUPER SUB',          base: 40, fx: 'Below 30% confidence, chance of a bonus chance' },
  { key: 'talent', name: 'NATURAL TALENT',     base: 30, fx: '+5% baseline shot velocity per level' },
  { key: 'veins',  name: 'ICE IN THE VEINS',   base: 30, fx: '-5% baseline arrow sweep per level' },
  { key: 'pet',    name: "MANAGER'S PET",      base: 35, fx: '+5% confidence ceiling, max 125%' },
  { key: 'boot',   name: 'GOLDEN BOOT',        base: 35, fx: '+$10 per goal per level' },
];

const cost = (def, lvl) => (lvl >= MAX_LEVEL ? null : def.base * (lvl + 1));

const COMMENTARY = [
  'Midfield physical battle in the centre circle...',
  'Offside flag halts the advance.',
  'Keeper claims a hopeful ball into the box.',
  'Your marker is getting tighter by the minute.',
  'Long diagonal switch fizzles out near the touchline.',
  'Referee waves away a penalty shout.',
  'Sloppy giveaway, but the defence mops it up.',
  'Corner comes to nothing. Cleared at the near post.',
  'You drift offside looking for the run in behind.',
  'A crunching tackle sets the tone in midfield.',
  'The crowd whistles for more urgency.',
  'Your winger beats his man but drags the cross long.',
  'Slow build-up down the left. No way through yet.',
  'Manager is up off the bench, arms folded.',
  'A speculative effort from distance sails high.',
];

const BUILDUP_CALLS = [
  'You peel off the shoulder - they are working it forward...',
  'Possession switches to the flank. You start your run...',
  'Quick one-two in midfield. The shape is opening up...',
  'They break at pace. You are already moving...',
  'Patient build-up. You drift into the channel...',
];

/** How a goal went in, keyed by the last thing that touched the ball. */
const GOAL_CALLS = {
  clean:    'You bury it.',
  post:     'Off the inside of the post and IN!',
  bar:      'Off the underside of the bar and down over the line!',
  keeper:   'The keeper gets a hand to it - and it squirms in!',
  defender: 'Deflected in off the defender! He will not care.',
};

const CHANCE_CALLS = [
  'Winger breaks down the flank and crosses into the box!',
  'The ball breaks loose at the edge of the area!',
  'Defensive header drops straight at your feet!',
  'Through ball splits the centre-backs - you are clean in!',
  'Deflection falls kindly. You have a sight of goal!',
  'Cut-back finds you unmarked on the angle!',
  'You spin your marker and the lane opens up!',
];

// ---- Application state ----------------------------------------------------
const state = {
  screen: 'MENU',      // MENU | CHARACTER | MATCH | TRAINING | GAMEOVER
  phase: 'SIM',        // SIM | AIM | POWER | FLIGHT | RESULT
  mode: 'career',      // career | single | practice
  career: save.load(),
  characterSelection: null,
  run: null,
  elapsed: 0,
};

// ---- Per-frame scratch. Nothing here is reallocated inside the loop. ------
const ballPos = { x: 0, y: 0, z: 0 };
const ballVel = { x: 0, y: 0, z: 0 };
const prevPos = { x: 0, y: 0, z: 0 };
const hitPoint = { x: 0, y: 0, z: 0 };
const contactPoint = { x: 0, y: 0, z: 0 };
const prediction = { x: 0, y: 0, t: 0 };
const keeperAim = { x: 0, y: 0, z: 0 };
const origin = { x: 0, y: GROUND_Y, z: 0 };

/** Live defender state, one entry per blocker planted on the shot line. */
const blockers = [
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false },
  { z: 0, baseX: 0, x: 0, target: 0, side: 1, depth: 1, delay: 0, lunge: 0, down: 0, spent: false },
];
let blockerCount = 0;

export const KEEPER_PROGRESS = { distanceScale: 30, perGoal: .24, perMatch: .14 };
const OPENING_KEEPER = {
  fullStrengthMatch: 4, pressureScale: .5,
  reactionDelay: .12, speedReduction: .3, readError: .35,
  heightError: .12, setSpread: .15, diveDelay: .08,
  catchReduction: 3, parryReduction: .15,
};

/** Continuous, bounded progression; evaluated once per chance, never mid-shot. */
export function keeperAbility(distance, goals = 0, match = 1, career = true) {
  const openingEase = career ? Math.max(0, Math.min(1,
    (OPENING_KEEPER.fullStrengthMatch - match) / (OPENING_KEEPER.fullStrengthMatch - 1))) : 0;
  const pressure = (Math.max(0, distance - 10) / KEEPER_PROGRESS.distanceScale
    + Math.max(0, goals) * KEEPER_PROGRESS.perGoal
    + Math.max(0, match - 1) * KEEPER_PROGRESS.perMatch)
    * (1 - openingEase * (1 - OPENING_KEEPER.pressureScale));
  const skill = 1 - Math.exp(-pressure);
  const blend = (base, elite) => base + (elite - base) * skill;
  return {
    skill, distance, goals, match, openingEase,
    reaction: blend(SHOT.KEEPER_REACTION + OPENING_KEEPER.reactionDelay * openingEase, .065),
    diveSpeed: blend(SHOT.KEEPER_SPEED * (1 - OPENING_KEEPER.speedReduction * openingEase), 10),
    setSpeed: blend(SHOT.KEEPER_SET_SPEED * (1 - OPENING_KEEPER.speedReduction * openingEase), 5.5),
    readError: blend(SHOT.KEEPER_READ_ERROR + OPENING_KEEPER.readError * openingEase, .06),
    heightError: blend(SHOT.KEEPER_READ_ERROR_Y + OPENING_KEEPER.heightError * openingEase, .045),
    setSpread: blend(SHOT.KEEPER_SET_SPREAD + OPENING_KEEPER.setSpread * openingEase, .10),
    diveTime: blend(SHOT.KEEPER_DIVE_TIME + OPENING_KEEPER.diveDelay * openingEase, .18),
    catchSpeed: blend(SHOT.KEEPER_CATCH_SPEED - OPENING_KEEPER.catchReduction * openingEase, 18),
    parryBias: blend(SHOT.KEEPER_PARRY_BIAS - OPENING_KEEPER.parryReduction * openingEase, .82),
  };
}

const shot = {
  keeperAbility: keeperAbility(10),
  theta: 0, sweepDir: 1, power: 0, powerDir: 1,
  keeperSetX: 0, keeperX: 0, keeperTarget: 0, keeperDive: 0,
  keeperDelay: 0, keeperSide: 1, diveDepth: 1, keeperHigh: 0,
  aimX: 0, thetaCentre: 0,
  swing: 0, windup: 0, resolved: null, holdTimer: 0, flightTime: 0, acc: 0,
  touched: null, contactCool: 0, restTimer: 0, entered: false, follow: 0, bounced: false,
  reboundStart: -1, awayTimer: 0,
  clearer: null, clearanceTime: 0, clearanceCooldown: 0,
  keeperAirY: 0, keeperAirV: 0, keeperDown: 0, keeperLaunched: false,
  keeperGround: 0, keeperSpent: false,
  keeperReadX: 0, keeperReadY: 0, keeperJumpAt: 0,
};

// ===========================================================================
// Derived stats
// ===========================================================================
const meta = (k) => state.mode === 'career' ? state.career.meta[k] || 0 : 0;
const train = (k) => state.run.training[k] || 0;

const confidenceMax = () => MORALE.BASE_MAX * (1 + 0.05 * meta('pet'));
export const DISTANCE_AIM = { baseRange: 10, increasePerMetre: .05, maxMultiplier: 2.5 };
export function aimDistanceMultiplier(distance) {
  return Math.min(DISTANCE_AIM.maxMultiplier,
    1 + Math.max(0, distance - DISTANCE_AIM.baseRange) * DISTANCE_AIM.increasePerMetre);
}
const sweepSpeed = () => SHOT.BASE_SWEEP * (1 - 0.12 * train('target')) * (1 - 0.05 * meta('veins'))
  * aimDistanceMultiplier(Math.hypot(origin.x, origin.z - GOAL.PLANE_Z));
const speedScale = () => (1 + 0.06 * train('legday')) * (1 + 0.05 * meta('talent'));
const goalPayout = () => ECONOMY.GOAL_PAYOUT + ECONOMY.BOOT_BONUS * meta('boot');
/** Ice Bath: how close to the inside of the post still gets pulled in. */
const magnetMargin = () => 0.18 * train('icebath');

/** Poacher's Instinct + Star Player Status decide the opportunity count. */
function rollChances() {
  const extraChance = Math.min(1, .5 + .1 * train('poacher') + .1 * meta('star'));
  return Math.random() < extraChance ? 5 : 4;
}

// ===========================================================================
// Run lifecycle
// ===========================================================================
/** Save at lifecycle boundaries / navigation, never on every frame. */
function checkpointCareer() {
  if (state.mode !== 'career' || !state.run || !['MATCH', 'TRAINING'].includes(state.screen)) return;
  const pending = state.screen === 'MATCH' && ['AIM', 'POWER', 'WINDUP', 'FLIGHT'].includes(state.phase)
    && shot.resolved === null;
  state.career.activeRun = {
    version: 1, screen: state.screen,
    run: { ...state.run, training: { ...state.run.training }, schedule: state.run.schedule.slice(), building: false },
    pending: pending ? { x: origin.x, y: origin.y, z: origin.z, blockerCount } : null,
    resolved: state.screen === 'MATCH' && state.phase === 'FLIGHT' && shot.resolved !== null,
  };
  save.save(state.career);
}

function careerCheckpoint() {
  const checkpoint = state.career.activeRun;
  const run = checkpoint?.run;
  if (checkpoint?.version !== 1 || !['MATCH', 'TRAINING'].includes(checkpoint.screen) || !run
    || !CHARACTERS.some(character => character.id === run.characterId)) return null;
  if (!['match', 'cash', 'goals', 'matchGoals', 'chancesLeft'].every(key => Number.isSafeInteger(run[key]) && run[key] >= 0)
    || run.match < 1 || run.matchGoals > run.goals || run.chancesLeft > 10
    || !Number.isFinite(run.confidence) || run.confidence < 0 || run.confidence > 125
    || !Number.isFinite(run.clock) || run.clock < 0 || run.clock > 90
    || !Array.isArray(run.schedule) || run.schedule.length > 10
    || !run.schedule.every((minute, i) => Number.isFinite(minute) && minute >= 0 && minute <= 90
      && (i === 0 || minute >= run.schedule[i - 1]))
    || !run.training || !TRAINING.every(({ key }) => Number.isInteger(run.training[key])
      && run.training[key] >= 0 && run.training[key] <= MAX_LEVEL)
    || !Number.isInteger(run.pitchSurface) || !engine.PITCH_SURFACES[run.pitchSurface]
    || !Number.isInteger(run.opponentColors) || !OPPONENT_COLORS[run.opponentColors]
    || !Number.isSafeInteger(run.crowdColorSeed) || run.crowdColorSeed < 0 || run.crowdColorSeed > 0xffffffff) return null;
  const pending = checkpoint.pending;
  if (pending && (checkpoint.screen !== 'MATCH' || ![pending.x, pending.y, pending.z].every(Number.isFinite)
    || Math.abs(pending.x) > SPOT.MAX_LATERAL || pending.y !== GROUND_Y
    || pending.z < GOAL.PLANE_Z + SPOT.MIN_RANGE || pending.z > GOAL.PLANE_Z + SPOT.LONG_MAX
    || !Number.isInteger(pending.blockerCount) || pending.blockerCount < 0 || pending.blockerCount > 2)) return null;
  return checkpoint;
}

function enterCareer() {
  const checkpoint = careerCheckpoint();
  if (!checkpoint) { renderCharacterSelection(); return; }
  state.mode = 'career';
  state.run = { ...checkpoint.run, training: { ...checkpoint.run.training },
    schedule: checkpoint.run.schedule.slice(), building: false, simTime: 0, tickerAt: 0 };
  const character = CHARACTERS.find(player => player.id === state.run.characterId);
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  engine.setStrikerAppearance(character.id);
  engine.setPitchSurface(state.run.pitchSurface);
  engine.setMatchColors(OPPONENT_COLORS[state.run.opponentColors], state.run.crowdColorSeed);
  ui.setCareerIdentity(character);
  state.screen = checkpoint.screen;
  state.phase = 'SIM';
  blockerCount = 0;
  engine.frameAmbient(true);
  ui.showPower(false);
  ui.setPrompt('');
  if (state.run.confidence <= 0) { benched(); return; }
  if (state.screen === 'TRAINING') {
    ui.showHud(false);
    ui.setDimmed(true);
    renderTraining();
    return;
  }
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  pushHud();
  ui.setTicker(Math.floor(state.run.clock), 'Back on the pitch. Your career continues.');
  if (checkpoint.pending) {
    origin.x = checkpoint.pending.x;
    origin.y = checkpoint.pending.y;
    origin.z = checkpoint.pending.z;
    blockerCount = checkpoint.pending.blockerCount;
    beginHighlight(false, true);
  } else if (checkpoint.resolved) {
    finishChance();
  }
}

function startRun(mode = 'career', characterId = null) {
  const character = mode === 'career' ? CHARACTERS.find(player => player.id === characterId) : null;
  if (mode === 'career' && !character) { enterCareer(); return; }
  state.mode = mode;
  engine.setStrikerAppearance(character?.id || null);
  ui.setCareerIdentity(character);
  if (character) {
    state.career.characterId = character.id;
    save.save(state.career);
  }
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  state.run = {
    characterId: character?.id || null,
    match: 1,
    cash: 0,
    confidence: confidenceMaxForNewRun(),
    goals: 0,
    matchGoals: 0,
    training: { poacher: 0, target: 0, legday: 0, icebath: 0 },
    clock: 0,
    chancesLeft: 0,
    schedule: [],
    tickerAt: 0,
    superSubUsed: false,
    building: false,
    buildLine: '',
  };
  startMatch();
  if (mode === 'practice') beginHighlight(false);
}

function confidenceMaxForNewRun() {
  // Career starts at full confidence, ceiling included.
  return MORALE.BASE_MAX * (1 + 0.05 * meta('pet'));
}

export const OPPONENT_COLORS = [
  { name: 'Crimson', kit: 0xc92f43, shorts: 0x20232b, socks: 0xc92f43, accent: 0xf4e8d2,
    keeper: { kit: 0xf2af32, shorts: 0x252b33, socks: 0xf2af32 } },
  { name: 'Ivory', kit: 0xeee9db, shorts: 0x37333a, socks: 0xeee9db, accent: 0xb62e42,
    keeper: { kit: 0xef8235, shorts: 0x27222d, socks: 0xef8235 } },
  { name: 'Gold', kit: 0xf2c344, shorts: 0x28272b, socks: 0xf2c344, accent: 0x28272b,
    keeper: { kit: 0xd35b9d, shorts: 0x302439, socks: 0xd35b9d } },
  { name: 'Forest', kit: 0x268153, shorts: 0xece9db, socks: 0x268153, accent: 0xece9db,
    keeper: { kit: 0xf28a36, shorts: 0x2a2630, socks: 0xf28a36 } },
  { name: 'Plum', kit: 0x963966, shorts: 0xe8e3db, socks: 0x963966, accent: 0xe8e3db,
    keeper: { kit: 0xd8da4c, shorts: 0x292c32, socks: 0xd8da4c } },
];

function startMatch() {
  const run = state.run;
  run.pitchSurface = Math.floor(Math.random() * engine.PITCH_SURFACES.length);
  engine.setPitchSurface(run.pitchSurface);
  // Draw a different opponent palette for the next fixture in this run.
  const previousColors = run.opponentColors;
  let colors = Math.floor(Math.random() * (OPPONENT_COLORS.length - (previousColors === undefined ? 0 : 1)));
  if (previousColors !== undefined && colors >= previousColors) colors++;
  run.opponentColors = colors;
  run.crowdColorSeed = Math.floor(Math.random() * 0xffffffff);
  engine.setMatchColors(OPPONENT_COLORS[colors], run.crowdColorSeed);
  run.clock = 0;
  run.matchGoals = 0;
  run.tickerAt = 0;
  run.superSubUsed = false;
  run.building = false;
  run.simTime = 0;
  run.chancesLeft = rollChances();

  // Spread the opportunities across the 90 with a little jitter.
  const n = run.chancesLeft;
  run.schedule = [];
  for (let i = 0; i < n; i++) {
    const slot = 14 + (66 / n) * i + Math.random() * (50 / n);
    run.schedule.push(Math.min(88, Math.round(slot)));
  }
  run.schedule.sort((a, b) => a - b);

  state.screen = 'MATCH';
  state.phase = 'SIM';
  ui.hideOverlay();
  ui.showHud(true);
  ui.setDimmed(false);
  ui.showPower(false);
  ui.setPrompt('');
  blockerCount = 0;
  engine.frameAmbient(true);
  pushHud();
  ui.setTicker(0, 'Kick-off. You are on the shoulder of the last defender.');
  checkpointCareer();
}

function endMatch() {
  const run = state.run;
  if (state.mode === 'single') return finishSingleMatch();
  if (run.matchGoals === 0) adjustConfidence(MORALE.ON_BLANK_MATCH);

  if (run.confidence <= 0) return benched();

  state.screen = 'TRAINING';
  ui.showHud(false);
  ui.setDimmed(true);
  renderTraining();
}

function benched() {
  if (state.mode !== 'career') return finishSingleMatch();
  const run = state.run;
  const earned = run.goals * ECONOMY.LEGACY_PER_GOAL;
  const matches = run.match;
  const isBest = run.match > state.career.bestRun;

  state.career.legacy += earned;
  state.career.lifetimeGoals += run.goals;
  state.career.runs += 1;
  state.career.bestRun = Math.max(state.career.bestRun, run.match);
  delete state.career.activeRun;
  save.save(state.career);

  state.screen = 'GAMEOVER';
  ui.showHud(false);
  ui.setDimmed(true);
  ui.showGameOver({
    matches, goals: run.goals, rate: ECONOMY.LEGACY_PER_GOAL, earned, isBest,
    onMenu: renderMenu,
    onUpgrades: () => renderMeta(),
  });
}

function adjustConfidence(delta) {
  if (state.mode !== 'career') return;
  const run = state.run;
  run.confidence = Math.max(0, Math.min(confidenceMax(), run.confidence + delta));
}

function pushHud() {
  const run = state.run;
  ui.setScore(run.match, Math.floor(run.clock), run.goals, state.mode);
}

// ===========================================================================
// SIMULATING state
// ===========================================================================
function updateSim(dt) {
  const run = state.run;
  run.simTime += dt;
  const next = run.schedule[0];
  run.clock = Math.min(next ?? CLOCK.FULL_TIME, run.clock + dt * CLOCK.MINUTES_PER_SECOND);

  if (run.clock >= CLOCK.FULL_TIME && run.simTime >= MATCH_PLAY.MIN_GAP) {
    run.clock = CLOCK.FULL_TIME;
    pushHud();
    endMatch();
    return;
  }
  pushHud();

  // Banner refresh on a real-time cadence, independent of the match clock.
  // During a build-up the line is held, but its minute stamp is re-issued so
  // it does not read as stale while the compressed clock races on.
  run.tickerAt -= dt;
  if (run.tickerAt <= 0) {
    run.tickerAt = run.building ? 0.4 : CLOCK.TICKER_INTERVAL;
    ui.setTicker(Math.floor(run.clock),
      run.building ? run.buildLine : COMMENTARY[(Math.random() * COMMENTARY.length) | 0]);
  }

  // Start the move that creates the next chance, timed so its final pass
  // lands on the striker exactly as the clock hits the scheduled minute.
  if (next !== undefined && !run.building) {
    const secondsAway = (next - run.clock) / CLOCK.MINUTES_PER_SECOND;
    if (secondsAway <= BUILDUP_LEAD && run.simTime >= MATCH_PLAY.MIN_GAP) {
      run.building = true;
      prepareChance();
      engine.startBuildup(origin, MATCH_PLAY.APPROACH, blockerCount);
      run.buildLine = BUILDUP_CALLS[(Math.random() * BUILDUP_CALLS.length) | 0];
      ui.setTicker(Math.floor(run.clock), run.buildLine);
      run.tickerAt = 0.4;
    }
  }

  if (run.building) {
    if (engine.runBuildup(dt)) {
      run.schedule.shift();
      run.building = false;
      beginHighlight(true);
    }
  } else {
    engine.runMatchSimulation(dt, MATCH_PLAY.SPEED);
  }
}

// ===========================================================================
// HIGHLIGHT state
// ===========================================================================
/**
 * Chooses where the next chance will fall. Called at the START of the move
 * that creates it, so the build-up has a spot to deliver the ball to.
 */
export function chooseChanceOrigin(target, random = Math.random) {
  const longShot = random() < SPOT.LONG_ODDS;
  const range = longShot ? SPOT.LONG_MIN + random() * (SPOT.LONG_MAX - SPOT.LONG_MIN)
    : SPOT.MIN_RANGE + random() * (SPOT.MAX_RANGE - SPOT.MIN_RANGE);
  const lateral = Math.min(SPOT.MAX_LATERAL, range * 0.85);
  target.x = (random() * 2 - 1) * lateral;
  target.y = GROUND_Y;
  target.z = GOAL.PLANE_Z + range;
}

function prepareChance() {
  chooseChanceOrigin(origin);
  const range = origin.z - GOAL.PLANE_Z;

  // Tighter chances draw a crowd; a clean breakaway does not.
  blockerCount = range > 15 ? (Math.random() < 0.55 ? 2 : 1)
                : range > 12 ? 1
                : Math.random() < 0.5 ? 1 : 0;
}

function beginHighlight(soft, restored = false) {
  const run = state.run;
  engine.captureSelectionPoses();
  // Clock freezes and the arena brightens instantly.
  ui.setDimmed(false);
  ui.setTicker(Math.floor(run.clock), CHANCE_CALLS[(Math.random() * CHANCE_CALLS.length) | 0]);

  if (!soft && !restored) prepareChance();
  engine.setupChance(origin, blockerCount, soft);
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
  shot.holdTimer = 0;
  shot.flightTime = 0;
  shot.bounced = false;
  shot.reboundStart = -1;
  shot.awayTimer = 0;
  shot.acc = 0;
  // A real keeper narrows the angle: he shades along his line toward the
  // shooter rather than standing centrally and waiting, so a chance from wide
  // gives you far less of the goal to aim at than the raw geometry suggests.
  const narrow = Math.max(-2.6, Math.min(2.6, origin.x * SHOT.KEEPER_ANGLE_NARROW));
  shot.keeperAbility = keeperAbility(Math.hypot(origin.x, origin.z - GOAL.PLANE_Z),
    run.matchGoals, run.match, state.mode === 'career');
  shot.keeperSetX = narrow + (Math.random() * 2 - 1) * shot.keeperAbility.setSpread;
  shot.keeperX = shot.keeperSetX;
  shot.keeperDive = 0;
  shot.keeperSide = 1;
  shot.diveDepth = 1;
  engine.setKeeper(shot.keeperX, 0, 1);
  engine.restoreSelectionPoses();
  engine.faceStrikerForSelection();

  state.phase = 'AIM';
  ui.setPrompt('Tap / Space to lock aim');
  queueMicrotask(checkpointCareer);
}

/** Keeps the arena alive while the clock is frozen and you are aiming. */
function updateAim(dt) {
  // Triangle sweep across the goalmouth, delta-scaled.
  shot.aimX += shot.sweepDir * sweepSpeed() * dt;
  if (shot.aimX > SHOT.AIM_SPAN)  { shot.aimX = 2 * SHOT.AIM_SPAN - shot.aimX; shot.sweepDir = -1; }
  if (shot.aimX < -SHOT.AIM_SPAN) { shot.aimX = -2 * SHOT.AIM_SPAN - shot.aimX; shot.sweepDir = 1; }
  shot.theta = aimAngleFor(origin, shot.aimX);
  engine.setAim(shot.theta);
}

function updatePower(dt) {
  shot.power += shot.powerDir * SHOT.POWER_CYCLE * dt;
  if (shot.power > 1) { shot.power = 1; shot.powerDir = -1; }
  if (shot.power < 0) { shot.power = 0; shot.powerDir = 1; }
  ui.setPower(shot.power);

  // Preview where this power lands on the goal plane.
  predictCrossing(origin, shot.theta, shot.power, speedScale(), prediction);
  engine.setElevation(Math.max(0.1, prediction.y));
}

/** Input handler: one press per phase. */
function advance() {
  if (state.screen !== 'MATCH') return;

  if (state.phase === 'AIM') {
    state.phase = 'POWER';
    engine.showAimRig(true, true);
    ui.showPower(true);
    ui.setPrompt('Tap / Space to set power');
    return;
  }
  if (state.phase === 'POWER') {
    ui.showPower(false);
    ui.setPrompt('');
    engine.showAimRig(false, false);
    engine.placeStrikerContact(shot.theta);
    shot.windup = 0;
    state.phase = 'WINDUP';
  }
}

function launch() {
  let theta = shot.theta;

  // Ice Bath: a shot already creeping toward the inside of a post gets a
  // subtle tracking curve into the side netting.
  const margin = magnetMargin();
  if (margin > 0) {
    predictCrossing(origin, theta, shot.power, speedScale(), prediction);
    const fromPost = GOAL.HALF_W - Math.abs(prediction.x);
    if (fromPost > 0 && fromPost < margin + 0.55) {
      const pull = Math.sign(prediction.x || 1) * (margin * 0.5);
      theta = aimAngleFor(origin, prediction.x + pull);
    }
  }

  ballPos.x = origin.x; ballPos.y = origin.y; ballPos.z = origin.z;
  launchVector(theta, shot.power, speedScale(), ballVel);
  engine.placeStrikerContact(theta);
  engine.setStrikerKick(1);
  engine.recordStrikerLaunch();

  // Read the arrival at the keeper, with modest uncertainty and reaction delay. He cannot
  // slide the length of the line either: a dive displaces him KEEPER_MAX_DIVE
  // at most, and his arms have to cover the rest.
  predictCrossing(origin, theta, shot.power, speedScale(), prediction, engine.keeperLineZ());
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
  // blocks with his body; only a full-stretch save goes horizontal. Without
  // this he threw himself sideways out of the way of every central shot.
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
    predictCrossing(origin, theta, shot.power, speedScale(), prediction, b.z);
    const guess = prediction.x + (Math.random() * 2 - 1) * SHOT.BLOCK_READ_ERROR;
    b.target = Math.max(b.baseX - SHOT.BLOCK_MAX_LUNGE,
                        Math.min(b.baseX + SHOT.BLOCK_MAX_LUNGE, guess));
    b.side = Math.sign(b.target - b.baseX) || 1;
    b.depth = Math.min(1, Math.abs(b.target - b.baseX) / SHOT.BLOCK_MAX_LUNGE);
    b.delay = SHOT.BLOCK_REACTION;
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
  engine.setKeeper(shot.keeperSetX, 0, shot.keeperSide, 0, 0);
  if (shot.windup >= SHOT.WINDUP) launch();
}

/**
 * Push the ball clear of a limb it just struck and bounce it off.
 *
 * The contact is resolved against the ball's CURRENT position rather than the
 * swept closest-approach point: snapping it back to where the paths were
 * nearest can shove the ball backwards along its own line, which is what made
 * deflections look wrong.
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
 * from his goal, wide and up. Rebounds can still squirm in, but shooting
 * straight at him stops being the best idea in the game.
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
    const step = 1.8 * h;
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

    // He keeps working across his line whatever his feet are doing - a small
    // adjustment is made standing up, and gating this on being airborne left
    // him rooted for any shot too close to need a dive.
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
      // Still extending, on his feet. Once the dive is complete he is spent -
      // without that latch the recovery below decays the dive, this branch
      // sees it dip under diveDepth and winds it straight back up, and he
      // never gets off the floor.
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
    shot.keeperAirY, shot.keeperGround, tracking ? keeperAim : null);

  // --- Defenders -----------------------------------------------------------
  for (let i = 0; i < blockerCount && shot.resolved === null; i++) {
    const b = blockers[i];
    if (b.delay > 0) {
      b.delay -= h;
    } else if (!b.spent) {
      const gap = b.target - b.x;
      const step = SHOT.BLOCK_SPEED * h;
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
  if (prevPos.y > TURF + 1e-4 && ballPos.y <= TURF) shot.bounced = true;
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

/**
 * Decides what a dead ball was, given the last thing that touched it. A shot
 * the keeper pushed wide is a save, not a miss.
 */
function terminalOutcome(planeVerdict) {
  if (shot.touched === 'keeper') return 'save';
  if (shot.touched === 'defender') return 'blocked';
  if (shot.touched === 'post' || shot.touched === 'bar') return 'woodwork';
  return planeVerdict === 'HIGH' ? 'high' : 'wide';
}

function touch(what, shakeAmp) {
  shot.touched = what;
  shot.contactCool = 0.05;
  engine.shake(shakeAmp);
}

/**
 * Runs the shot's outcome tests, nearest obstacle first.
 *
 * A deflection does NOT end the chance: the ball stays live off a post, a
 * keeper's hand or a defender's shin, and if it ends up over the line it is a
 * goal like any other.
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
      return;
    }
  }

  // --- Crossing the goal line ----------------------------------------------
  // A crossing inside the frame is not resolved here: it only marks the ball
  // as having entered. It still has to get the whole way over the line, which
  // the state test below picks up on a later substep.
  if (crossedGoalPlane(prevPos.z, ballPos.z)) {
    planeIntersection(prevPos, ballPos, hitPoint);
    const verdict = classifyAtPlane(hitPoint.x, hitPoint.y);
    if (verdict === 'GOAL') {
      shot.entered = true;
    } else {
      resolve(terminalOutcome(verdict));
      return;
    }
  }

  // --- In the goal ---------------------------------------------------------
  // Requires a legitimate entry through the mouth AND the whole ball over the
  // line. Occupying the volume is not enough on its own: a ball shoved clear
  // of the inside of a post, which stands ON the line, lands in that volume
  // without ever having crossed.
  if (shot.entered
      && ballPos.z < GOAL.PLANE_Z - BALL_R
      && Math.abs(ballPos.x) < GOAL.HALF_W
      && ballPos.y < GOAL.HEIGHT) {
    resolve('goal');
    return;
  }

  // Resolve a clearly cleared rebound before waiting for rolling drag. Keep
  // near-goal ricochets alive, but bound the entire rebound sequence (further
  // contacts never reset its clock). Goal entry is checked above this limit.
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
  if (shot.resolved === null && (shot.bounced || shot.touched !== null)) engine.followReboundCamera(dt);
  engine.faceKeeper(dt, 0);            // square up to dive along the goal line
  if (shot.flightTime > 0.12 && shot.resolved === null && shot.follow < 2.4) {
    const stride = 3.4 * dt;
    shot.follow += stride;
    engine.strikerFollowThrough(dt, 3.4);
  }

  // Follow through, then recover to a standing pose instead of holding the
  // leg out in the air for the rest of the replay.
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

  if (shot.resolved !== null) {
    shot.holdTimer -= dt;
    if (shot.holdTimer <= 0) finishChance();
  }
}

function resolve(outcome) {
  const run = state.run;
  shot.resolved = outcome;
  engine.cheerCrowd(outcome === 'goal');
  shot.holdTimer = outcome === 'goal' ? 1.7 : .8;
  const reactionIndex = Math.floor(Math.random() * engine.REACTIONS.length);
  const reactionDuration = engine.startReaction(outcome === 'goal' ? 'keeper' : 'shooter', engine.REACTIONS[reactionIndex]);
  shot.holdTimer = Math.max(shot.holdTimer, reactionDuration);
  run.chancesLeft = Math.max(0, run.chancesLeft - 1);

  if (outcome === 'goal') {
    engine.startDefenderReactions(DEFENDER_REACTION);
    let celebrationIndex = Math.floor(Math.random() * (engine.CELEBRATIONS.length - (run.lastCelebration === undefined ? 0 : 1)));
    if (run.lastCelebration !== undefined && celebrationIndex >= run.lastCelebration) celebrationIndex++;
    run.lastCelebration = celebrationIndex;
    shot.holdTimer = Math.max(shot.holdTimer, engine.startCelebration(engine.CELEBRATIONS[celebrationIndex]));
    run.goals += 1;
    run.matchGoals += 1;
    if (state.mode === 'career') run.cash += goalPayout();
    adjustConfidence(MORALE.ON_GOAL);
    engine.shake(0.5);
    ui.flashVerdict(shot.touched ? 'IN OFF!' : 'GOAL', 'goal');
    ui.setTicker(Math.floor(run.clock), `${GOAL_CALLS[shot.touched] || GOAL_CALLS.clean}${state.mode === 'career' ? ` <b>+$${goalPayout()}</b>.` : ''}`);
  } else if (outcome === 'save') {
    adjustConfidence(MORALE.ON_SAVE);
    engine.shake(0.25);
    ui.flashVerdict('SAVED', 'save');
    ui.setTicker(Math.floor(run.clock), 'The keeper gets a strong hand to it.');
  } else if (outcome === 'woodwork') {
    adjustConfidence(MORALE.ON_MISS);
    ui.flashVerdict('WOODWORK', 'save');
    ui.setTicker(Math.floor(run.clock), shot.touched === 'bar'
      ? 'Off the crossbar and away. Inches.'
      : 'Off the post and back out. Agonising.');
  } else if (outcome === 'blocked') {
    adjustConfidence(MORALE.ON_SAVE);
    engine.shake(0.3);
    ui.flashVerdict('BLOCKED', 'save');
    ui.setTicker(Math.floor(run.clock), 'A defender throws himself in the way.');
  } else if (outcome === 'high') {
    adjustConfidence(MORALE.ON_MISS);
    ui.flashVerdict('OVER', 'miss');
    ui.setTicker(Math.floor(run.clock), 'Leant back and blazed it over the bar.');
  } else {
    adjustConfidence(MORALE.ON_MISS);
    ui.flashVerdict('MISSED', 'miss');
    ui.setTicker(Math.floor(run.clock), 'Dragged wide. The manager turns away.');
  }
  pushHud();
  queueMicrotask(checkpointCareer);
}

function finishChance() {
  const run = state.run;
  engine.stopCelebration();
  engine.stopReactions();

  if (state.mode === 'practice') {
    ui.showPower(false);
    beginHighlight(false);
    return;
  }

  if (run.confidence <= 0) { benched(); return; }

  trySuperSub();

  // Cut overhead immediately, then play through the gap before the next move.
  state.phase = 'SIM';
  blockerCount = 0;
  run.building = false;
  run.simTime = 0;
  engine.frameAmbient(true);
  ui.setDimmed(false);
  ui.setPrompt('');
  run.tickerAt = 0;
  pushHud();
  queueMicrotask(checkpointCareer);
}

/** Super Sub / Safety Net: a survival roll once morale is critical. */
function trySuperSub() {
  const run = state.run;
  const lvl = meta('subnet');
  if (!lvl || run.superSubUsed) return;
  if (run.confidence >= MORALE.SUPER_SUB_AT) return;
  if (run.schedule.length > 0) return;   // only when nothing is left to play for

  run.superSubUsed = true;
  if (Math.random() < 0.1 * lvl) {
    const at = Math.min(88, Math.floor(run.clock) + 4 + Math.floor(Math.random() * 10));
    run.schedule.push(at);
    run.chancesLeft += 1;
    ui.setTicker(Math.floor(run.clock), 'The manager gives you one last roll of the dice...');
  }
}

// ===========================================================================
// Screens
// ===========================================================================
function renderCharacterSelection() {
  state.screen = 'CHARACTER';
  state.run = null;
  state.mode = 'career';
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  engine.frameAmbient();
  ui.showHud(false);
  ui.setDimmed(true);
  const selected = CHARACTERS.find(player => player.id === state.career.characterId) || CHARACTERS[0];
  state.characterSelection = selected.id;
  engine.setStrikerAppearance(selected.id);
  ui.showCharacterSelection({
    characters: CHARACTERS, selectedId: selected.id,
    onSelect: id => {
      state.characterSelection = id;
      engine.setStrikerAppearance(id);
    },
    onStart: () => startRun('career', state.characterSelection),
    onBack: renderMenu,
  });
}

function renderMenu() {
  checkpointCareer();
  state.screen = 'MENU';
  state.run = null;
  state.mode = 'career';
  state.characterSelection = null;
  engine.setStrikerAppearance();
  engine.stopCelebration();
  engine.stopReactions();
  engine.setAnimationsPaused(false);
  engine.frameAmbient();
  ui.showHud(false);
  ui.setDimmed(true);
  const checkpoint = careerCheckpoint();
  const character = checkpoint && CHARACTERS.find(player => player.id === checkpoint.run.characterId);
  ui.showMainMenu({
    onCareer: enterCareer,
    resume: checkpoint ? `${character.name} · Match ${checkpoint.run.match}` : null,
    hasProgress: !!checkpoint || !!state.career.characterId
      || state.career.legacy > 0 || state.career.runs > 0
      || state.career.bestRun > 0 || state.career.lifetimeGoals > 0
      || META.some(({ key }) => state.career.meta[key] > 0),
    onSingle: () => startRun('single'),
    onPractice: () => startRun('practice'),
    onReset: () => ui.showConfirmation('RESET PROGRESS?',
      'Permanently erase your legacy points, upgrades, and career records?',
      () => { state.career = save.wipe(); renderMenu(); }, renderMenu),
  });
}

function finishSingleMatch() {
  state.screen = 'GAMEOVER';
  ui.showHud(false);
  ui.setDimmed(true);
  ui.showSingleResult({ goals: state.run.matchGoals,
    onReplay: () => startRun('single'), onMenu: renderMenu });
}

function renderMeta(preserveRun = false) {
  checkpointCareer();
  state.screen = 'MENU';
  if (!preserveRun) state.run = null;
  ui.showHud(false);
  ui.setDimmed(true);
  blockerCount = 0;
  engine.frameAmbient();

  ui.showMenu({
    legacy: state.career.legacy,
    runs: state.career.runs,
    bestRun: state.career.bestRun,
    lifetimeGoals: state.career.lifetimeGoals,
    rows: META.map((def) => {
      const lvl = state.career.meta[def.key];
      const c = cost(def, lvl);
      return {
        name: def.name, level: lvl, max: MAX_LEVEL, fx: def.fx,
        cost: c, currency: 'LP', affordable: c !== null && state.career.legacy >= c,
        onBuy: () => {
          if (c === null || state.career.legacy < c) return;
          state.career.legacy -= c;
          state.career.meta[def.key] = lvl + 1;
          save.save(state.career);
          renderMeta(true);
        },
      };
    }),
    onWipe: () => {
      state.career = save.wipe();
      renderMenu();
    },
    onStart: () => startRun('career'),
    onMenu: renderMenu,
  });
}

function renderTraining() {
  checkpointCareer();
  const run = state.run;
  ui.showTraining({
    onMenu: renderMenu,
    match: run.match,
    matchGoals: run.matchGoals,
    cash: run.cash,
    confidence: run.confidence,
    confidenceMax: confidenceMax(),
    charmCost: ECONOMY.CHARM_COST,
    charmRestore: ECONOMY.CHARM_RESTORE,
    charmAffordable: run.cash >= ECONOMY.CHARM_COST && run.confidence < confidenceMax(),
    rows: TRAINING.map((def) => {
      const lvl = run.training[def.key];
      const c = cost(def, lvl);
      return {
        icon: def.icon, name: def.name, level: lvl, max: MAX_LEVEL, fx: def.fx,
        cost: c, currency: '$', affordable: c !== null && run.cash >= c,
        onBuy: () => {
          if (c === null || run.cash < c) return;
          run.cash -= c;
          run.training[def.key] = lvl + 1;
          renderTraining();
        },
      };
    }),
    onCharm: () => {
      if (run.cash < ECONOMY.CHARM_COST) return;
      run.cash -= ECONOMY.CHARM_COST;
      adjustConfidence(ECONOMY.CHARM_RESTORE);
      renderTraining();
    },
    onProceed: () => {
      run.match += 1;
      startMatch();
    },
  });
}

// ===========================================================================
// Boot
// ===========================================================================
const upgradeShortcutsEnabled = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function showUpgradeScreen(screen) {
  if (!upgradeShortcutsEnabled || (screen !== 'meta' && screen !== 'training')) return;
  if (screen === 'meta') {
    renderMeta(true);
  } else {
    if (!state.run) startRun('career', CHARACTERS[0].id);
    state.screen = 'TRAINING';
    ui.showHud(false);
    ui.setDimmed(true);
    renderTraining();
  }
}

function frame(dt) {
  state.elapsed += dt;
  engine.setAnimationsPaused(state.screen === 'MATCH' && (state.phase === 'AIM' || state.phase === 'POWER'));

  // The pitch keeps playing behind the menus and the training room too.
  if (state.screen !== 'MATCH') { engine.runAmbient(dt); return; }

  switch (state.phase) {
    case 'SIM':    updateSim(dt); break;
    case 'AIM':    updateAim(dt); break;
    case 'POWER':  updatePower(dt); break;
    case 'WINDUP': updateWindup(dt); break;
    case 'FLIGHT': updateFlight(dt); break;
  }
  engine.setAnimationsPaused(state.phase === 'AIM' || state.phase === 'POWER');
}

async function boot() {
  ui.init();
  // Let the static loading screen paint before synchronous scene construction.
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  engine.init(document.getElementById('pitch'));
  window.__demo = {
    renderer: engine.renderer, scene: engine.scene, camera: engine.camera,
    state, shot, ball: engine.objects.ball, ready: false,
    ballState: { position: ballPos, velocity: ballVel },
    crowd: engine.crowd, formation: engine.formation,
    matchView: engine.matchView,
    dimensions: { goal: GOAL, pitch: PITCH, ballRadius: BALL_R },
    showUpgradeScreen, characters: CHARACTERS,
  };
  await Promise.all([engine.loadStriker(), engine.loadBall(),
    ui.preloadMenuAssets(CHARACTERS.map(character => character.portrait))]);
  engine.prepareStrikerAppearances(CHARACTERS);
  window.__demo.striker = engine.striker;
  window.__demo.players = engine.players;
  window.__demo.lastLaunch = engine.lastLaunch;
  engine.onFrame(frame);
  addEventListener('pagehide', checkpointCareer);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') checkpointCareer();
  });

  addEventListener('pointerdown', (e) => {
    if (!window.__demo.ready) return;
    if (e.target.closest('button')) return;   // overlay buttons own their clicks
    advance();
  });
  addEventListener('keydown', (e) => {
    if (!window.__demo.ready) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && state.screen !== 'MATCH') {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight'
        || (ui.isMainMenu() && (e.code === 'ArrowUp' || e.code === 'ArrowDown'))) {
        e.preventDefault();
        ui.cycleMenuTheme(e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (ui.isMainMenu()) {
        if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
          e.preventDefault();
          startRun(e.code === 'Digit1' ? 'career' : e.code === 'Digit2' ? 'single' : 'practice');
          return;
        }
      }
    }
    if (e.code === 'Escape') { e.preventDefault(); renderMenu(); return; }
    if (upgradeShortcutsEnabled && e.altKey && !e.ctrlKey && !e.metaKey
      && (e.code === 'Digit1' || e.code === 'Digit2')) {
      e.preventDefault();
      if (!e.repeat) showUpgradeScreen(e.code === 'Digit1' ? 'meta' : 'training');
      return;
    }
    if (e.target.closest('button, input, textarea, select')) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); advance(); }
  });

  renderMenu();
  ui.setMatchExit(renderMenu);
  await new Promise(resolve => {
    const afterRender = engine.scene.onAfterRender;
    engine.scene.onAfterRender = function (...args) {
      afterRender.apply(this, args);
      engine.scene.onAfterRender = afterRender;
      resolve();
    };
  });
  await ui.finishLoading();
  window.__demo.ready = true;
}

boot().catch(error => {
  console.error('Game startup failed:', error);
  ui.showLoadingError();
});

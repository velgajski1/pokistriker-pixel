/**
 * progress.js - everything that carries over between runs.
 *
 * XP (a run's score / 10 plus mission rewards) unlocks kits, boots, balls and
 * celebrations; three missions at a time pay XP; ranks name how deep a run
 * went; checkpoints let a player who has been far start further in; the daily
 * challenge is the same ten chances for everyone that day, with a streak.
 *
 * Pure data and rules: no DOM, no engine. app.js feeds it run events and reads
 * what to show; saveSystem.js stores it.
 */
import * as save from './saveSystem.js';

// ---- Catalogue ------------------------------------------------------------
/** Home kits: a repaint of the striker and his team-mates. */
export const KITS = {
  home: { name: 'CLASSIC BLUE', kit: 0x2f6bff, shorts: 0xf4f7fa, socks: 0x2f6bff },
  sky: { name: 'SKY BLUE', kit: 0x62c0ff, shorts: 0x14243c, socks: 0x62c0ff },
  zebra: { name: 'ZEBRA STRIPES', kit: 0xf1f1ec, shorts: 0x15171c, socks: 0x15171c, pattern: 'stripes', accent: 0x15171c },
  forest: { name: 'FOREST', kit: 0x1d6b3a, shorts: 0xf0efe6, socks: 0x1d6b3a },
  lava: { name: 'LAVA HOOPS', kit: 0xe8452c, shorts: 0x2a1a17, socks: 0xf5a524, pattern: 'hoops', accent: 0xf5a524 },
  bubblegum: { name: 'BUBBLEGUM', kit: 0xff8fc8, shorts: 0xffffff, socks: 0xff8fc8, pattern: 'stripes', accent: 0xffffff },
  emerald: { name: 'EMERALD CHECKS', kit: 0x1f9e62, shorts: 0xf0efe6, socks: 0x1f9e62, pattern: 'checks', accent: 0xb7f26b },
  ocean: { name: 'OCEAN', kit: 0x1aa6a6, shorts: 0x10264a, socks: 0x10264a, pattern: 'stripes', accent: 0x10264a },
  retro: { name: 'RETRO HOOPS', kit: 0xd8322e, shorts: 0xffffff, socks: 0xffffff, pattern: 'hoops', accent: 0xffffff },
  royal: { name: 'ROYAL', kit: 0x5b2d9c, shorts: 0x5b2d9c, socks: 0xf2c64a, pattern: 'stripes', accent: 0xf2c64a },
  steel: { name: 'STEEL CHECKS', kit: 0x8c96a3, shorts: 0x2b3038, socks: 0x2b3038, pattern: 'checks', accent: 0x5e6773 },
  sunset: { name: 'SUNSET', kit: 0xff8a3d, shorts: 0x4a2466, socks: 0x4a2466, pattern: 'hoops', accent: 0x8e3fb8 },
  volt: { name: 'VOLT', kit: 0xd8ff3a, shorts: 0x111316, socks: 0xd8ff3a, pattern: 'stripes', accent: 0x111316 },
  galaxy: { name: 'GALAXY', kit: 0x3a1f7a, shorts: 0x120b2a, socks: 0x4fe3ff, pattern: 'checks', accent: 0x4fe3ff },
  midnight: { name: 'MIDNIGHT', kit: 0x191c2b, shorts: 0x191c2b, socks: 0x4ff0d0, pattern: 'hoops', accent: 0x2b3150 },
};
export const BOOTS = { black: { name: 'BLACK BOOTS', color: 0x101418 }, blaze: { name: 'BLAZE BOOTS', color: 0xff7a1a },
  gold: { name: 'GOLD BOOTS', color: 0xffcf3a }, ice: { name: 'ICE BOOTS', color: 0x9fe8ff },
  pink: { name: 'FLAMINGO BOOTS', color: 0xff5fae }, neon: { name: 'NEON BOOTS', color: 0xc8ff3a },
  white: { name: 'WHITE BOOTS', color: 0xf2f2f2 }, crimson: { name: 'CRIMSON BOOTS', color: 0xd02b3a } };
export const BALLS = { classic: { name: 'CLASSIC BALL', color: 0xffffff }, neon: { name: 'NEON BALL', color: 0xc8ff3a },
  ruby: { name: 'RUBY BALL', color: 0xff5a64 }, ice: { name: 'ICE BALL', color: 0x9fe8ff },
  violet: { name: 'VIOLET BALL', color: 0xb27cff }, mint: { name: 'MINT BALL', color: 0x7dffc4 },
  sunburst: { name: 'SUNBURST BALL', color: 0xffa531 }, rose: { name: 'ROSE BALL', color: 0xff9ecf } };
/** Celebration clips; the first three come free. */
export const CELEBRATIONS = { celebrate_dance: 'DANCE', celebrate_cheer: 'CHEER', celebrate_jump: 'JUMP',
  celebrate_victory: 'VICTORY PUMP', celebrate_heart: 'HEART HANDS', celebrate_backflip: 'BACKFLIP',
  celebrate_backflip_hooks: 'BACKFLIP AND HOOKS' };
/**
 * The strikers to choose from (invented characters; gameEngine.js holds each
 * one's look). The first four come free, the rest are on the unlock track.
 */
export const STRIKERS = {
  blade: { name: 'BLADE', style: 'TALL AND SHARP' }, tank: { name: 'TANK', style: 'SHORT AND STRONG' },
  zippy: { name: 'ZIPPY', style: 'SMALL AND QUICK' }, rocket: { name: 'ROCKET', style: 'ALL ATHLETE' },
  bounce: { name: 'BOUNCE', style: 'BIG HAIR, BIG GOALS' }, blaze: { name: 'BLAZE', style: 'GINGER FLASH' },
  swift: { name: 'SWIFT', style: 'RUNS ALL DAY' }, chief: { name: 'CHIEF', style: 'THE OLD PRO' },
  maestro: { name: 'MAESTRO', style: 'PURE TECHNIQUE' }, frost: { name: 'FROST', style: 'ICE COLD FINISHER' },
};

/** Unlock track, in order; `xp` is the lifetime XP that opens each item. */
/** Headwear and eyewear: block pieces on the striker's head (gameEngine.js builds them). */
export const HATS = { none: { name: 'NO HAT', icon: '\u2716' }, cap: { name: 'BASEBALL CAP', icon: '\u{1F9E2}' },
  beanie: { name: 'BOBBLE BEANIE', icon: '\u{1F9F6}' }, phones: { name: 'HEADPHONES', icon: '\u{1F3A7}' },
  tophat: { name: 'TOP HAT', icon: '\u{1F3A9}' }, viking: { name: 'VIKING HELMET', icon: '\u{1FA96}' },
  crown: { name: 'GOLD CROWN', icon: '\u{1F451}' } };
export const GLASSES = { none: { name: 'NO GLASSES', icon: '\u2716' }, shades: { name: 'COOL SHADES', icon: '\u{1F576}' },
  star: { name: 'STAR GLASSES', icon: '\u2B50' }, threed: { name: '3D GLASSES', icon: '\u{1F453}' },
  gold: { name: 'GOLD SHADES', icon: '\u{1F60E}' } };

/**
 * Unlock track, in order; `xp` is the lifetime XP that opens each item. The
 * coolest things come first, while a player is deciding whether to stay
 * (shades, a cap, the backflip, a Viking helmet, gold shades...); plain kits,
 * balls and boots wait for later. Every finished run unlocks the next item anyway.
 */
export const UNLOCKS = [
  ['glasses:shades', 150], ['hat:cap', 300], ['celebration:celebrate_backflip', 500], ['hat:viking', 700],
  ['glasses:gold', 950], ['striker:bounce', 1250], ['hat:tophat', 1600], ['kit:lava', 2000],
  ['glasses:threed', 2400], ['hat:crown', 2850], ['celebration:celebrate_backflip_hooks', 3300],
  ['hat:phones', 3800], ['striker:blaze', 4300], ['glasses:star', 4900], ['kit:galaxy', 5500], ['hat:beanie', 6200],
  ['celebration:celebrate_heart', 6900], ['ball:sunburst', 7700], ['striker:frost', 8500], ['kit:midnight', 9400],
  ['boots:gold', 10400], ['celebration:celebrate_victory', 11400], ['kit:sky', 12500], ['ball:neon', 13700],
  ['boots:blaze', 15000], ['kit:zebra', 16400], ['striker:swift', 17900], ['kit:forest', 19500],
  ['ball:ruby', 21200], ['kit:bubblegum', 23000], ['ball:ice', 25000], ['kit:emerald', 27200], ['boots:ice', 29500],
  ['striker:chief', 32000], ['kit:ocean', 34700], ['ball:violet', 37500], ['boots:pink', 40500],
  ['kit:retro', 43800], ['striker:maestro', 47000], ['kit:royal', 50500], ['ball:mint', 54000],
  ['boots:neon', 58000], ['kit:steel', 62000], ['kit:sunset', 66000], ['boots:white', 70000], ['ball:rose', 74500],
  ['kit:volt', 79000], ['boots:crimson', 84000],
].map(([id, xp]) => ({ id, xp }));
const FREE = ['kit:home', 'boots:black', 'ball:classic', 'hat:none', 'glasses:none', 'celebration:mix',
  'celebration:celebrate_dance', 'celebration:celebrate_cheer', 'celebration:celebrate_jump',
  'striker:blade', 'striker:tank', 'striker:zippy', 'striker:rocket'];
/** Celebrations to equip: one favourite, or MIX (every unlocked one in turn). */
const MOVES = { mix: { name: 'ALL MOVES', short: 'MIX', icon: '\u{1F500}' },
  ...Object.fromEntries(Object.entries(CELEBRATIONS).map(([key, name]) => [key, { name: `${name} CELEBRATION`, short: name }])) };
const CATALOGUE = { kit: KITS, boots: BOOTS, ball: BALLS, striker: STRIKERS, hat: HATS, glasses: GLASSES, celebration: MOVES };
/** The locker's tabs; strikers are chosen on their own screen. */
export const LOCKER_TABS = [['hat', 'HATS'], ['glasses', 'GLASSES'], ['kit', 'KITS'], ['boots', 'BOOTS'],
  ['ball', 'BALLS'], ['celebration', 'MOVES']];

/** Display name of an unlock id such as 'kit:sky'. */
export function itemName(id) {
  const [type, key] = id.split(':');
  if (type === 'celebration') return MOVES[key].name;
  if (type === 'striker') return `STRIKER ${STRIKERS[key].name}`;
  return CATALOGUE[type][key].name;
}

// ---- Ranks and checkpoints --------------------------------------------------
export const RANKS = [{ level: 1, name: 'ROOKIE' }, { level: 4, name: 'PRO' }, { level: 7, name: 'STAR' },
  { level: 10, name: 'LEGEND' }, { level: 13, name: 'ICON' }];
export const rankFor = level => RANKS.reduce((rank, r) => (level >= r.level ? r : rank), RANKS[0]);

/** A checkpoint opens once a run has gone two levels past it. */
const CHECKPOINTS = [4, 7, 10, 13];
const CHECKPOINT_LEAD = 2;

// ---- Missions ---------------------------------------------------------------
/**
 * The pool, easiest first; three are active at a time and a finished one is
 * replaced by the next, cycling. `run` missions count within one run (not the
 * daily challenge); `total` missions add up across runs from when they start.
 */
export const MISSIONS = [
  { id: 'goals5', text: 'SCORE 5 GOALS IN ONE RUN', scope: 'run', stat: 'goals', goal: 5, xp: 100 },
  { id: 'bull3', text: 'HIT 3 BULLSEYES IN ONE RUN', scope: 'run', stat: 'bullseyes', goal: 3, xp: 120 },
  { id: 'combo3', text: 'REACH A X3 COMBO', scope: 'run', stat: 'combo', goal: 3, xp: 120 },
  { id: 'level4', text: 'REACH LEVEL 4', scope: 'run', stat: 'level', goal: 4, xp: 150 },
  { id: 'golden2', text: 'SCORE 2 GOLDEN BALLS', scope: 'total', stat: 'golden', goal: 2, xp: 150 },
  { id: 'heart1', text: 'GRAB A BONUS FROM A TARGET', scope: 'total', stat: 'hearts', goal: 1, xp: 120 },
  { id: 'moving3', text: 'HIT 3 MOVING TARGETS', scope: 'total', stat: 'moving', goal: 3, xp: 180 },
  { id: 'score5k', text: 'SCORE 5,000 IN ONE RUN', scope: 'run', stat: 'score', goal: 5000, xp: 180 },
  { id: 'daily1', text: 'PLAY THE DAILY CHALLENGE', scope: 'total', stat: 'daily', goal: 1, xp: 150 },
  { id: 'freekick1', text: 'SCORE A FREE KICK OVER THE WALL', scope: 'total', stat: 'freekick', goal: 1, xp: 200 },
  { id: 'woodwork1', text: 'SCORE IN OFF THE POST OR BAR', scope: 'total', stat: 'woodwork', goal: 1, xp: 200 },
  { id: 'boss1', text: 'BEAT A BOSS KEEPER', scope: 'total', stat: 'boss', goal: 1, xp: 250 },
  { id: 'level7', text: 'REACH LEVEL 7', scope: 'run', stat: 'level', goal: 7, xp: 250 },
  { id: 'bonus4', text: 'HIT 4 TARGETS IN BONUS ROUNDS', scope: 'total', stat: 'bonus', goal: 4, xp: 200 },
  { id: 'bull20', text: 'HIT 20 BULLSEYES', scope: 'total', stat: 'bullseyes', goal: 20, xp: 250 },
  { id: 'combo5', text: 'REACH A X5 COMBO', scope: 'run', stat: 'combo', goal: 5, xp: 300 },
  { id: 'score15k', text: 'SCORE 15,000 IN ONE RUN', scope: 'run', stat: 'score', goal: 15000, xp: 350 },
  { id: 'level10', text: 'REACH LEVEL 10', scope: 'run', stat: 'level', goal: 10, xp: 400 },
  { id: 'goals100', text: 'SCORE 100 GOALS', scope: 'total', stat: 'goals', goal: 100, xp: 400 },
  { id: 'boss3', text: 'BEAT 3 BOSS KEEPERS', scope: 'total', stat: 'boss', goal: 3, xp: 500 },
];
const MISSION_SLOTS = 3;
/** Counters a run keeps for missions; totals are the lifetime sums. */
export const TALLY_KEYS = ['goals', 'bullseyes', 'golden', 'hearts', 'moving', 'freekick', 'woodwork', 'boss', 'bonus', 'daily'];

// ---- Daily challenge ------------------------------------------------------
export const DAILY_SHOTS = 10;

/** Local calendar day, 'YYYY-MM-DD'. */
export function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dayBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d - 1));
}

/** Seeded generator (mulberry32) for the day's chances. */
export function seededRandom(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- State ------------------------------------------------------------------
const data = load();

function load() {
  const saved = save.loadProgress() || {};
  const totals = {};
  for (const key of TALLY_KEYS) totals[key] = Number.isFinite(saved.totals?.[key]) ? saved.totals[key] : 0;
  const state = {
    xp: Number.isFinite(saved.xp) ? saved.xp : 0,
    seen: Array.isArray(saved.seen) ? saved.seen : [],
    equipped: { kit: 'home', boots: 'black', ball: 'classic', hat: 'none', glasses: 'none', celebration: 'mix', ...saved.equipped },
    missions: Array.isArray(saved.missions) ? saved.missions.filter(m => MISSIONS.some(p => p.id === m.id)) : [],
    nextMission: Number.isInteger(saved.nextMission) ? saved.nextMission : 0,
    totals,
    bestLevel: Number.isFinite(saved.bestLevel) ? saved.bestLevel : 1,
    runs: Number.isFinite(saved.runs) ? saved.runs : 0,
    boost: saved.boost === true,
    striker: typeof saved.striker === 'string' ? saved.striker : null,
    tutorialDone: saved.tutorialDone === true,   // the pull tutorial plays once, ever
    // Every mission ever finished (the achievements), for the game-progress metric.
    achieved: Array.isArray(saved.achieved) ? saved.achieved.filter(id => MISSIONS.some(m => m.id === id)) : [],
    daily: { day: saved.daily?.day || '', best: saved.daily?.best || 0,
      streak: saved.daily?.streak || 0, lastPlayed: saved.daily?.lastPlayed || '' },
  };
  // Equipped items must still exist and be unlocked (a catalogue change, a hand-edited save).
  for (const type of ['kit', 'boots', 'ball', 'hat', 'glasses', 'celebration']) {
    if (!CATALOGUE[type][state.equipped[type]] || !isUnlockedIn(state, `${type}:${state.equipped[type]}`)) {
      state.equipped[type] = FREE.find(id => id.startsWith(type + ':')).split(':')[1];
    }
  }
  while (state.missions.length < MISSION_SLOTS) state.missions.push(nextMissionIn(state));
  return state;
}

function isUnlockedIn(state, id) {
  return FREE.includes(id) || UNLOCKS.some(u => u.id === id && state.xp >= u.xp);
}
function nextMissionIn(state) {
  const active = new Set(state.missions.map(m => m.id));
  for (let tries = 0; tries < MISSIONS.length; tries++) {
    const mission = MISSIONS[state.nextMission % MISSIONS.length];
    state.nextMission++;
    if (!active.has(mission.id)) return { id: mission.id, base: state.totals[mission.stat] ?? 0 };
  }
  return { id: MISSIONS[0].id, base: 0 };
}
const persist = () => save.saveProgress(data);

// ---- Queries ----------------------------------------------------------------
export const xp = () => data.xp;
export const equipped = () => ({ ...data.equipped });
export const bestLevel = () => data.bestLevel;
export const hasBoost = () => data.boost;
export const isUnlocked = id => isUnlockedIn(data, id);
export const kit = () => KITS[data.equipped.kit];
export const bootsColor = () => BOOTS[data.equipped.boots].color;
export const ballColor = () => BALLS[data.equipped.ball].color;
export const gear = () => ({ hat: data.equipped.hat, glasses: data.equipped.glasses });
export const celebrations = () => Object.keys(CELEBRATIONS).filter(key => isUnlocked(`celebration:${key}`));
/** The equipped celebration, or null for MIX (every unlocked one in turn). */
export const favouriteCelebration = () => data.equipped.celebration !== 'mix'
  && isUnlocked(`celebration:${data.equipped.celebration}`) ? data.equipped.celebration : null;

/** Every item on the track (and the free ones) with its state. */
function allItems() {
  const items = [];
  for (const id of [...FREE, ...UNLOCKS.map(u => u.id)]) {
    const [type, key] = id.split(':');
    const unlock = UNLOCKS.find(u => u.id === id);
    items.push({ id, type, key, name: itemName(id), short: type === 'celebration' ? MOVES[key].short : itemName(id),
      xp: unlock?.xp || 0, unlocked: isUnlocked(id),
      isNew: isUnlocked(id) && !FREE.includes(id) && !data.seen.includes(id),
      equipped: WEARABLE.includes(type) ? data.equipped[type] === key : type === 'striker' && data.striker === key,
      color: type === 'kit' ? KITS[key].kit : type === 'boots' ? BOOTS[key].color
        : type === 'ball' ? BALLS[key].color : null,
      icon: type === 'hat' || type === 'glasses' || type === 'celebration' ? CATALOGUE[type][key].icon || null : null,
      accent: type === 'kit' ? KITS[key].accent ?? KITS[key].shorts : null });
  }
  return items;
}
const WEARABLE = ['kit', 'boots', 'ball', 'hat', 'glasses', 'celebration'];
/** The locker's items (kits, boots, balls, celebrations), tab by tab, cheapest first. */
export function lockerItems() {
  const order = LOCKER_TABS.map(([type]) => type);
  return allItems().filter(item => item.type !== 'striker')
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.xp - b.xp);
}
export const hasNewItems = () => lockerItems().some(item => item.isNew);

/** The strikers, free ones first, with their unlock state. */
export function strikerItems() {
  return allItems().filter(item => item.type === 'striker').sort((a, b) => a.xp - b.xp)
    .map(item => ({ ...item, name: STRIKERS[item.key].name, style: STRIKERS[item.key].style }));
}

/** How much of the locker is open: the overall collection progress. */
export function collection() {
  const items = lockerItems();
  return { unlocked: items.filter(item => item.unlocked).length, total: items.length };
}

/**
 * Overall game progress, 0-100%: the average of reaching level 10, finishing
 * every mission once (the achievements) and unlocking every locker item.
 */
export const PROGRESS_LEVEL = 15;   // the last level (app.js ARCADE.LEVELS)
export function gameProgress() {
  const level = Math.min(PROGRESS_LEVEL, data.bestLevel);
  const items = UNLOCKS.filter(u => data.xp >= u.xp).length;
  const parts = [(level - 1) / (PROGRESS_LEVEL - 1), data.achieved.length / MISSIONS.length, items / UNLOCKS.length];
  return { percent: Math.floor(100 * parts.reduce((a, b) => a + b, 0) / parts.length),
    level: { value: level, goal: PROGRESS_LEVEL },
    missions: { value: data.achieved.length, goal: MISSIONS.length },
    items: { value: items, goal: UNLOCKS.length } };
}

/** The chosen striker's id, or null before the first (or after a locked) choice. */
export const striker = () => (data.striker && isUnlocked(`striker:${data.striker}`) ? data.striker : null);
export const tutorialDone = () => data.tutorialDone;

/** Everything the results screen needs to show an unlocked item. */
export function unlockInfo(id) {
  const [type, key] = id.split(':');
  const item = allItems().find(entry => entry.id === id);
  return { id, type, key, name: type === 'striker' ? STRIKERS[key].name : item.short, full: itemName(id),
    color: item.color, accent: item.accent, icon: item.icon, style: type === 'striker' ? STRIKERS[key].style : '' };
}
export function setTutorialDone() { data.tutorialDone = true; persist(); }

export function setStriker(id) {
  if (!isUnlocked(`striker:${id}`)) return false;
  data.striker = id;
  persist();
  return true;
}
/** A free striker at random, for a first launch. */
export const randomFreeStriker = () => {
  const free = FREE.filter(id => id.startsWith('striker:'));
  return free[Math.floor(Math.random() * free.length)].split(':')[1];
};

/** The next thing the XP bar is filling toward, or null once everything is open. */
export function nextUnlock() {
  const next = UNLOCKS.find(u => data.xp < u.xp);
  if (!next) return null;
  const previous = [...UNLOCKS].reverse().find(u => data.xp >= u.xp)?.xp || 0;
  return { id: next.id, name: itemName(next.id), xp: next.xp, need: next.xp - data.xp,
    fraction: (data.xp - previous) / (next.xp - previous) };
}

/** Active missions with progress; `run` is the live run (run missions read it). */
export function missions(run = null) {
  return data.missions.map(slot => {
    const mission = MISSIONS.find(m => m.id === slot.id);
    const value = mission.scope === 'run' ? runStat(run, mission.stat) : data.totals[mission.stat] - slot.base;
    return { ...mission, value: Math.min(mission.goal, Math.max(0, value)) };
  });
}
function runStat(run, stat) {
  if (!run || run.daily) return 0;
  return stat === 'combo' ? run.bestCombo : stat === 'level' ? run.level : stat === 'score' ? run.score
    : run.tally[stat] || 0;
}

/** The highest checkpoint this player may start from, or 0. */
export function checkpoint() {
  return CHECKPOINTS.filter(level => data.bestLevel >= level + CHECKPOINT_LEAD).pop() || 0;
}

export function dailyStatus() {
  const day = today();
  const current = data.daily.day === day;
  const alive = data.daily.lastPlayed === day || data.daily.lastPlayed === dayBefore(day);
  return { day, best: current ? data.daily.best : 0, played: current && data.daily.lastPlayed === day,
    streak: alive ? data.daily.streak : 0 };
}

// ---- Updates ----------------------------------------------------------------
/** A fresh tally for a run. */
export function newTally() {
  return Object.fromEntries(TALLY_KEYS.map(key => [key, 0]));
}

/**
 * After each shot: adds the shot's tally deltas to the lifetime totals and
 * returns missions finished by it ({ text, xp }), already paid out.
 */
export function recordShot(run, deltas) {
  for (const [key, value] of Object.entries(deltas)) {
    if (!value) continue;
    run.tally[key] = (run.tally[key] || 0) + value;
    data.totals[key] += value;
  }
  if (!run.daily) data.bestLevel = Math.max(data.bestLevel, run.level);
  return settleMissions(run);
}

function settleMissions(run) {
  const done = [];
  for (let i = 0; i < data.missions.length; i++) {
    const mission = missions(run)[i];
    if (mission.value < mission.goal) continue;
    done.push({ id: mission.id, text: mission.text, xp: mission.xp });
    data.xp += mission.xp;
    if (!data.achieved.includes(mission.id)) data.achieved.push(mission.id);
    data.missions[i] = nextMissionIn(data);
  }
  persist();
  return done;
}

/**
 * End of a run: XP for the score, daily bookkeeping. Returns what the
 * game-over screen shows: XP gained, anything it unlocked, missions finished.
 */
export function finishRun(run) {
  const before = data.xp;
  // A continued run pays only for the points scored since its last game over.
  const gained = Math.round((run.score - (run.paidScore || 0)) / 10);
  run.paidScore = run.score;
  data.xp += gained;
  if (!run.continued) data.runs++;
  if (!run.daily) data.bestLevel = Math.max(data.bestLevel, run.level);
  let dailyResult = null;
  if (run.daily) {
    const day = today();
    const status = dailyStatus();
    const newBest = data.daily.day !== day || run.score > data.daily.best;
    data.daily.best = data.daily.day === day ? Math.max(data.daily.best, run.score) : run.score;
    data.daily.day = day;
    if (data.daily.lastPlayed !== day) {
      data.daily.streak = status.streak > 0 ? status.streak + 1 : 1;
      data.daily.lastPlayed = day;
    }
    dailyResult = { best: data.daily.best, newBest, streak: data.daily.streak };
  }
  const done = settleMissions(run);
  // Every finished run unlocks something: if its XP opened nothing, the next item
  // on the track is the run's reward (the XP bar moves up to it).
  let reward = false;
  if (run.shots > 0 && !UNLOCKS.some(u => before < u.xp && data.xp >= u.xp)) {
    const next = UNLOCKS.find(u => data.xp < u.xp);
    if (next) { data.xp = next.xp; reward = true; }
  }
  const unlocked = UNLOCKS.filter(u => before < u.xp && data.xp >= u.xp).map(u => ({ id: u.id, name: itemName(u.id), reward }));
  persist();
  return { gained, unlocked, missions: done, daily: dailyResult };
}

/** The daily challenge counts as played the moment it starts (missions, streak shown next time). */
export function markDailyStarted(run) {
  recordShot(run, { daily: 1 });
}

export function equip(id) {
  const [type, key] = id.split(':');
  if (!isUnlocked(id) || !WEARABLE.includes(type)) return false;
  data.equipped[type] = key;
  persist();
  return true;
}

/** A screen was seen: its unlocked items (locker or strikers) are no longer new. */
export function markSeen(kind = 'locker') {
  const items = kind === 'strikers' ? strikerItems() : lockerItems();
  for (const item of items) if (item.unlocked && !data.seen.includes(item.id)) data.seen.push(item.id);
  persist();
}
export const hasNewStrikers = () => strikerItems().some(item => item.isNew);

export function setBoost(on) { data.boost = on; persist(); }

/** Test hook (localhost): the raw record. */
export const debugData = () => data;

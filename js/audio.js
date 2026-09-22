/** Kenney CC0 interface samples plus procedural gameplay audio and music. */
let context, musicBus, sfxBus, noise, ambience;
let settings = { music: .3, sfx: .65 };
let scene = 'menu', step = 0, nextBeat = 0, powerTone = null;
const lastPlayed = new Map();
const played = Object.create(null);
const uiSamples = {
  hover: 'tick_001', click: 'click_001', back: 'back_001', select: 'select_001',
  confirm: 'confirmation_001', unavailable: 'error_001', purchase: 'confirmation_002',
  level: 'confirmation_002', charm: 'confirmation_001',
};
const uiBuffers = new Map();
let uiDownloads;

export function preloadUI() {
  if (!uiDownloads) uiDownloads = Promise.all([...new Set(Object.values(uiSamples))].map(async name => {
    try {
      const response = await fetch(`assets/audio/ui/${name}.ogg`);
      if (!response.ok) return null;
      return { name, bytes: await response.arrayBuffer() };
    } catch { return null; }
  }));
  return uiDownloads;
}

async function decodeUI() {
  const files = await preloadUI();
  await Promise.all(files.filter(Boolean).map(async file => {
    try { uiBuffers.set(file.name, await context.decodeAudioData(file.bytes)); }
    catch { /* Older browsers without Ogg support retain synthesized fallback. */ }
  }));
}
const melodies = {
  menu: [0, 7, 12, 7, 9, 7, 4, 2, 0, 4, 7, 12, 9, 7, 2, 4],
  upgrades: [0, 4, 7, 11, 7, 4, 2, 7, 0, 4, 9, 7, 4, 2, 7, 4],
  victory: [0, 4, 7, 12, 12, 9, 7, 4, 5, 9, 12, 17, 16, 12, 7, 12],
};
const phrases = {
  hover: [76], click: [67, 79], back: [67, 60], select: [64, 71, 76],
  confirm: [60, 67, 72], unavailable: [45, 44], purchase: [72, 76, 79],
  level: [60, 64, 67, 72], charm: [67, 71, 74, 79], reward: [79, 84],
  instruction: [72, 76], aim: [69, 76], power: [76, 81],
  tutorial: [60, 64, 67, 72, 79], positive: [72, 76], negative: [57, 52],
  warning: [69, 69], win: [60, 64, 67, 72], draw: [60, 65, 67],
  loss: [60, 58, 55, 48], benched: [55, 51, 48, 43],
  victory: [60, 64, 67, 72, 67, 72, 76, 79], opponent: [55, 58, 53],
};

function tone(frequency, duration, volume, when, bus = sfxBus, type = 'sine', end = frequency) {
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), when + duration);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(volume, when + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  oscillator.connect(gain).connect(bus);
  oscillator.start(when); oscillator.stop(when + duration + .02);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}

function hiss(duration, frequency, volume, when, type = 'bandpass') {
  const source = context.createBufferSource(), filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noise; filter.type = type; filter.frequency.value = frequency;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(volume, when + .015);
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  source.connect(filter).connect(gain).connect(sfxBus);
  source.start(when); source.stop(when + duration);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
}

export function configure(values) {
  settings = { ...values };
  if (!context) return;
  musicBus.gain.setTargetAtTime(settings.music, context.currentTime, .04);
  sfxBus.gain.setTargetAtTime(settings.sfx, context.currentTime, .04);
}

export async function unlock() {
  try {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      musicBus = context.createGain(); sfxBus = context.createGain();
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.ratio.value = 8;
      musicBus.connect(limiter); sfxBus.connect(limiter); limiter.connect(context.destination);
      noise = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const crowd = context.createBufferSource(), filter = context.createBiquadFilter();
      crowd.buffer = noise; crowd.loop = true; filter.type = 'lowpass'; filter.frequency.value = 700;
      ambience = context.createGain(); ambience.gain.value = 0;
      crowd.connect(filter).connect(ambience).connect(sfxBus); crowd.start();
      configure(settings);
      void decodeUI();
      setInterval(schedule, 100);
    }
    if (!document.hidden && context.state !== 'running') await context.resume();
  } catch { /* Audio is optional; blocked audio must not block the game. */ }
}

export function setScene(value) {
  if (scene === value) return;
  scene = value; step = 0;
  if (context) nextBeat = context.currentTime + .05;
}

function schedule() {
  if (!context || context.state !== 'running' || document.hidden) return;
  const now = context.currentTime;
  ambience.gain.setTargetAtTime(scene === 'match' ? .11 : 0, now, .4);
  if (nextBeat < now) nextBeat = now;
  while (nextBeat < now + .15) {
    if (scene === 'match') {
      // Occasional distant tonal chant over the filtered crowd bed.
      if (step % 48 === 24 && settings.sfx > 0) {
        tone(164, .55, .018, nextBeat); tone(196, .6, .015, nextBeat + .25);
      }
    } else if (settings.music > 0) {
      const melody = melodies[scene] || melodies.menu;
      const root = [48, 53, 45, 55][Math.floor(step / 16) % 4];
      tone(440 * 2 ** ((root + 12 + melody[step % 16] - 69) / 12), .22,
        scene === 'upgrades' ? .035 : .055, nextBeat, musicBus, 'triangle');
      if (step % 4 === 0) tone(440 * 2 ** ((root - 69) / 12), .38, .1, nextBeat, musicBus);
      if (step % 2 === 0) tone(95, .1, .06, nextBeat, musicBus, 'sine', 40);
    }
    nextBeat += scene === 'upgrades' ? .3 : .24;
    step++;
  }
}

export function play(name) {
  if (!context || context.state !== 'running' || document.hidden || settings.sfx === 0) return;
  const now = context.currentTime;
  if (now - (lastPlayed.get(name) ?? -100) < (name === 'hover' ? .09 : .12)) return;
  lastPlayed.set(name, now);
  played[name] = (played[name] || 0) + 1;
  const buffer = uiBuffers.get(uiSamples[name]);
  if (buffer) {
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = name === 'hover' ? .22 : .5;
    source.connect(gain).connect(sfxBus);
    source.start(now);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    return;
  }
  const notes = phrases[name];
  if (notes) {
    notes.forEach((note, i) => tone(440 * 2 ** ((note - 69) / 12), .18,
      name === 'hover' ? .035 : .09, now + i * .095, sfxBus, 'triangle'));
    return;
  }
  if (name === 'kick' || name === 'bounce' || name === 'block' || name === 'save') {
    tone(name === 'kick' ? 160 + Math.random() * 30 : 110, .14, .35, now, sfxBus, 'sine', 45);
    hiss(.12, name === 'save' ? 1600 : 600, .25, now);
  } else if (name === 'post' || name === 'bar') {
    const base = name === 'bar' ? 430 : 620;
    for (let i = 1; i <= 4; i++) tone(base * i * 1.07, .65 / i, .13 / i, now);
  } else if (name === 'kickoff' || name === 'fulltime') {
    for (let i = 0; i < (name === 'fulltime' ? 3 : 1); i++) {
      tone(2350, .22, .1, now + i * .3); tone(2780, .2, .035, now + i * .3);
    }
  } else if (name === 'net') hiss(.45, 2600, .35, now);
  else if (name === 'whoosh') hiss(.35, 1000, .2, now);
  else if (name === 'cheer' || name === 'applause') {
    hiss(1.8, 1100, .6, now);
    for (let i = 0; i < 10; i++) hiss(.09, 1900, .2, now + i * .11);
  } else if (name === 'groan') {
    hiss(.9, 320, .45, now); tone(150, .7, .045, now, sfxBus, 'sine', 95);
  }
}

export function setPower(value) {
  if (!context || context.state !== 'running') return;
  if (value === null) {
    if (powerTone) {
      powerTone.gain.gain.setTargetAtTime(0, context.currentTime, .02);
      powerTone.osc.stop(context.currentTime + .1); powerTone = null;
    }
    return;
  }
  if (!powerTone) {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'sine'; gain.gain.value = .025;
    osc.connect(gain).connect(sfxBus); osc.start();
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    powerTone = { osc, gain };
  }
  powerTone.osc.frequency.setTargetAtTime(220 + value * 650, context.currentTime, .04);
}

export function visibility() {
  if (!context) return;
  setPower(null);
  if (document.hidden) context.suspend().catch(() => {});
  else context.resume().catch(() => {});
}

export const status = () => ({ state: context?.state || 'locked', scene, settings: { ...settings }, played: { ...played }, uiSamplesLoaded: uiBuffers.size });

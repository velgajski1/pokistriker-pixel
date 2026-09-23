/**
 * audio.js - the whole soundscape, synthesized with Web Audio. No samples.
 *
 *   Chip voices: pulse waves (12.5 / 25 / 50% duty), triangle bass, noise drums.
 *   Music:       a title anthem and four match songs (132-168 bpm), one per
 *                band of levels, each about a minute of verse, chorus and
 *                breakdown on 16th notes; layers and tempo build with the run.
 *   Crowd:       a filtered-noise bed that roars on goals, groans on misses
 *                and hushes while you aim.
 *   Effects:     arcade stingers for every beat of a shot.
 *
 * Mix: voices -> music / sfx buses -> master (glue compressor, limiter);
 * a shared reverb and a lead echo sit on send buses. Everything is scheduled
 * ahead on the audio clock, so timing never depends on the frame rate.
 */
let context, master, musicBus, sfxBus, reverbSend, echoSend, noise, crowd, meter, meterData;
let pulse = {};
let settings = { music: .3, sfx: .65 };
let scene = 'menu', step = 0, nextStep = 0, powerTone = null, intensity = 0, duck = 1;
const lastPlayed = new Map();
const played = Object.create(null);

const midi = n => 440 * 2 ** ((n - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C#5' -> 73; '-' rest, '~' hold. */
const parse = name => {
  if (name === '-' || name === '~') return name;
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const bars = text => text.trim().split(/\s*\|\s*/).map(bar => bar.split(/\s+/).map(parse));

// ---- Songs ------------------------------------------------------------------
// A song is a form (section order) over sections. A section has one chord per
// bar, an optional lead on the sixteenth-note grid (sixteen tokens per bar:
// '-' rest, '~' hold), and its own drum and bass patterns, so a verse, a
// chorus and a breakdown feel different. Each match song runs about a minute
// before it repeats; a new song takes over every few levels.
const C = [48, 52, 55], Am = [45, 48, 52], F = [41, 45, 48], G = [43, 47, 50], Em = [40, 43, 47], E = [40, 44, 47];
const Dm = [50, 53, 57], Bb = [46, 50, 53], D = [50, 54, 57], Bm = [47, 50, 54], B = [47, 51, 54], A = [45, 49, 52],
  Gm = [43, 46, 50];

const TITLE = {
  // Title and menus: a bright high-score anthem.
  bpm: 150, form: ['A'], lead_volume: .07, stabs: .03, arp: .03,
  sections: {
    A: { drums: 'four', bass: 'pump', chords: [C, Am, F, G, C, Am, F, G],
      lead: bars(`G5 - C6 - G5 - E5 - G5 ~ ~ - C6 - D6 - | E6 - D6 - C6 - A5 - C6 ~ ~ - A5 - G5 - |
        A5 - F5 - A5 - C6 - D6 ~ C6 - A5 - F5 - | G5 ~ ~ - B5 - D6 - G6 ~ ~ ~ F6 - D6 - |
        E6 - - E6 - D6 C6 - D6 - - D6 - C6 B5 - | C6 - - C6 - B5 A5 - E6 ~ ~ - D6 - C6 - |
        A5 - C6 - F6 - E6 - D6 - C6 - A5 - C6 - | B5 ~ ~ ~ D6 ~ ~ ~ G6 ~ ~ ~ ~ ~ - -`) },
  },
};

/** Match songs, by level: 1-3, 4-6, 7-9, 10 and up. */
const MATCH_SONGS = [
  { // Kickoff: sunny and bouncy, F major.
    name: 'kickoff', bpm: 132, form: ['A', 'B', 'A', 'C'], lead_volume: .06, stabs: .026, arp: .024,
    sections: {
      A: { drums: 'rock', bass: 'walk', chords: [F, C, Dm, Bb, F, C, Bb, C],
        lead: bars(`C6 - A5 - F5 - A5 - C6 - D6 - C6 - A5 - | G5 - - - E5 - G5 - C6 ~ ~ - G5 - E5 - |
          F5 - A5 - D6 - F6 - E6 - D6 - C6 - A5 - | Bb5 ~ ~ - D6 - F6 - D6 ~ ~ - C6 - Bb5 - |
          A5 - C6 - F6 - E6 - F6 - C6 - A5 - C6 - | G5 - C6 - E6 - D6 - C6 - G5 - E5 - G5 - |
          F5 - Bb5 - D6 - C6 - Bb5 - A5 - G5 - A5 - | C6 ~ ~ ~ G5 ~ ~ ~ C6 ~ ~ ~ - - - -`) },
      B: { drums: 'four', bass: 'pump', chords: [Dm, Bb, F, C, Dm, Bb, C, C],
        lead: bars(`D6 - - D6 - C6 - A5 - - F5 - A5 - C6 - | D6 - - D6 - F6 - D6 C6 ~ ~ - Bb5 - A5 - |
          A5 - - A5 - C6 - F6 - - E6 - D6 - C6 - | E6 ~ ~ ~ D6 ~ C6 ~ G5 ~ ~ ~ - - - - |
          F6 - E6 - D6 - A5 - D6 - E6 - F6 - A6 - | G6 ~ ~ - F6 - D6 - Bb5 ~ ~ - D6 - F6 - |
          E6 - G6 - E6 - C6 - G5 - C6 - E6 - G6 - | E6 ~ ~ ~ ~ ~ ~ ~ - - C6 - D6 - E6 -`) },
      C: { drums: 'half', bass: 'hold', chords: [Bb, C, Dm, Dm, Bb, C, F, F], lead: null },
    },
  },
  { // Pressure: the minor-key chase, with a new chorus and a breakdown.
    name: 'pressure', bpm: 150, form: ['A', 'B', 'C', 'A', 'B'], lead_volume: .055, stabs: .026, arp: .028,
    sections: {
      A: { drums: 'four', bass: 'pump', chords: [Am, F, C, G, Am, F, G, E],
        lead: bars(`A5 - - A5 - G5 - A5 - - C6 - A5 - G5 - | F5 - - F5 - E5 - F5 - - A5 - C6 - A5 - |
          G5 - - G5 - E5 - G5 - - C6 - E6 - D6 - | B5 ~ ~ - D6 ~ ~ - G5 ~ - B5 ~ - D6 - |
          E6 - E6 - D6 - C6 - A5 - C6 - D6 - E6 - | F6 - E6 - D6 - C6 - A5 ~ ~ - C6 - A5 - |
          G5 - B5 - D6 - G6 - F6 - D6 - B5 - D6 - | E6 ~ ~ ~ G#5 ~ ~ ~ B5 ~ ~ ~ E6 ~ ~ ~`) },
      B: { drums: 'rock', bass: 'drive', chords: [Dm, Am, E, Am, Dm, G, C, E],
        lead: bars(`D6 - F6 - A6 - F6 - D6 - F6 - E6 - D6 - | C6 - E6 - A6 - E6 - C6 - B5 - A5 - C6 - |
          B5 - G#5 - E5 - G#5 - B5 - D6 - E6 - D6 - | C6 ~ ~ - A5 ~ ~ - E5 ~ - A5 ~ - C6 - |
          F6 - F6 - E6 - D6 - A5 - D6 - F6 - A6 - | G6 - F6 - D6 - B5 - G5 - B5 - D6 - F6 - |
          E6 - D6 - C6 - G5 - E5 - G5 - C6 - E6 - | G#6 ~ ~ ~ E6 ~ ~ ~ B5 ~ ~ ~ G#5 ~ - -`) },
      C: { drums: 'half', bass: 'hold', chords: [F, G, Am, Am, F, G, E, E], lead: null },
    },
  },
  { // Night Match: syncopated and moody, E minor.
    name: 'night', bpm: 156, form: ['A', 'B', 'A', 'C'], lead_volume: .055, stabs: .024, arp: .03,
    sections: {
      A: { drums: 'break', bass: 'sync', chords: [Em, C, D, Bm, Em, C, Am, B],
        lead: bars(`E6 - - E6 - - G6 - F#6 - E6 - D6 - B5 - | C6 - - C6 - - E6 - D6 - C6 - B5 - G5 - |
          A5 - - A5 - - D6 - F#6 - E6 - D6 - A5 - | B5 ~ ~ ~ D6 ~ ~ ~ F#6 ~ ~ ~ D6 ~ - - |
          G6 - F#6 - E6 - B5 - E6 - F#6 - G6 - B6 - | A6 - G6 - E6 - C6 - E6 - G6 - A6 - G6 - |
          E6 - C6 - A5 - C6 - E6 - A6 - G6 - E6 - | D#6 ~ ~ ~ F#6 ~ ~ ~ B6 ~ ~ ~ - - - -`) },
      B: { drums: 'four', bass: 'drive', chords: [C, D, Em, Em, C, D, B, B],
        lead: bars(`G5 - C6 - E6 - G6 ~ - E6 - C6 - G5 - C6 | F#5 - A5 - D6 - F#6 ~ - D6 - A5 - F#5 - A5 |
          B5 ~ ~ - E6 ~ ~ - G6 ~ ~ - F#6 - E6 - | E6 ~ ~ ~ ~ ~ ~ ~ D6 - E6 - F#6 - G6 - |
          A6 - G6 - E6 - G6 - A6 - B6 - A6 - G6 - | F#6 - E6 - D6 - E6 - F#6 - A6 - F#6 - D6 - |
          D#6 - F#6 - B6 - A6 - F#6 - D#6 - B5 - D#6 - | F#6 ~ ~ ~ ~ ~ ~ ~ - - - - - - - -`) },
      C: { drums: 'half', bass: 'hold', chords: [Em, C, D, B, Em, C, D, B], lead: null },
    },
  },
  { // Final Whistle: fast and relentless, D minor.
    name: 'final', bpm: 168, form: ['A', 'B', 'C', 'A', 'B'], lead_volume: .055, stabs: .028, arp: .03,
    sections: {
      A: { drums: 'four', bass: 'drive', chords: [Dm, Bb, C, A, Dm, Bb, Gm, A],
        lead: bars(`D6 - A5 - D6 - E6 - F6 - E6 - D6 - A5 - | D6 - Bb5 - D6 - F6 - Bb6 - A6 - F6 - D6 - |
          E6 - C6 - E6 - G6 - C7 - Bb6 - G6 - E6 - | C#6 ~ ~ - E6 ~ ~ - A6 ~ ~ - G6 - E6 - |
          F6 - F6 - F6 - E6 - D6 - D6 - E6 - F6 - | G6 - G6 - G6 - F6 - D6 - Bb5 - D6 - F6 - |
          Bb6 - A6 - G6 - F6 - E6 - D6 - C#6 - E6 - | A6 ~ ~ ~ E6 ~ ~ ~ C#6 ~ ~ ~ A5 ~ - -`) },
      B: { drums: 'break', bass: 'pump', chords: [Bb, C, Dm, Dm, Bb, C, A, A],
        lead: bars(`F6 ~ ~ - D6 - F6 - Bb6 ~ ~ - A6 - F6 - | G6 ~ ~ - E6 - G6 - C7 ~ ~ - Bb6 - G6 - |
          A6 - F6 - D6 - F6 - A6 - D7 - A6 - F6 - | D6 ~ ~ ~ ~ ~ ~ ~ A5 - D6 - F6 - A6 - |
          Bb6 - A6 - G6 - F6 - D6 - F6 - G6 - A6 - | G6 - F6 - E6 - C6 - E6 - G6 - Bb6 - G6 - |
          E6 - C#6 - A5 - C#6 - E6 - G6 - A6 - C#7 - | A6 ~ ~ ~ ~ ~ ~ ~ - - - - - - - -`) },
      C: { drums: 'half', bass: 'hold', chords: [Gm, A, Dm, Dm, Gm, A, A, A], lead: null },
    },
  },
];
for (const song of [TITLE, ...MATCH_SONGS]) song.bars = song.form.reduce((n, key) => n + song.sections[key].chords.length, 0);

/** Which match song a level plays. */
export const songForLevel = level => MATCH_SONGS[Math.min(MATCH_SONGS.length - 1, Math.floor((Math.max(1, level) - 1) / 3))];

// Bass patterns in semitones above the chord root (two octaves down); null rests.
const BASS = {
  pump: [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 7, 12],          // sixteenth octave pump
  drive: [0, null, 0, null, 0, null, 12, null, 0, null, 0, null, 0, null, 12, null],
  walk: [0, null, null, null, 7, null, null, null, 12, null, null, 7, null, null, 5, null],
  sync: [0, null, null, 0, null, null, 12, null, null, 0, null, null, 7, null, 12, null],
  hold: [0, null, null, null, null, null, null, null, 7, null, null, null, null, null, null, null],
};

// ---- Voices -------------------------------------------------------------------
function pulseWave(duty) {
  const n = 48, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * duty);
  return context.createPeriodicWave(real, imag);
}

/** One enveloped note. `wave`: 'p12' | 'p25' | 'p50' | an OscillatorType. */
function voice(frequency, when, duration, { wave = 'p25', volume = .1, bus = sfxBus, attack = .005,
  release = .06, slide = 0, vibrato = 0, reverb = 0, echo = 0 } = {}) {
  const osc = context.createOscillator(), gain = context.createGain();
  if (pulse[wave]) osc.setPeriodicWave(pulse[wave]); else osc.type = wave;
  osc.frequency.setValueAtTime(frequency, when);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * slide), when + duration);
  if (vibrato) {
    const lfo = context.createOscillator(), depth = context.createGain();
    lfo.frequency.value = 6; depth.gain.value = frequency * vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(when); lfo.stop(when + duration + release + .05);
    lfo.onended = () => { lfo.disconnect(); depth.disconnect(); };
  }
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(volume, when + attack);
  gain.gain.setValueAtTime(volume, when + Math.max(attack, duration - release));
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration + release);
  osc.connect(gain).connect(bus);
  if (reverb) send(gain, reverbSend, reverb, when, duration + release);
  if (echo) send(gain, echoSend, echo, when, duration + release);
  osc.start(when); osc.stop(when + duration + release + .05);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

function send(from, to, amount, when, duration) {
  const g = context.createGain();
  g.gain.value = amount;
  from.connect(g).connect(to);
  setTimeout(() => g.disconnect(), (when - context.currentTime + duration + 1) * 1000);
}

/** Filtered noise burst. */
function hiss(when, duration, { frequency = 1000, q = 1, type = 'bandpass', volume = .2, bus = sfxBus,
  attack = .005, sweep = 0, reverb = 0 } = {}) {
  const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
  source.buffer = noise;
  source.playbackRate.value = .8 + Math.random() * .4;
  filter.type = type; filter.frequency.setValueAtTime(frequency, when); filter.Q.value = q;
  if (sweep) filter.frequency.exponentialRampToValueAtTime(frequency * sweep, when + duration);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(volume, when + attack);
  gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
  source.connect(filter).connect(gain).connect(bus);
  if (reverb) send(gain, reverbSend, reverb, when, duration);
  source.start(when, Math.random() * 2); source.stop(when + duration + .02);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
}

// ---- Drums --------------------------------------------------------------------
const drum = {
  kick(when, volume = .5, bus = musicBus) {
    voice(150, when, .12, { wave: 'sine', volume, bus, slide: .28, release: .08 });
    hiss(when, .02, { frequency: 3000, volume: volume * .25, bus });
  },
  snare(when, volume = .25, bus = musicBus) {
    hiss(when, .16, { frequency: 1800, q: .7, volume, bus, reverb: .15 });
    voice(190, when, .06, { wave: 'triangle', volume: volume * .6, bus, slide: .6 });
  },
  hat(when, volume = .08, open = false, bus = musicBus) {
    hiss(when, open ? .16 : .035, { frequency: 8000, type: 'highpass', volume, bus });
  },
  clap(when, volume = .12, bus = musicBus) {
    for (let i = 0; i < 3; i++) hiss(when + i * .011, .05 + i * .03, { frequency: 1400, q: 1.8, volume, bus, reverb: .2 });
  },
  crash(when, volume = .18, bus = musicBus) {
    hiss(when, 1.4, { frequency: 6000, type: 'highpass', volume, bus, reverb: .3 });
  },
};

// ---- Setup --------------------------------------------------------------------
function reverbImpulse(seconds = 1.6) {
  const length = context.sampleRate * seconds, buffer = context.createBuffer(2, length, context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
  }
  return buffer;
}

export function configure(values) {
  settings = { ...values };
  if (!context) return;
  musicBus.gain.setTargetAtTime(musicLevel(), context.currentTime, .05);
  sfxBus.gain.setTargetAtTime(settings.sfx, context.currentTime, .05);
  master.gain.setTargetAtTime(settings.muted || adMuted ? 0 : 1.5, context.currentTime, .02);
}

/** Kept for the boot sequence; the game ships no samples to download. */
export function preloadUI() { return Promise.resolve(); }

export async function unlock() {
  if (adMuted && context) return;   // taps on an ad must not wake the game's audio
  try {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      pulse = { p12: pulseWave(.125), p25: pulseWave(.25), p50: pulseWave(.5) };
      master = context.createGain();
      master.gain.value = 1.5;
      const glue = context.createDynamicsCompressor();
      glue.threshold.value = -18; glue.ratio.value = 3; glue.attack.value = .01; glue.release.value = .2;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.ratio.value = 20; limiter.attack.value = .002;
      master.connect(glue).connect(limiter).connect(context.destination);
      // Output meter for the test hook: peak and RMS of what reaches the speakers.
      meter = context.createAnalyser(); meter.fftSize = 2048; meterData = new Float32Array(meter.fftSize);
      limiter.connect(meter);
      musicBus = context.createGain(); sfxBus = context.createGain();
      musicBus.connect(master); sfxBus.connect(master);
      const reverb = context.createConvolver();
      reverb.buffer = reverbImpulse();
      reverbSend = context.createGain(); reverbSend.gain.value = .9;
      reverbSend.connect(reverb).connect(master);
      const echo = context.createDelay(1), feedback = context.createGain(), tone = context.createBiquadFilter();
      echo.delayTime.value = 60 / 160 * .75;   // dotted eighth at match tempo
      feedback.gain.value = .32;
      tone.type = 'lowpass'; tone.frequency.value = 2400;
      echoSend = context.createGain();
      echoSend.connect(echo).connect(tone).connect(feedback).connect(echo);
      tone.connect(master);
      noise = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      buildCrowd();
      configure(settings);
      nextStep = context.currentTime + .1;
      setInterval(schedule, 25);
    }
    if (!document.hidden && !adMuted && context.state !== 'running') await context.resume();
  } catch { /* Audio is optional; blocked audio must not block the game. */ }
}

/** Two noise bands: a low murmur and a brighter "voices" band, both breathing slowly. */
function buildCrowd() {
  const bed = context.createGain();
  bed.gain.value = 0;
  for (const [frequency, q, level] of [[420, .8, 1], [1300, 1.2, .45]]) {
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = noise; source.loop = true; source.playbackRate.value = .7 + Math.random() * .2;
    filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.value = level;
    const lfo = context.createOscillator(), depth = context.createGain();
    lfo.frequency.value = .13 + Math.random() * .1; depth.gain.value = level * .35;
    lfo.connect(depth).connect(gain.gain); lfo.start();
    source.connect(filter).connect(gain).connect(bed);
    source.start();
  }
  bed.connect(sfxBus);
  crowd = { bed, level: 0 };
}

// ---- Music sequencer ------------------------------------------------------------
// During play the music sits well under the game (the crowd, the kick, the net);
// menus get it at full level. Aiming ducks it further.
const MATCH_MUSIC = .25;
const musicLevel = () => settings.music * (scene === 'match' ? MATCH_MUSIC : 1) * duck;

let song = TITLE, nextSong = TITLE, matchSong = MATCH_SONGS[0];

export function setScene(value) {
  if (scene === value) return;
  scene = value;
  // A new scene starts its song from the top.
  song = nextSong = scene === 'match' ? matchSong : TITLE;
  step = 0;
  if (context) musicBus.gain.setTargetAtTime(musicLevel(), context.currentTime, .4);
  if (context) nextStep = Math.max(nextStep, context.currentTime + .15);
}

/** The level picks the match song; a change lands on the next bar line. */
export function setLevel(level) {
  matchSong = songForLevel(level);
  if (scene === 'match') nextSong = matchSong;
}

/** 0..1: how built-up the match music is (level and combo). */
export function setIntensity(value) { intensity = Math.max(0, Math.min(1, value)); }

/** Lowers the music while aiming so the shot's own sounds carry. */
export function setFocus(on) {
  if ((duck < 1) === on) return;
  duck = on ? .55 : 1;
  if (context) musicBus.gain.setTargetAtTime(musicLevel(), context.currentTime, .15);
}

function schedule() {
  if (!context || context.state !== 'running' || document.hidden) return;
  const now = context.currentTime;
  crowd.bed.gain.setTargetAtTime((scene === 'match' ? .1 : .035) * (duck < 1 ? .55 : 1) + crowd.level, now, .5);
  crowd.level = Math.max(0, crowd.level * .985 - .0005);
  if (nextStep < now) nextStep = now + .02;
  while (nextStep < now + .12) {
    if (step % 16 === 0 && nextSong !== song) { song = nextSong; step = 0; }
    const bpm = song.bpm + (scene === 'match' ? 8 * intensity : 0);
    const sixteenth = 60 / bpm / 4;
    if (settings.music > 0 && !settings.muted && !adMuted) playStep(song, step, nextStep, sixteenth);
    nextStep += sixteenth;
    step++;
  }
}

/** Where a step falls: its section, the bar within it, and whether it is the song's first bar. */
function locate(song, index) {
  let bar = Math.floor(index / 16) % song.bars;
  const first = bar === 0;
  for (const key of song.form) {
    const section = song.sections[key];
    if (bar < section.chords.length) return { section, bar, first, last: bar === section.chords.length - 1, start: bar === 0 };
    bar -= section.chords.length;
  }
  return null;
}

/** One sixteenth of drums in the section's pattern. */
function playDrums(pattern, beat, when, build) {
  if (pattern === 'four') {
    if (beat % 4 === 0) drum.kick(when, .5);
    if (beat === 4 || beat === 12) { drum.snare(when, .22); drum.clap(when, .12 * build); }
    if (beat % 4 === 2) drum.hat(when, .07, true);
    else if (build > .45) drum.hat(when, beat % 2 ? .03 : .045);
  } else if (pattern === 'rock') {
    if (beat === 0 || beat === 8 || beat === 10) drum.kick(when, .48);
    if (beat === 4 || beat === 12) drum.snare(when, .24);
    if (beat % 2 === 0) drum.hat(when, beat === 14 ? .06 : .045, beat === 14);
  } else if (pattern === 'break') {
    if (beat === 0 || beat === 6 || beat === 10) drum.kick(when, .5);
    if (beat === 4 || beat === 12) { drum.snare(when, .24); drum.clap(when, .1 * build); }
    if (beat === 14) drum.snare(when, .07);
    if (beat % 2 === 0) drum.hat(when, beat % 4 === 2 ? .06 : .04, beat % 8 === 6);
  } else if (pattern === 'half') {
    if (beat === 0) drum.kick(when, .45);
    if (beat === 8) drum.snare(when, .2);
    if (beat % 4 === 0) drum.hat(when, .035);
  }
}

function playStep(song, index, when, sixteenth) {
  const at = locate(song, index);
  const { section } = at;
  const beat = index % 16, chord = section.chords[at.bar];
  const match = scene === 'match';
  // The title plays everything; the match starts lean and fills in with intensity.
  const build = match ? .35 + .65 * intensity : 1;
  const breakdown = !section.lead;

  playDrums(section.drums, beat, when, build);
  // A snare roll and riser into every new section; a crash where one begins.
  if (at.last && beat >= 8 && !breakdown) {
    if (beat % 2 === 0 || beat >= 12) drum.snare(when, .06 + (beat - 8) * .018);
    if (beat === 8) hiss(when, sixteenth * 8, { frequency: 400, q: 1.5, volume: .06, bus: musicBus, attack: sixteenth * 7, sweep: 12 });
  }
  if (beat === 0 && at.start && index > 0) drum.crash(when, .14);

  // Bass: the section's pattern, each note held until the next.
  const pattern = BASS[section.bass], offset = pattern[beat];
  if (offset !== null) {
    let length = 1;
    while (beat + length < 16 && pattern[beat + length] === null) length++;
    const bassNote = chord[0] - 12 + offset;
    const hold = section.bass === 'pump' ? .8 : Math.min(length, 4) * .85;
    voice(midi(bassNote), when, sixteenth * hold, { wave: 'triangle', volume: .2, bus: musicBus, release: .03 });
    voice(midi(bassNote), when, sixteenth * Math.min(hold, 1), { wave: 'p12', volume: .035, bus: musicBus, release: .02 });
  }

  // Chords: offbeat stabs, or a soft held pad in a breakdown.
  if (breakdown) {
    if (beat === 0) for (const note of chord) voice(midi(note + 12), when, sixteenth * 15, { wave: 'p50', volume: song.stabs * .9,
      bus: musicBus, attack: .08, release: .3, reverb: .45, vibrato: .004 });
  } else if (beat % 4 === 2) {
    for (const note of chord) voice(midi(note + 12), when, sixteenth * 1.2, { wave: 'p50', volume: song.stabs * build,
      bus: musicBus, release: .04, reverb: .2 });
  }

  // Arpeggio: up-and-over chord tones; in a breakdown it carries the tune, slower and echoing.
  if (build > .3 || breakdown) {
    const shape = [0, 1, 2, 3, 2, 1];
    const slot = breakdown ? Math.floor(beat / 2) : beat;
    if (!breakdown || beat % 2 === 0) {
      const tone = shape[slot % shape.length];
      const note = tone === 3 ? chord[0] + 24 : chord[tone] + 12;
      voice(midi(note + 12), when, sixteenth * (breakdown ? 1.6 : .6), { wave: 'p12',
        volume: song.arp * (breakdown ? 1.5 : build), bus: musicBus, release: .02, echo: breakdown ? .35 : .1 });
    }
  }

  // Lead: doubled and slightly detuned for width; held notes get vibrato.
  const notes = section.lead?.[at.bar], note = notes?.[beat];
  if (typeof note === 'number') {
    let length = 1;
    for (let k = beat + 1; k < notes.length && notes[k] === '~'; k++) length++;
    const duration = sixteenth * length * .92, volume = song.lead_volume * (match ? .55 + .6 * intensity : 1);
    const vibrato = length > 2 ? .007 : 0;
    voice(midi(note), when, duration, { wave: 'p25', volume, bus: musicBus, vibrato, echo: .3, reverb: .15 });
    voice(midi(note) * 1.004, when, duration, { wave: 'p50', volume: volume * .45, bus: musicBus, vibrato });
  }
}

// ---- Effects ------------------------------------------------------------------
/** Ascending arpeggio stinger: notes (MIDI) spaced `gap` seconds. */
function arp(notes, when, gap, options = {}) {
  notes.forEach((note, i) => voice(midi(note), when + i * gap, options.length ?? gap * 1.2, {
    wave: 'p25', volume: .09, reverb: .25, echo: .15, ...options }));
}

function cheer(amount, when, duration = 2.2) {
  crowd.level = Math.min(.6, crowd.level + amount);
  hiss(when, duration, { frequency: 900, q: .6, volume: .35 * amount / .4, attack: .25, reverb: .3 });
  for (let i = 0; i < 12; i++) hiss(when + .1 + i * .09 + Math.random() * .05, .08,
    { frequency: 1800 + Math.random() * 1200, q: 3, volume: .05 * amount / .4 });
}

const EFFECTS = {
  // Interface
  hover: t => voice(midi(88), t, .025, { wave: 'p12', volume: .03 }),
  click: t => { voice(midi(79), t, .03, { wave: 'p25', volume: .06 }); voice(midi(91), t + .03, .03, { wave: 'p25', volume: .04 }); },
  confirm: t => arp([72, 79, 84], t, .05, { volume: .07 }),
  back: t => arp([79, 72], t, .05, { volume: .06 }),
  // A shot
  kickoff: t => voice(2600, t, .5, { wave: 'sine', volume: .06, vibrato: .02, release: .1 }),
  aim: t => { voice(midi(76), t, .04, { wave: 'p50', volume: .07 }); voice(midi(83), t + .045, .06, { wave: 'p50', volume: .07 }); },
  power: t => voice(midi(72), t, .12, { wave: 'p25', volume: .08, slide: 2 }),
  kick: t => {
    voice(180, t, .09, { wave: 'sine', volume: .55, slide: .3 });
    hiss(t, .03, { frequency: 2400, volume: .3 });
    voice(midi(60), t, .05, { wave: 'p12', volume: .05, slide: .5 });
  },
  whoosh: t => hiss(t + .02, .38, { frequency: 700, q: 2, volume: .16, sweep: 3.5 }),
  bounce: t => voice(120, t, .07, { wave: 'sine', volume: .22, slide: .5 }),
  net: t => { hiss(t, .5, { frequency: 3200, q: .8, volume: .22, sweep: .5 }); voice(90, t, .18, { wave: 'sine', volume: .25, slide: .6 }); },
  post: t => clang(t, 620),
  bar: t => clang(t, 470),
  save: t => { voice(140, t, .08, { wave: 'sine', volume: .4, slide: .4 }); hiss(t, .09, { frequency: 1500, volume: .3 });
    hiss(t + .1, .9, { frequency: 380, q: 1, volume: .18, attack: .15 }); },
  block: t => { voice(100, t, .1, { wave: 'sine', volume: .45, slide: .45 }); hiss(t, .07, { frequency: 700, volume: .25 }); },
  // Verdicts
  cheer: t => cheer(.4, t),
  // Bullseye: the stadium erupts - a long roar with a second swell, rhythmic
  // clapping and an air horn.
  bigCheer: t => {
    cheer(.6, t, 4.5);
    hiss(t + 1.3, 3.2, { frequency: 1100, q: .5, volume: .3, attack: .6, reverb: .35 });
    for (const [bar, beats] of [[1.4, 3], [2.4, 3], [3.4, 5]]) {
      for (let i = 0; i < beats; i++) drum.clap(t + bar + i * .19, .16, sfxBus);
    }
    for (const [f, delay] of [[233, 0], [293, .02], [349, .04]]) {
      voice(f, t + .25 + delay, .7, { wave: 'sawtooth', volume: .045, slide: .97, release: .15, reverb: .3 });
      voice(f, t + 1.05 + delay, .9, { wave: 'sawtooth', volume: .04, slide: .96, release: .2, reverb: .3 });
    }
  },
  groan: t => { hiss(t, 1.1, { frequency: 330, q: 1, volume: .3, attack: .2, sweep: .7 }); crowd.level = Math.max(0, crowd.level - .03); },
  goal: t => { drum.kick(t, .5, sfxBus); arp([60, 64, 67, 72], t, .07); drum.crash(t + .28, .14, sfxBus); },
  target: t => { drum.kick(t, .5, sfxBus); arp([64, 67, 72, 76, 79], t, .06); drum.crash(t + .3, .16, sfxBus); },
  bullseye: t => {
    drum.kick(t, .6, sfxBus); arp([67, 72, 76, 79, 84, 88], t, .055, { volume: .1 });
    drum.crash(t + .33, .2, sfxBus);
    // Coin sparkle.
    for (let i = 0; i < 6; i++) voice(midi(96 + (i % 3) * 3), t + .35 + i * .06, .05, { wave: 'sine', volume: .05, reverb: .3 });
  },
  combo: (t, n = 2) => arp([72 + n * 2, 79 + n * 2], t + .5, .06, { wave: 'p12', volume: .07 }),
  extraLife: t => arp([76, 79, 88, 84, 86, 91], t + .45, .085, { wave: 'p50', volume: .08, length: .09 }),
  miss: t => [67, 66, 65, 62].forEach((note, i) => voice(midi(note), t + .15 + i * .22, i === 3 ? .5 : .2,
    { wave: 'p50', volume: .07, vibrato: i === 3 ? .02 : 0, slide: i === 3 ? .94 : 1 })),
  loseHeart: t => { voice(midi(45), t, .25, { wave: 'p25', volume: .1, slide: .7 }); voice(midi(40), t + .12, .3, { wave: 'p12', volume: .07, slide: .7 }); },
  warning: t => { for (let i = 0; i < 2; i++) { drum.kick(t + .9 + i * .28, .35, sfxBus); } },
  levelUp: t => {
    arp([60, 64, 67, 72, 67, 72, 76, 79], t, .08, { volume: .09 });
    arp([48, 55, 60], t, .16, { wave: 'triangle', volume: .18, length: .2 });
    drum.crash(t + .6, .2, sfxBus);
  },
  gameOver: t => [72, 67, 64, 60, 55].forEach((note, i) => voice(midi(note), t + i * .2, i === 4 ? .9 : .18,
    { wave: 'p25', volume: .09, reverb: .35, vibrato: i === 4 ? .015 : 0 })),
  newBest: t => { arp([60, 64, 67, 72, 76, 79, 84], t, .07, { volume: .09 }); arp([72, 76, 79, 84], t + .6, .12, { wave: 'p50', volume: .07, length: .3 });
    drum.crash(t + .55, .22, sfxBus); for (let i = 0; i < 8; i++) voice(midi(96 + (i % 4) * 2), t + .8 + i * .07, .05, { wave: 'sine', volume: .05 }); },
};

/** Woodwork: inharmonic partials ringing out, like a struck metal pipe. */
function clang(t, base) {
  [1, 2.76, 5.4, 8.93].forEach((ratio, i) => voice(base * ratio, t, .9 / (i + 1), { wave: 'sine', volume: .12 / (i + 1),
    release: .3, reverb: .3 }));
  hiss(t, .04, { frequency: 4000, volume: .2 });
}

export function play(name, arg) {
  if (!context || context.state !== 'running' || document.hidden || settings.sfx === 0 || settings.muted || adMuted) return;
  const effect = EFFECTS[name];
  if (!effect) return;
  const now = context.currentTime;
  if (now - (lastPlayed.get(name) ?? -100) < (name === 'hover' ? .06 : .08)) return;
  lastPlayed.set(name, now);
  played[name] = (played[name] || 0) + 1;
  effect(now + .005, arg);
}

/** The height meter: a pulse tone that rises with power, with a chip tremolo. */
export function setPower(value) {
  if (!context || context.state !== 'running') return;
  if (value === null) {
    if (powerTone) {
      powerTone.gain.gain.setTargetAtTime(0, context.currentTime, .02);
      powerTone.osc.stop(context.currentTime + .1);
      powerTone.lfo.stop(context.currentTime + .1);
      powerTone = null;
    }
    return;
  }
  if (!powerTone) {
    const osc = context.createOscillator(), gain = context.createGain();
    const lfo = context.createOscillator(), depth = context.createGain();
    osc.setPeriodicWave(pulse.p25);
    gain.gain.value = .03;
    lfo.type = 'square'; lfo.frequency.value = 14; depth.gain.value = .02;
    lfo.connect(depth).connect(gain.gain);
    osc.connect(gain).connect(sfxBus);
    osc.start(); lfo.start();
    osc.onended = () => { osc.disconnect(); gain.disconnect(); lfo.disconnect(); depth.disconnect(); };
    powerTone = { osc, gain, lfo };
  }
  // Quantized to semitones, so the rise sounds like a chip scale, not a siren.
  const note = Math.round(57 + value * 26);
  powerTone.osc.frequency.setTargetAtTime(midi(note), context.currentTime, .005);
}

/** Ads: silence everything (Poki requires audio off during breaks). */
let adMuted = false;
/**
 * Ads: silence everything at once (Poki requires audio off during breaks) by
 * cutting the master gain and suspending the audio clock; afterwards resume
 * and return to the player's own setting (SOUND OFF stays off).
 */
export function setMuted(on) {
  if (adMuted === on) return;
  adMuted = on;
  if (!context) return;
  setPower(null);
  const now = context.currentTime;
  master.gain.cancelScheduledValues(now);
  if (on) {
    master.gain.setValueAtTime(0, now);
    context.suspend().catch(() => {});
  } else {
    master.gain.setValueAtTime(0, now);
    master.gain.setTargetAtTime(settings.muted ? 0 : 1.5, now, .05);
    if (!document.hidden) context.resume().catch(() => {});
  }
}

/** The pause panel: music drops to a murmur, the power tone stops. */
export function setPaused(on) {
  if (!context) return;
  setPower(null);
  musicBus.gain.setTargetAtTime(on ? settings.music * .25 : musicLevel(), context.currentTime, .1);
}

export function visibility() {
  if (!context) return;
  setPower(null);
  if (document.hidden) context.suspend().catch(() => {});
  else if (!adMuted) context.resume().catch(() => {});   // an ad keeps the game silent
}

function level() {
  if (!meter) return null;
  meter.getFloatTimeDomainData(meterData);
  let peak = 0, sum = 0;
  for (const v of meterData) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { peak, rms: Math.sqrt(sum / meterData.length) };
}

export const status = () => ({ state: context?.state || 'locked', scene, song: song.name || 'title', intensity, settings: { ...settings },
  played: { ...played }, level: level() });

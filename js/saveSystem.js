/**
 * saveSystem.js - the only module that touches localStorage.
 * Keeps the arcade best score, the sound on/off setting (plus the mix) and
 * the progression between runs.
 * Never throws: storage may be blocked (private mode, quota), in which case
 * the game still plays.
 */

// Every key carries the Poki saved-game prefix. Saves written before the
// prefix (plain 'blockstriker.*') are still read, then rewritten under it.
const PREFIX = 'pokisavedgame.';
const BEST_KEY = PREFIX + 'blockstriker.best.v1';
const AUDIO_KEY = PREFIX + 'blockstriker.audio.v1';
const PROGRESS_KEY = PREFIX + 'blockstriker.progress.v1';

/** Raw stored string for a key, falling back to its unprefixed legacy key. */
function read(key) {
  return localStorage.getItem(key) ?? localStorage.getItem(key.slice(PREFIX.length));
}

export function loadAudio() {
  let data;
  try { data = JSON.parse(read(AUDIO_KEY)); } catch { /* defaults */ }
  const volume = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return { music: volume(data?.music, .3), sfx: volume(data?.sfx, .65), muted: data?.muted === true };
}

export function saveAudio(settings) {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(settings)); } catch { /* optional */ }
}

export function loadBest() {
  try {
    const value = Number(JSON.parse(read(BEST_KEY)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(score)); } catch { /* optional */ }
}

/** Progression between runs (XP, missions, daily streak); progress.js owns its shape. */
export function loadProgress() {
  try { return JSON.parse(read(PROGRESS_KEY)) || null; } catch { return null; }
}

export function saveProgress(data) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); } catch { /* optional */ }
}

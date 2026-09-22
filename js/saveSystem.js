/**
 * saveSystem.js - the only module that touches localStorage.
 * Keeps the arcade best score and the sound on/off setting (plus the mix).
 * Never throws: storage may be blocked (private mode, quota), in which case
 * the game still plays.
 */

const BEST_KEY = 'blockstriker.best.v1';
const AUDIO_KEY = 'blockstriker.audio.v1';

export function loadAudio() {
  let data;
  try { data = JSON.parse(localStorage.getItem(AUDIO_KEY)); } catch { /* defaults */ }
  const volume = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return { music: volume(data?.music, .3), sfx: volume(data?.sfx, .65), muted: data?.muted === true };
}

export function saveAudio(settings) {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(settings)); } catch { /* optional */ }
}

export function loadBest() {
  try {
    const value = Number(JSON.parse(localStorage.getItem(BEST_KEY)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBest(score) {
  try { localStorage.setItem(BEST_KEY, JSON.stringify(score)); } catch { /* optional */ }
}

/**
 * saveSystem.js — the only module that touches localStorage.
 * Persists lifetime Legacy Points and permanent meta-upgrade levels.
 */

const KEY = 'benched.career.v1';
const AUDIO_KEY = 'benched.audio.v1';
let previewMode = false;
export function setPreviewMode(enabled) { previewMode = enabled; }

export function loadAudio() {
  let data;
  try { data = JSON.parse(localStorage.getItem(AUDIO_KEY)); } catch { /* defaults */ }
  const volume = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return { music: volume(data?.music, .3), sfx: volume(data?.sfx, .65) };
}

export function saveAudio(settings) {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(settings)); } catch { /* optional */ }
}

const BLANK = () => ({
  tutorialComplete: false,
  legacy: 0,
  lifetimeGoals: 0,
  bestRun: 0,      // most matches survived
  runs: 0,
  records: {
    seasons: 0, matches: 0, wins: 0, draws: 0, losses: 0,
    titles: 0, benchings: 0, bestSeasonGoals: 0,
    bestTrainingLevels: 0, fullyUpgradedSeasons: 0,
  },
  currentCareer: null,
  meta: { star: 0, subnet: 0, talent: 0, veins: 0, pet: 0, boot: 0 },
});

const CAREER_RECORD = () => ({
  seasons: 0, goals: 0, matches: 0, wins: 0, draws: 0, losses: 0,
  titles: 0, benchings: 0, bestSeasonGoals: 0,
  bestTrainingLevels: 0, fullyUpgradedSeasons: 0,
});

const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** Reads and repairs the career record. Never throws — storage may be blocked. */
export function load() {
  const fresh = BLANK();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const data = JSON.parse(raw);
    const out = { ...fresh, ...data,
      records: { ...fresh.records, ...(data.records || {}) },
      meta: { ...fresh.meta, ...(data.meta || {}) } };
    // Records from before onboarding belong to returning players.
    out.tutorialComplete = data.tutorialComplete === undefined ? true : data.tutorialComplete === true;
    for (const key of Object.keys(fresh.records)) out.records[key] = safeCount(out.records[key]);
    // Older saves know season and goal totals, but cannot reconstruct their
    // historical W-D-L or upgrade distributions.
    if (!data.records) out.records.seasons = safeCount(data.runs);
    if (data.currentCareer && typeof data.currentCareer.characterId === 'string') {
      out.currentCareer = { ...CAREER_RECORD(), ...data.currentCareer,
        characterId: data.currentCareer.characterId };
      for (const key of Object.keys(CAREER_RECORD())) {
        out.currentCareer[key] = safeCount(out.currentCareer[key]);
      }
    } else out.currentCareer = typeof out.characterId === 'string'
      ? { ...CAREER_RECORD(), characterId: out.characterId } : null;
    for (const k of Object.keys(fresh.meta)) {
      out.meta[k] = Math.max(0, Math.min(5, out.meta[k] | 0));
    }
    return out;
  } catch {
    return fresh;
  }
}

export function save(career) {
  if (previewMode) return true;
  try {
    localStorage.setItem(KEY, JSON.stringify(career));
    return true;
  } catch {
    return false;   // private mode / quota — the run still plays, it just won't persist
  }
}

export function wipe() {
  // Reset career progress, not first-play onboarding. Persist the fresh record
  // so a reload also remembers that the tutorial was already completed.
  const fresh = BLANK();
  fresh.tutorialComplete = load().tutorialComplete;
  save(fresh);
  return fresh;
}

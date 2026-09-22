/**
 * saveSystem.js — the only module that touches localStorage.
 * Persists lifetime Legacy Points and permanent meta-upgrade levels.
 */

const KEY = 'benched.career.v1';

const BLANK = () => ({
  tutorialComplete: false,
  legacy: 0,
  lifetimeGoals: 0,
  bestRun: 0,      // most matches survived
  runs: 0,
  meta: { star: 0, subnet: 0, talent: 0, veins: 0, pet: 0, boot: 0 },
});

/** Reads and repairs the career record. Never throws — storage may be blocked. */
export function load() {
  const fresh = BLANK();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const data = JSON.parse(raw);
    const out = { ...fresh, ...data, meta: { ...fresh.meta, ...(data.meta || {}) } };
    // Records from before onboarding belong to returning players.
    out.tutorialComplete = data.tutorialComplete === undefined ? true : data.tutorialComplete === true;
    for (const k of Object.keys(fresh.meta)) {
      out.meta[k] = Math.max(0, Math.min(5, out.meta[k] | 0));
    }
    return out;
  } catch {
    return fresh;
  }
}

export function save(career) {
  try {
    localStorage.setItem(KEY, JSON.stringify(career));
    return true;
  } catch {
    return false;   // private mode / quota — the run still plays, it just won't persist
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
  return BLANK();
}

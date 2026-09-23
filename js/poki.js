/**
 * poki.js - the only module that talks to the Poki SDK.
 *
 * The SDK script is loaded by index.html from Poki's CDN. If it is missing
 * (ad blocker, offline, local development) every call below still resolves,
 * so the game plays exactly the same without it.
 *
 * Poki rules enforced here: gameplayStart / gameplayStop never fire twice in a
 * row, and ad breaks report back so the caller can mute and block input.
 */
const sdk = () => window.PokiSDK;
let playing = false;
let inBreak = false;

export async function init() {
  try { await sdk()?.init(); } catch { /* load the game anyway */ }
}

export function loadingFinished() {
  try { sdk()?.gameLoadingFinished(); } catch { /* optional */ }
}

export function gameplayStart() {
  if (playing) return;
  playing = true;
  try { sdk()?.gameplayStart(); } catch { /* optional */ }
}

export function gameplayStop() {
  if (!playing) return;
  playing = false;
  try { sdk()?.gameplayStop(); } catch { /* optional */ }
}

export const isPlaying = () => playing;
export const isInBreak = () => inBreak;

/**
 * A commercial break before gameplay resumes. `onPause` runs as soon as the
 * break is requested - not only when the SDK reports the ad starting, which it
 * may do late or not at all - and `onResume` once play may continue.
 */
export async function commercialBreak(onPause, onResume) {
  if (!sdk() || inBreak) return;
  inBreak = true;
  onPause?.();
  try { await sdk().commercialBreak(() => onPause?.()); } catch { /* no ad */ }
  inBreak = false;
  onResume?.();
}

/** A rewarded break; resolves true only if the reward was earned. */
export async function rewardedBreak(onPause, onResume) {
  if (!sdk() || inBreak) return false;
  inBreak = true;
  onPause?.();
  let success = false;
  try { success = !!await sdk().rewardedBreak(() => onPause?.()); } catch { success = false; }
  inBreak = false;
  onResume?.();
  return success;
}

/**
 * Analytics: Poki's game events. `category`, `what`, `action` are stable
 * strings without '/' or '^'; progress uses the actions start, complete and
 * fail, buttons visible and interact.
 */
export function measure(category, what, action) {
  try { sdk()?.measure?.(String(category), String(what), String(action)); } catch { /* optional */ }
}

/** Mobile only: moves Poki's pill down to `topPx`, clear of the score. */
export function movePill(topPx) {
  try { sdk()?.movePill(0, Math.round(topPx)); } catch { /* optional */ }
}

/** Rewarded ads need the SDK; without it the reward button is not offered. */
export const rewardsAvailable = () => !!sdk();

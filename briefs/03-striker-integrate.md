# Task: put the Captain in the game as the striker

`assets/striker.glb` is the rigged, animated Captain (22 bones, clips `idle`, `walk`, `run`,
`kick`), and `assets/striker.json` is its sidecar (clip durations, measured ground `speed` for walk
and run, the kick's `contact` time, and `kickFoot`, the instep position at contact relative to the
root in three.js axes). Both were built by `tools/blender/build_striker.py` and reviewed. This task
replaces the procedural #9 striker with the Captain. **Every other player stays exactly as it is.**

## Build
1. **Loading.** In `index.html`, add `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"`
   to the import map and change nothing else there. Load the GLB and the sidecar **once at boot**
   with `GLTFLoader`. `boot()` may await it; `__demo.ready` must only become true after the
   striker is final. If loading fails or takes over 10 s, keep the procedural striker, call
   `console.warn` once (not `console.error`), and carry on. The game must stay playable.
2. **One striker interface.** `squad.striker` keeps a `root` that every existing caller moves
   (`setupChance`, `placeStrikerForKick`, `strikerFollowThrough`, `separate`, `seedRun` and the
   ambient/build-up actor loop). Behind it is either the Captain or the procedural fallback. Build
   the procedural striker as today, so the fallback costs nothing extra, and hide it when the
   Captain is in. Cast shadows from the Captain, and set `frustumCulled = false` on its skinned
   mesh, since its bind-pose bounds don't cover a raised kicking leg.
3. **Locomotion by speed.** Where the actor loop calls `poseRun` for the striker, drive the
   Captain's `AnimationMixer` from the actor's smoothed `speed` instead:
   - Weights: `idle` below about 0.3 m/s, blending to `walk` around the sidecar walk speed, then
     to `run` above it. Pick smooth breakpoints and keep them as named constants.
   - Playback: `timeScale = speed / clip.speed` for walk and run, so the planted foot doesn't
     slide. The sidecar speeds are measured for exactly this.
   - **Phase-sync walk and run** (one shared normalised phase, advanced by the dt-scaled weighted
     rate), so blending never tangles his legs. The clips do **not** start at the same foot
     event: measured in review, their left-toe events differ by about 0.12 of a cycle, which is
     roughly 45 degrees of gait out of step. At load, find each clip's left-foot event the same
     way for both (for example the lowest point of `toe_L`) and offset one so they line up.
   - Advance the mixer with the frame dt, once per frame, in one place.
4. **Idle while aiming.** During `AIM` and `POWER` he plays `idle` in place. He does **not**
   rotate or pivot as the aim sweeps (the user asked for this explicitly). He stays planted where
   `setupChance` put him.
5. **The kick is scrubbed from the game's timers, not played.** It must be framerate-independent
   and land exactly on the launch:
   - During `WINDUP`: `kickTime = (shot.windup / SHOT.WINDUP) * contact`. At the instant of
     `launch()` the clip is exactly at `contact`.
   - During `FLIGHT` and the hold after it: `kickTime = contact + shot.flightTime`, clamped to the
     clip's duration. The clip ends in the idle pose, so then fade to `idle` (about 0.15 s) with
     no pop.
   - Replace the procedural `shot.swing` path **for the Captain**. Today swing decays back toward
     0 after contact, which would scrub the Captain's kick backwards. Keep the procedural path
     working for the fallback. Keep `strikerFollowThrough` as it is.
6. **Foot on the ball.** Replace `FOOT_SIDE` and `FOOT_FWD` for the Captain with the sidecar's
   `kickFoot`, placing the root so that **at the contact frame the instep touches the back of the
   ball**: the instep is `BALL_R` (±5 cm) from the ball's centre, behind it along the shot
   direction. Keep the facing he gets today. Keep the constants for the procedural fallback.
7. **Test contract.** Extend `window.__demo` (never rename anything) with
   `striker: { model: 'captain' | 'procedural', mixer, root, bone(name), weights() }`, where
   `weights()` returns the current effective weight of each clip, and
   `lastLaunch: { instep: [x,y,z], ball: [x,y,z] }`, written once at the moment the ball is
   launched.
8. **`tools/striker.mjs`** (Playwright, built on `tools/lib.mjs`, real input only), plus the
   `package.json` script `"striker": "node tools/striker.mjs"`:
   - asserts `striker.model === 'captain'`;
   - **during a build-up run** (SIM with the striker moving over 4 m/s), samples `toe_L` and
     `toe_R` world positions each frame. Whenever a toe is planted (within 3 cm of the floor for
     two frames running), its horizontal world speed must stay under **1.0 m/s** at the median
     (no skating). Report the median and p90;
   - during `AIM`, `idle` weight is at least 0.9 and the root doesn't rotate across the sweep;
   - at launch, `lastLaunch` has the instep between `BALL_R - 0.05` and `BALL_R + 0.05` from the
     ball's centre, and behind it relative to the shot;
   - after the kick, `idle` returns and no bone jumps more than 8 degrees between consecutive
     frames across the kick-to-idle handover;
   - saves `.captures/striker-{aim,windup,contact,flight,run}.png`. The run shot is framed on the
     striker, side-on, mid build-up, not a wide shot;
   - frame p95 under 25 ms on hardware GPUs (as in `validate.mjs`), and no runtime errors.
9. `tools/validate.mjs`: also assert `__demo.striker.model === 'captain'`.

## Constraints
- AGENTS.md invariants hold: instantiate once, no per-frame allocation (no `new`, object
  literals or arrays in the loop; the mixer's own internals are fine), framerate independence,
  and the `__demo` shape (extend only).
- **No gameplay or difficulty change.** The striker has no collision capsules, so conversion rates
  must not move. Don't touch `physics.js`, the keeper and defender AI, or the `SHOT` and `LIFT`
  values, apart from reading `SHOT.WINDUP`.
- Other players, kits, cameras, UI and the save format are unchanged.

## Files
`js/gameEngine.js`, `js/app.js`, `index.html` (import map entry only), `tools/striker.mjs`
(new), `tools/validate.mjs` (one assertion), `package.json` (scripts only). Don't regenerate
the assets. The server is already running at http://localhost:5173; test against it with
`CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`. Don't start your own.

## Done when
`npm run check` and `npm run striker` both pass, twice each, on real Chrome. Report the toe
slide median and p90 during the run, the instep-to-ball distance at launch, the frame stats and
where the locomotion breakpoints ended up. Keep the report short.

# Implementer instructions (Codex)

You are the implementer. A Claude Code orchestrator plans the work, sends you one scoped task
at a time, and reviews your diff before the next one. Tasks come with a goal, an allowed file
list, constraints, and "done when" criteria.

## Project

BENCHED, a turn-based attacking-football roguelite in Three.js. It is plain ES modules served
statically: no bundler, no build step, no npm runtime dependencies. Three.js 0.169 comes from
the CDN import map in `index.html`. Follow the surrounding code style (2-space indent, single
quotes, semicolons).

Specs: `pokistriker.md` (design), `engineering space.md` (architecture), and README "Notes on
the implementation" (what the code actually does, including two deliberate deviations from the
specs). The README wins where they disagree.

**Test contract:** `window.__demo`, set in `boot()` in `js/app.js`, exposes `renderer`,
`scene`, `camera`, `state`, `shot`, `ball` and `ready`. Everything in `tools/` reads it. Extend
it when a task adds state worth testing; never rename or remove what's there.

## File boundaries

- `js/app.js`: the state machine and **all** game data (run, career, upgrades, AI tuning).
- `js/gameEngine.js`: the single place Three.js objects are created. Scene, squad rigs, ambient
  match, build-up choreography, render loop.
- `js/physics.js`: vector maths, ball kinetics, swept collision. No physics libraries (Ammo,
  Cannon, Rapier or similar).
- `js/uiManager.js`: every DOM write.
- `js/saveSystem.js`: the `localStorage` interface, nothing else.

## Rules

- Touch only the files the task lists. If it can't be done within them, stop and say which file
  you need and why.
- No drive-by refactors, reformatting or renames outside the task.
- No new dependencies unless the task says so (your sandbox has no network anyway).
- Don't run `git add`, `git commit`, `git stash` or other git writes; the orchestrator owns git.
- Don't start servers; one is already running at http://localhost:5173. Run browser tests
  against it with `CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`. The
  bundled headless shell is ~10x slower and fails timing checks.
- Keep the frame budget: 16.7 ms at 60 fps.

## Project invariants

- **Instantiate once.** Scene objects are built at boot and repositioned per chance
  (`position.set`), never torn down and rebuilt.
- **The scene is not a data store.** Currency, morale and skill levels live in `app.js` state.
- **Framerate independence.** All motion scales by the frame delta, and ball flight integrates at
  the fixed `PHYS_DT` (1/240 s) substep. Results must agree at 30, 60 and 144 Hz.
- **No allocation in per-frame paths.** No `new THREE.Vector3`, object literals or arrays inside
  the loop; reuse file-level scratch objects.
- **Collision is swept** (segment-to-segment distance against summed radii), because the ball
  travels farther per frame than a post or a keeper is wide. Never replace it with per-frame
  point tests.
- **Collision follows the animation.** Keeper and defender capsules are read from live rig
  joints, so what you see reaching for the ball is what collides.
- **A goal must be entered:** the ball crosses the line inside the frame and gets fully over it.
  The net is gated on the same flag.
- **Difficulty is tuned** (README "Difficulty" table). Any change to physics, keeper or defender
  AI, or the `SHOT` and `LIFT` constants shifts conversion rates. Say so in your report.

## Final message

End every task with:

- **Changed**: each file and a one-line summary.
- **Verified**: the commands you ran and their results.
- **Not done / assumptions**: anything skipped, uncertain, or decided without guidance.

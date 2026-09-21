# Task: add the `window.__demo` test contract and a browser smoke test

BENCHED has no automated checks. Every later task will be reviewed through a Playwright harness
that reads game state off `window.__demo`, so this task adds both. **No gameplay change**: the
game must behave identically with the hook present.

## Build
1. In `js/gameEngine.js`, export read access to the existing `renderer`, `scene` and `camera`
   (they are module-level `let`s assigned in `init()`): getter functions or an exported object
   filled in `init()`. Create no new Three.js objects.
2. In `boot()` in `js/app.js`, after `engine.init(...)`, set `window.__demo` to an object that
   holds live references, not copies:
   - `renderer`, `scene`, `camera`
   - `state` (the app state object: `screen`, `phase`, `run`, `career`)
   - `shot` (the shot record: `theta`, `power`, `resolved`, ...)
   - `ball` (the ball mesh, `engine.objects.ball`)
   - `ready`: `false` until the first frame has rendered, then `true`. Set it once; don't add
     per-frame work for it.
3. `tools/lib.mjs`: shared Playwright helpers. Model them on
   `D:/Projects/agent-game-starter/tools/lib.mjs` (read it; don't copy its player/WASD
   helpers). Launch Chrome from `CHROMIUM_PATH` with `--enable-webgl --ignore-gpu-blocklist`,
   collect `pageerror` and console errors, open `DEMO_URL` (default `http://localhost:5173`),
   wait for `__demo.ready`, and provide frame-time sampling and stats. Use a fresh browser
   context, so `localStorage` starts empty.
4. `tools/validate.mjs [name]` (default name `check`) plays one chance end to end:
   - From the menu, click the start button to begin a run.
   - Wait up to 15 s for `state.phase === 'AIM'`, then save `.captures/<name>-aim.png`.
   - Press Space to lock aim (`AIM` to `POWER`). Wait until `shot.power` is within 0.55-0.7 and
     press Space again to set power (`POWER` to `WINDUP`). The shot then launches on its own:
     `WINDUP` to `FLIGHT`. Two presses per chance, per `advance()`; the README's "three times"
     is out of date.
   - Once `state.phase === 'FLIGHT'`, save `.captures/<name>-flight.png` mid-flight.
   - Wait for the chance to resolve and record `shot.resolved`. Then confirm the match clock
     (`state.run.clock`) advances again once `state.phase` returns to `'SIM'`.
   - Sample 300 frames during SIM. Fail if p95 is 25 ms or more, unless the GPU string shows
     software rendering (SwiftShader, llvmpipe), in which case warn instead.
   - Assert there were no runtime errors from load to exit.
   - Write `.captures/<name>.json` (errors, outcome, powers pressed, frame stats, GPU string),
     print it, and exit non-zero on any failure.
5. `package.json`: add `"check": "node tools/validate.mjs check"`. Playwright is already
   installed as a devDependency; add nothing else.

## Constraints
- The AGENTS.md invariants hold. The `js/` diff should be limited to the exports and the
  `__demo` block.
- The game still runs with no server-side tooling: `index.html` and the import map are
  unchanged.
- Drive the game through real input (Space and mouse clicks), not by calling game functions.

## Files
`js/gameEngine.js` (exports only), `js/app.js` (`boot()` only), `tools/lib.mjs` (new),
`tools/validate.mjs` (new), `package.json` (scripts only).
The server is already running at http://localhost:5173; test against it with
`CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`. Don't start your own.

## Done when
`npm run check` passes against the running server on real Chrome, and a second run passes too
(outcomes are random, so the harness must not depend on the result). Report the outcome, the
power pressed and the frame stats from both runs. Keep the report short.

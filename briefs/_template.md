# Task: <one-line goal>

<Two or three sentences of context: what exists now, what the user asked for, why this change.
Attach reference images with `--image a.png,b.png` when the goal is visual.>

## Build
1. <Concrete, checkable step.>
2. <Numbers where they matter: speeds, durations, conversion rates, budgets.>

## Constraints
- The invariants in AGENTS.md hold (instantiate once, no per-frame allocation, swept collision,
  framerate independence, the `window.__demo` shape).
- <What must not change: controls, difficulty, save format.>

## Files
`<file>`, `<file>`, and the tests whose assumptions this breaks: `tools/<test>.mjs`.
The server is already running at http://localhost:5173; test against it with
`CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`. Don't start your own.

## Done when
`npm run check` passes.
<Plus the observable criteria specific to this task.> Keep the report short.

# BLOCK STRIKER (clone of pokistriker): working rules

This repo is a clone of pokistriker turned into a blocky, Minecraft-style arcade game. The
user asked Claude to implement this clone directly rather than delegating to Codex, so Claude
edits `js/`, `index.html`, `style.css` and `tools/` here and says so in commit messages.
`AGENTS.md` still describes the project for any Codex task the user chooses to run.
Claude owns git and commits at clean checkpoints, asking the user first.

## Commands

- `npm start`: static server on http://localhost:5174 (the original game uses 5173). There is
  no build step: plain ES modules, Three.js vendored under `vendor/three` via the import map in
  `index.html`. Start it in the background before browser tests and leave it running.
- `npm run check`: arcade smoke test (title, aimed shots, level-up, extra life, game over, best
  score, frame timing).
- `npm run balance`: conversion and precision tiers by level (README "Difficulty").
- `node "<codex-orchestrate skill>/scripts/codex-usage.mjs" --check`: Codex plan windows, run
  before every delegation.

Run browser tools with real Chrome, not Playwright's bundled headless shell:
`CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.

## The test contract

`window.__demo`, set in `boot()` in `js/app.js`, is what every tool in `tools/` reads:
`renderer`, `scene`, `camera`, `state` (`screen`, `phase`, `run`, `best`), `shot`, `ball`,
`target`, `arcade`, `prediction`, `ready`. Extend it; don't rename it.

## Specs

The README is the design (rules, difficulty, look) and describes what the code actually does.
`engineering space.md` holds the original architecture and coding rules, which still apply
(instantiate once, no per-frame allocation, swept collision, framerate independence).

## Reviewing this game

- **Outcomes are random** (`Math.random` throughout: chance spots, blockers, keeper reads,
  deflections). One chance proves nothing about difficulty. After any change to physics,
  keeper or defender AI, `ARCADE`/`TARGET`/`SHOT` or `LIFT`, re-measure conversion over many
  shots against the README "Difficulty" table (`npm run balance`).
- **Visual checks:** screenshots at the aim phase, mid-flight and at the result, across chances
  with different spots and blocker counts.
- **Framerate independence is a spec requirement:** check anything that moves at more than one
  frame rate.

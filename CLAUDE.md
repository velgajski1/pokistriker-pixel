# BENCHED (pokistriker): orchestration rules

**Claude orchestrates, Codex implements.** Every change to game code goes through the
`codex-orchestrate` skill: usage check, brief, `codex exec` in the background, review, follow-up
on the same thread. Codex's rules for this project are in `AGENTS.md`.

Claude does not edit `js/`, `index.html`, `style.css` or `tools/` unless the user explicitly
asks; then say so in the commit message. Claude owns git and commits at clean checkpoints,
asking the user first.

## Commands

- `npm start`: static server on http://localhost:5173. There is no build step: the game is
  plain ES modules, with Three.js from the CDN import map in `index.html`. Start it in the
  background before a Codex task that runs browser tests, and leave it running.
- `npm run check`: browser smoke test (added by `briefs/01-test-harness.md`).
- `node "<codex-orchestrate skill>/scripts/codex-usage.mjs" --check`: Codex plan windows, run
  before every delegation.

Run browser tools with real Chrome, not Playwright's bundled headless shell:
`CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.

## The test contract

`window.__demo`, set in `boot()` in `js/app.js`, is what every tool in `tools/` reads:
`renderer`, `scene`, `camera`, `state` (`screen`, `phase`, `run`, `career`), `shot`, `ball`,
`ready`. Extend it; don't rename it. *Added by task 01; until that lands there is no hook.*

## Specs

`pokistriker.md` is the game design, `engineering space.md` the architecture and coding rules,
and README "Notes on the implementation" describes what the code actually does, including two
deliberate deviations from the specs. Where they disagree, the README wins.

## Reviewing this game

- **Outcomes are random** (`Math.random` throughout: chance spots, blockers, keeper reads,
  deflections). One chance proves nothing about difficulty. After any change to physics,
  keeper or defender AI, or the `SHOT` and `LIFT` constants, re-measure conversion over many
  chances against the README "Difficulty" table.
- **Visual checks:** screenshots at the aim phase, mid-flight and at the result, across chances
  with different spots and blocker counts.
- **Framerate independence is a spec requirement:** check anything that moves at more than one
  frame rate.

# Block Striker - Arcade Football

A blocky arcade football shooter for the browser. Each chance puts a target on
the goal: lock the aim arrow on it, set the height, and shoot. Precision scores,
consecutive target hits build a combo, and anything that is not a goal costs a
heart. Every three goals the level rises: the keeper and defence, useless at
first, get sharper, the arrow speeds up and the target shrinks.

Plain ES modules and Three.js r169 (the official minified build, vendored under
`vendor/three`), no build step.
It began as a clone of *Striker Streak* (pokistriker); the shot physics, keeper
and defender AI, net and animation rig are carried over, while the visuals,
game mode and interface are new.

## Run it

```bash
npm install          # Playwright, for the browser checks only
npm start            # static server on http://localhost:5174
npm run check        # arcade smoke test (needs the server running)
npm run balance      # conversion and precision by level
```

Browser checks use real Chrome: `CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.
`DEMO_URL` overrides the server address. `?pixel=300` renders through an
optional low-resolution pixel filter (300 rows); it is off by default.

## Controls

The game opens straight into the first chance. Tap, click, Space or Enter:
the first press locks the aim arrow, the second sets the shot's height from the
pulsing meter. A press during the replay skips it. Esc or P (or the II button)
pauses; the SOUND button in the corner switches all sound on or off.

## Poki

`js/poki.js` is the only module that talks to the Poki SDK, loaded by
`index.html` from Poki's CDN. Without it (ad blocker, offline) every call is a
no-op and the game plays the same, minus the rewarded continue.

| Moment | SDK call |
|---|---|
| Boot | `init()`, then `gameLoadingFinished()` once the first frame has rendered |
| First press of a session, resume, PLAY AGAIN, continue | `gameplayStart()` (never twice in a row) |
| Pause, hidden tab, game over | `gameplayStop()` |
| Resume from pause, RESTART, PLAY AGAIN | `commercialBreak()` first; audio muted and input ignored while it runs |
| Game over: CONTINUE +1 HEART | `rewardedBreak()`, once per run; the heart only if it reports success. Grey with the 🎬 icon, below and smaller than PLAY AGAIN. |
| Mobile | `movePill()` moves Poki's pill below the score |

Space and the arrow keys never scroll the page, nor does the wheel. The test
hook `window.__demo` and the balance harness exist only on localhost.
`node tools/poki-thumbnail.mjs` renders the 1024x1024 text-free thumbnail to
`dist/poki/thumbnail.png`; `npm run package:release` builds the upload ZIP.

## Rules

| | |
|---|---|
| Hearts | 3 at the start, 5 at most. A save, block, post or crossbar, or miss costs one. |
| Points | Bullseye 300, target ring 200, plain goal 100, times the combo. |
| Combo | Consecutive goals inside the target ring, up to x5. A plain goal or a miss resets it. |
| Extra life | About one target in five carries a block heart (never two in a row, not at 5 hearts). A goal inside the ring collects it. |
| Level | Up every 3 goals: new opponent kit and pitch, and everything below gets harder. |
| Target | Always clear of the keeper: its ring sits at least 0.45 m beyond where he sets himself. Ring half-width 0.85 m at level 1, shrinking toward 0.5 m. |
| Best score | Kept in `localStorage` (`blockstriker.best.v1`). |

All numbers live in `ARCADE`, `TARGET` and `SHOT` at the top of `js/app.js`.

### Difficulty

`levelRamp(level) = 1 - exp(-(level - 1) / 9)`, 0 at level 1 and approaching 1.

- **Keeper:** interpolates from a rookie profile (0.55 s reaction, slow dives,
  1.1 m read error, soft catches) toward the original game's elite keeper, capped
  at 80% of the way (`ARCADE.KEEPER_CAP`). Long shots add a little on top.
- **Defenders:** none before level 5; sometimes one from level 5, always one from
  level 8, up to two on longer chances from level 12. Their reactions and lunges
  are slow at first and tighten over the run.
- **Aim:** the arrow sweeps at 62% of the base speed at level 1, rising toward
  150%; the height meter cycles from 0.95 to 1.6 per second. Long chances still
  sweep faster (1x within 10 m, up to 2.5x).
- **Chances:** from 9-13 m and fairly central at level 1, out to 25 m and wide.

Measured with `node tools/balance-simulation.mjs 300` (production shot code,
shots aimed at the real target with a Gaussian 0.45 m aim and 0.035 power error;
the arrow speed is not modelled, so real play gets harder than this faster):

| Level | 1 | 2 | 3 | 5 | 8 | 10 | 12 | 16 | 20 |
|---|---|---|---|---|---|---|---|---|---|
| Conversion % | 96 | 96 | 96 | 86 | 55 | 46 | 39 | 29 | 26 |
| Bullseye % | 66 | 59 | 57 | 48 | 26 | 21 | 16 | 11 | 9 |
| Saved % | 4 | 4 | 4 | 10 | 35 | 43 | 47 | 57 | 64 |

Outcomes are random (chance spots, keeper reads, deflections); re-measure over
many shots after any change to physics, the keeper or defender AI, or `SHOT`.

## Look

- **Block people.** Players keep the squad model's skeleton and animation
  clips, but the scanned mesh is hidden and Minecraft-style boxes ride the
  bones instead (`js/blockman.js`): an 8x8x8 head, a 12-pixel body (shirt and
  shorts), straight 10-pixel arms and 12-pixel legs split at the knee, in whole
  "pixels" of 5.75 cm. Box sizes and placement come from the rig's rest-pose
  joints. Each player has a 128x128 skin canvas painted texel by texel: face,
  hair by style, kit colours and patterns, the shirt number in a 3x5 pixel font,
  keeper gloves. Kit changes are a repaint. Collision capsules still come from
  the joints, so what you see reaching for the ball is what collides.
- **Crowd, staff and ball.** Supporters are instanced block people in three
  poses (colour slots for shirt, head, hair, trousers, arms, scarf); linesmen and
  photographers are built from the same skin parts. The ball is a sphere
  voxelized at boot into 4.5 cm cubes (`js/voxel.js`), painted with black
  pentagon patches around the twelve vertices of an icosahedron.
- **Pitch and stadium.** Turf is one texel per 0.25 m with the markings painted
  in as whole tiles; square goal posts; daytime sky with drifting block clouds;
  pixel lettering on the advertising boards.
- **Interface.** Pixelify Sans for text and Press Start 2P for numbers and
  headlines (both SIL OFL, `assets/fonts/`), bevelled stone and grass buttons,
  pixel-drawn hearts, square corners throughout. `js/uiManager.js` owns every
  DOM write.
- **Sound.** Everything is synthesized with Web Audio (`js/audio.js`), no
  samples: pulse-wave and triangle chip voices, noise drums, a reverb send and a
  lead echo. Two looping songs (a C-major title theme, a driving A-minor match
  theme) whose hats, arpeggio and tempo build with the level and combo; the
  music ducks while you aim. A live crowd bed roars on goals and groans on
  misses. Stingers for every beat of a shot: aim and power blips, the kick,
  woodwork clang, net swish, tiered goal / target / bullseye fanfares (the
  bullseye adds a coin sparkle), combo blips that climb with the combo, a 1-UP
  jingle for an extra life, level-up fanfare, sad-trombone misses, a heart-loss
  buzz and a heartbeat on the last heart, and game-over / new-best jingles.
  The height meter is a pulse tone stepping up a chromatic scale.
  `__demo.audio()` reports what played and the output level.

## Layout

```
index.html          HUD markup, preloader, import map
style.css           the whole interface
js/app.js           arcade state machine, rules, shot physics loop, keeper/defender AI
js/gameEngine.js    every Three.js object: scene, squad rigs, stadium, target, cameras
js/blockman.js      block-person parts and skin painting
js/voxel.js         boot-time voxelizer (the ball)
js/physics.js       vector maths, ball kinetics, swept collision, net
js/uiManager.js     every DOM write
js/saveSystem.js    localStorage: best score and audio mix
js/audio.js         the whole soundscape, synthesized: chip music, crowd, arcade stingers
tools/              Playwright checks and Blender asset scripts
```

## Notes on the implementation

- **Continuous collision.** The ball travels up to 40 m/s, 0.67 m per frame at
  60 Hz, wider than the keeper or the posts. Flight integrates at a fixed
  1/240 s substep and every test is swept: `distance(segment, segment) < sum of radii`.
- **Precision is measured where the ball crosses the line.** The goal-plane
  crossing point inside the frame is recorded as the ball enters; the tier is
  the larger of its horizontal and vertical offset from the target centre
  (square rings, to match the block target).
- **Deflections stay live.** A ball off a post, a keeper's glove or a defender's
  shin is still in play and counts if it ends up over the line. The keeper
  parries away from goal and gathers anything slower than his catch speed.
  Rebounds get at most three seconds.
- **A goal has to be entered, not just occupied.** The ball must cross the line
  inside the frame and then get fully over it.
- **The net is four spring-damper surfaces** the ball sinks into, each a small
  cloth pinned at the rim, integrating at 240 Hz.
- **Advertising boards rebound the ball** with swept collision boxes.
- **Framerate independence.** All displacement scales against one
  `clock.getDelta()`; the physics accumulator makes 30, 60 and 144 Hz agree.
- **Consistent metre scale.** Pitch 105 x 68 m, goal 7.32 x 2.44 m, ball radius
  11 cm (IFAB Laws 1 and 2).
- **Carried-over engine code.** `gameEngine.js` still contains the original
  game's match-simulation choreography (build-ups, opponent goals, walk-off).
  The arcade uses only the ambient match (behind the title) and the chance
  set-up; the rest is unused and can be removed in a later cleanup.

Rebuild the squad rig with Blender, then strip the hidden scanned mesh out of
it (the block players use only the skeleton and clips):
`blender --background --factory-startup --python tools/blender/build_squad.py`
then `node tools/slim-squad.mjs`.

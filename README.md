# Block Striker - Arcade Football

A blocky arcade football shooter for the browser. Each chance puts a target on
the goal: lock the aim arrow on it, set the height, and shoot. Precision scores,
consecutive target hits build a combo, and anything that is not a goal costs a
heart. Every two goals through level 3, then every three, the level rises: the keeper and defence, useless at
first, get sharper, the arrow speeds up and the target shrinks. Special chances
(golden balls, moving targets, free kicks, boss keepers, bonus rounds) break up
a run; XP, unlocks, missions, checkpoints and a daily challenge carry over
between runs.

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
node tools/early-retention.mjs # early hearts, specials, pacing and adaptive difficulty
npm run check:hooks  # special chances, missions, XP and locker, checkpoints, daily, persistence
npm run check:ads    # every ad break against a stub Poki SDK
npm run check:shots  # flick and free-aim shots with the real mouse, and the Alt+9 switch
npm run check:keeper # on-target shots always beat the keeper, and never pass through him
npm run balance      # conversion and precision by level
```

Browser checks use real Chrome: `CHROMIUM_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`.
On localhost, Alt+1..8 previews a screen with sample data (1 striker select,
2 pause, 3 game over, 4 daily results, 5 locker, 6 level-up banner, 7 mission
toast, 8 the next special chance in turn) and Alt+0 returns to play. That code
sits in `/* @dev */` blocks, which `npm run package:release` strips.
`DEMO_URL` overrides the server address. `?pixel=300` renders through an
optional low-resolution pixel filter (300 rows); it is off by default.

## Controls

The game opens straight into the first chance, no menu before play, with the
saved striker (a random free one on a first launch). The STRIKER button on the
game-over screen changes it: ten strikers with pixel portraits painted from
their block skins in the equipped kit, six of them locked at first. Picking a
look a team-mate or opponent already has swaps theirs, so nobody is on the
pitch twice.
Every run opens with the camera further behind the striker, easing into the
aim view over 1.5 s. How a shot is taken depends on the shot mode
(`?shot=flick|aim|timing|drag|sling`; on localhost Alt+9 cycles them; releases default to
the press-and-hold free-aim shot, `DEFAULT_SHOT_MODE` in `js/app.js`):

| Mode | Shot |
|---|---|
| Pull (default) | Touch or click anywhere and pull back like a slingshot; let go to shoot. Pulling down-left shoots right, down-right shoots left; a longer pull shoots higher and harder. A dotted arc shows the start of the flight (all of it for a session's first two shots, then 75% at level 1 shrinking to 30%). The band's colour is the shot: blue too weak (the keeper can save it even on target, and dives further), green and gold good (gold is the top corner), red over the bar. With the level, blue and red grow and green narrows (`PULL.WEAK`/`WEAK_LATE`, `TOP_LATE`, `ZONE_RAMP`). Hold still and the band bounces: release on the white flash for a SNAP (12% more pace, "PERFECT SNAP!"). Held too long, the aim trembles sideways and up and down. Keyboard: hold Space, steer with the arrows. |
| Flick | Swipe up from anywhere. The swipe's direction sets where the ball crosses the line (5.5 m across per unit of sideways-over-up slope), its length the height (up to 2.9 m), its speed the pace (25-40 m/s). A swipe that bows to one side curls the ball back the other way, up to 14 m/s^2 sideways; the launch is corrected so a curler still finishes where it was aimed, but the keeper and a wall read it as a straight shot. No aim preview. |
| Free aim | Press a point on the goal and hold (click, touch, Space) to charge pace. The pressed point is fixed, but the crosshair randomly spirals left or right and increasingly far from it as charge builds: a quick release is accurate and an overcharged shot will almost certainly miss. Release to shoot at the visible crosshair. |
| Timing | The original: the first press locks the sweeping aim arrow, the second sets the height from the pulsing meter. The meter is the height on the goal line (5 cm at the bottom to 3.3 m at the top, at any distance), so a late press misses high. |
| Classic drag | Hold to fill the power bar, drag horizontally and vertically to aim the crosshair, then release to shoot. Arrow keys aim while Space is held as a keyboard alternative. |
| Slingshot | The camera pulls back to leave turf below the ball. Move the pointer into that area to show a complete guide from the pointer through the ball and toward the goal; on desktop it previews before clicking. Hold to raise the forward arrow, then release to shoot. Touch shows the guide during the press. |

A press during the replay skips it.

**Pull tutorial.** A separate phase before Level 1, played once per player
(finishing it saves `tutorialDone` with the progress; `?tutorial=1` replays it).
The HUD reads TUTORIAL, SHOT n/3. Three coached shots (an animated finger, then
"Pull back", "Further!", "Let go to shoot!", "Too far!" as the pull changes)
that are nearly unmissable: any pull is strong, none goes over the bar, the aim
stays inside the posts, no tremble, and the keeper cannot reach an on-frame
shot. They score points but never cost a heart or count toward a level. Then
"TUTORIAL COMPLETE", and Level 1: no target and a rookie keeper. Targets arrive
at Level 2 with their own banner and card; golden shots move to Level 3.
`npm run check:pull` covers all of it. Esc or P (or the II button)
pauses; the SOUND button in the corner switches all sound on or off.

The first shot of each level-1 arcade run in timing mode is a guided tutorial:
two prominent Rubik-font instruction panels, a gentle sinusoidal aim sweep
and half-speed height meter with no bounce acceleration. Both aim and height
travel up to 60% of the target radius from its centre, safely inside the ring. Either
tap timing hits the target. The shot has no special, heart pickup or miss
penalty; normal controls resume on shot 2. Daily and checkpoint runs skip it.

## Poki

`js/poki.js` is the only module that talks to the Poki SDK, loaded by
`index.html` from Poki's CDN. Without it (ad blocker, offline) every call is a
no-op and the game plays the same, minus the rewarded continue.

| Moment | SDK call |
|---|---|
| Boot | `init()`, then `gameLoadingFinished()` once the first frame has rendered |
| First press of a session, resume, PLAY AGAIN, continue | `gameplayStart()` (never twice in a row) |
| Pause, hidden tab, game over | `gameplayStop()` |
| Resume from pause | `commercialBreak()` first; audio muted and input ignored while it runs |
| New runs: PLAY AGAIN, RESTART, START LV n, DAILY | `commercialBreak()` before every third one only (never the session's first run) |
| Game over: CONTINUE +1 HEART | `rewardedBreak()`, once per run; the heart only if it reports success. Grey with the 🎬 icon, below and smaller than PLAY AGAIN. |
| Game over after a continue: NEXT RUN +1 HEART | `rewardedBreak()`; on success the next arcade run starts with 4 hearts. No gameplay resumes. |
| START LV n, DAILY | `commercialBreak()` first, like PLAY AGAIN |
| Analytics | `measure()`: `run` start/complete per mode, `level` start/complete/fail, `special` start/complete/fail, `mission` and `unlock` complete, `button` visible/interact for the rewarded offers, daily, checkpoint and locker |
| Mobile | `movePill()` moves Poki's pill below the score |

While a break runs, every break-starting button ignores presses (Enter would
otherwise re-click the focused PLAY AGAIN behind the ad), and if the tab is
hidden when it ends (an ad click opened a new tab) the game stays paused.
`npm run check:ads` checks all of this against a stub SDK (`tools/poki-ads.mjs`,
from the `poki-sdk` skill).

Space and the arrow keys never scroll the page, nor does the wheel, and touch
gestures can't pan or zoom the page around the game. The test
hook `window.__demo` and the balance harness exist only on localhost.
`node tools/poki-thumbnail.mjs` renders the 1024x1024 text-free thumbnail to
`dist/poki/thumbnail.png`; `npm run package:release` builds the upload ZIP.

## Rules

| | |
|---|---|
| Hearts | 3 at the start (4 with a boost), 5 at most. A save, block, post or crossbar, or miss costs one. |
| Points | Bullseye 300, target ring 200, plain goal 100, times the combo, times a special chance's multiplier. |
| Combo | Consecutive goals inside the target ring, up to x5. A plain goal or a miss resets it. |
| Extra life | About one target in five carries a block heart (never two in a row, not at 5 hearts). A goal inside the ring collects it. |
| Level | Up every 2 goals through level 3, then every 3. Entering levels 2 and 3 restores one heart up to 3 (never removes extra hearts). Each opens with a guaranteed golden/moving shot respectively; that introductory shot costs no heart if missed. |
| Target | A round archery face (white, black, blue and red bands, a gold bullseye); specials paint it in their colours. Scored by distance from the centre: inside the bullseye, inside the ring, or a plain goal; a ball up to 12 cm outside a painted ring still counts as inside it (`TARGET.LENIENCY`). Radius 0.7 m at level 1, shrinking toward 0.45 m; the bullseye 0.34 m toward 0.2 m. Always clear of the keeper: the ring's edge stays 1.05 m from where he sets himself, the bullseye 1.7 m. |
| On target beats the keeper | A shot that crosses inside the ring, or up to 0.4 m outside it ("through his fingers"), always scores. The keeper still dives at it, full stretch, but every physics step keeps his real limbs 12 cm clear of the ball ("JUST PAST HIS FINGERTIPS!"). A defender's touch cancels it. `npm run check:keeper` checks both over thousands of shots. |
| Pause after a shot | 2.6 s after a goal (up to 4.2 s while the celebration plays), 1 s after a miss. A tap skips it. |
| Best score | Kept in `localStorage` (`pokisavedgame.blockstriker.best.v1`). |

All numbers live in `ARCADE`, `HOLD`, `SPECIALS`, `TARGET` and `SHOT` at the top
of `js/app.js`.

### Difficulty

`levelRamp(level) = 1 - exp(-(difficultyLevel(level) - 1) / ARCADE.RAMP_LEVELS)`.
Difficulty matches the displayed level through 5; each later level adds only
half a difficulty level. `RAMP_LEVELS` is 32: the ramp is 0.09 at level 4,
0.16 at level 8 and 0.23 at level 14. This softens keeper, timing, target-size
and shot-distance growth together.

- **Keeper:** good from the first shot: 55% of the way from a rookie to the
  original game's elite keeper at level 1, rising to 90% (`ARCADE.KEEPER_FLOOR`,
  `KEEPER_CAP`). He reads and dives at everything, so shots outside the target
  are usually saved; only the target beats him.
  Long shots add a little on top.
- **Defenders:** ordinary chances have none before level 5, then a 40% chance
  of one, rising 7.5 percentage points per level (55% at 7, guaranteed at 13).
  Longer chances can have two from level 17, initially 10% and gradually rising
  to 55%. Reaction and lunge strength also use the slower difficulty curve.
  Special free kicks retain their two-man wall.
- **Aim (timing mode):** the arrow sweeps at 114% of the base speed at level 1,
  rising toward 200%; the height meter cycles from 1.4 to 2.2 per second. Every
  turn of the arrow or the meter speeds it up another 5%, capped at +20%.
  Shot distance does not affect arrow speed: it sweeps in goal-plane metres.
- **Chances:** from 9-13 m and fairly central at level 1, out to 25 m and wide.
- **Quiet recovery:** a miss refreshes two shots of assistance: keeper skill is
  multiplied by 0.65 and both timing indicators run 15% slower. Each resolved
  goal consumes one assisted shot; another miss refreshes the two-shot window.
  Combos speed timing up 2.5% per step above x1, capped at 10%. Assistance takes
  priority. These adjustments are fixed at chance setup and are not announced
  in the HUD. Daily challenges use neither adjustment.

Measured with `npm run balance -- 240` (240 shots per level and scenario,
production physics, 50 ms timing spread and 0-3 indicator bounces). Conversion
percentages after halving difficulty growth past level 5 and smoothing defender frequency:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | 91.3 | 86.3 | 89.6 | 86.3 | 85 | 79.6 | 74.2 | 81.7 | 73.3 | 70.4 |
| Recovery | 96.7 | 91.7 | 93.3 | 91.7 | 87.9 | 90.4 | 87.9 | 82.5 | 82.9 | 82.1 |
| x5 combo | 87.1 | 84.2 | 77.1 | 84.6 | 73.8 | 76.3 | 72.1 | 75.4 | 73.8 | 67.5 |

These are independent shot-conversion estimates, not measured player retention
or full-run survival rates. Specials and changes between assistance states
are covered by the gameplay checks rather than this simulation.



Outcomes are random (chance spots, keeper reads, deflections); re-measure over
many shots after any change to physics, the keeper or defender AI, or `SHOT`.

## Special chances

About one chance in three from level 2 is special, never two in a row. The
first run of a session opens with a showcase instead (players who see one
repeated shot leave): a plain chance, a golden ball, a plain one, then a moving
target. The HUD
shows a coloured tag and the target takes the special's colours.
The guaranteed introductions at levels 2 and 3 take priority over the opening
showcase and random specials. Their HUD tag says FREE MISS; the protection
applies to that one shot, while later specials use normal heart rules.

| Special | When | Rule |
|---|---|---|
| Golden ball | from level 2, 12% | gold ball and target, double points |
| Moving target | from level 3, 10% | the target slides across its side of the goal until the kick, x1.5 points |
| Free kick | from level 5, 10% | 17-22 m out, a two-man wall 9.15 m from the ball that jumps as you strike, x2 points |
| Boss keeper | first chance of level 4 (including its checkpoint), then levels 10, 15, 20... | a slightly bigger keeper (1.08x) in black and gold, no extra skill, his collision grows with him; beat him for x3 points and a heart |
| Bonus round | first three chances of every 4th level from level 8 | the keeper stands aside, misses are free, x2 points; combo and level progress untouched |

## Progression

`js/progress.js` owns everything that carries over between runs, stored in
`pokisavedgame.blockstriker.progress.v1`:

- **XP and unlocks.** A run pays its score / 10 in XP (a continued run pays only
  for the points scored since its last game over), missions pay more. 38 unlocks
  on one track from 150 to 43,800 XP, a striker or a kit every few steps:
  14 kits (a repaint of the striker and his team-mates, and the home fans),
  7 boots, 7 ball tints, 4 celebrations and 6 strikers. Free from the start: the
  classic kit, boots and ball, three celebrations and four strikers. The
  game-over screen shows the XP bar toward the next unlock; the LOCKER (tabs:
  kits, boots, balls, moves) equips them and shows the collection count.
  Locked strikers show greyed on the striker screen with their XP cost.
- **Missions.** Three active at a time from a pool of 20, easiest first,
  cycling. "In one run" missions count within a run; the others add up across
  runs from when they start. A mission finished mid-run pays at once with a
  toast.
- **Game progress.** 0-100%: the average of reaching level 10, finishing every
  mission once (the achievements) and unlocking every item on the track. Shown
  under the best score in the HUD, on the game-over screen with its three parts,
  and in the locker.
- **Ranks.** ROOKIE, PRO (level 4), STAR (7), LEGEND (10), ICON (13), shown
  under the level; a new rank gets its own banner.
- **Checkpoints.** Reaching two levels past 4, 7, 10 or 13 lets later runs
  START at that level.
- **Daily challenge.** Ten chances seeded by the date (spots, targets, keeper
  set, kits, specials; deflections stay random), the level rising one per shot
  and a boss on the last. No hearts to lose. The day's best and a streak of
  consecutive days are kept.
- **So-close screen.** Game over shows the gap to the best score, rank, XP,
  unlocks and missions, then PLAY AGAIN, START LV n, DAILY and LOCKER.

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
- **Interface.** Bundled Rubik text (SIL OFL, `assets/fonts/`), high-contrast
  panels and simple buttons; pixel art stays in hearts and character portraits.
  HUD regions use flow layout; menus scroll instead of shrinking their text.
  Desktop checks include Poki's 640x360, 836x470 and 1031x580 frames.
  `js/uiManager.js` owns every DOM write.
- **Sound.** Everything is synthesized with Web Audio (`js/audio.js`), no
  samples: pulse-wave and triangle chip voices, noise drums, a reverb send and a
  lead echo. A C-major title anthem for the menus, and four match songs, one
  per band of levels: Kickoff (levels 1-3, 132 bpm, F major), Pressure (4-6,
  150 bpm, A minor), Night Match (7-9, 156 bpm, E minor) and Final Whistle (10+,
  168 bpm, D minor). Each is about a minute of verse, chorus and a lead-free
  breakdown, with its own drum (four-on-the-floor, rock, breakbeat, half-time)
  and bass (pump, drive, walk, syncopated, held) patterns per section; a new
  song takes over on a bar line. Layers and tempo build with the level and
  combo. During play the music sits at a quarter of its menu level, under the
  crowd and the shot sounds, and ducks further while you aim. A live crowd bed roars on goals and groans on
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
js/progress.js      XP, unlocks, missions, ranks, checkpoints, daily challenge
js/saveSystem.js    localStorage (keys prefixed pokisavedgame.): best score, audio mix, progress
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
- **Two quality tiers.** Touch devices and CPUs with 4 cores or fewer run low
  quality: at most 1.25x device pixels (stepping down to 0.6x) without
  anti-aliasing, no shadow map (a blob shadow under each player and the ball
  instead), Lambert lighting instead of physically based materials, no
  linesmen or photographers, and every other crowd seat filled with 6-box fans.
  On both tiers each player is one skinned mesh (every box bound wholly to its
  bone: one draw instead of about 13, culled off screen with padded bounds),
  the crowd is one instanced mesh per pose with per-fan colours picked by a
  vertex slot (3 draws), and crowd boxes have no back or bottom faces (never
  seen). Low quality at 844x390: about 58 draw calls and 0.19M triangles per
  frame (was about 148 and 0.28M); high: about 0.86M triangles. In both tiers
  the resolution steps down by 0.25x whenever the median frame misses 45 fps
  (never back up). `?quality=low|high` overrides the detection; `?stats=1`
  shows fps, tier, resolution, draw calls, triangles and CPU ms for update and
  draw. `node tools/perf-mobile.mjs [cpuSlowdown]` profiles a throttled phone.
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

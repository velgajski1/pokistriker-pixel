# Striker Streak — Free Online Soccer Game

A turn-based attacking-football roguelite in Three.js. Matches simulate at
**200 match seconds per real second** (27 seconds of clock progression for
90 minutes, excluding shots, reactions and any minimum gap holds). Between chances
the camera cuts overhead and both teams pass, press and contest possession at
2× speed in a lower, landscape-aligned view of the pitch. It pans and zooms into the
normal shooting view over the next chance's 2.4-second build-up, which plays
at normal animation speed. The match clock freezes while you aim and shoot.
During the overhead simulation, a large lower-third minute display advances
every match minute alongside the commentary. That lower third disappears as
soon as the build-up or another action-camera sequence begins.
`node tools/match-simulation.mjs` checks timing, camera transitions and the
return overhead after a celebration. Chances still follow the career schedule;
ambient possession changes do not award extra goals.

## Run it

Any static server — the game is plain ES modules with no build step.

```bash
npm start                  # http://localhost:5173
# or
python -m http.server 5173
```

Three.js 0.169.0 and the required loaders are served locally from `vendor/three/`
via the import map in `index.html`. No runtime CDN download is required.

## Release packaging

On Windows, run `npm run package:release` (PowerShell 5.1 or newer). This creates
a uniquely named folder and matching ZIP in `dist/`, without replacing earlier
releases. The ZIP has `index.html` at its root and can be extracted and served
by any static server; opening it directly with `file://` is not supported.

The explicit file list in `tools/package-release.ps1` includes the five game
modules, stylesheet, runtime images, squad and ball assets, and the pinned
Three.js dependency files and MIT license. Source artwork, unused models, tools,
captures, references and npm dependencies are excluded. Update that list when
adding runtime assets or Three.js addons. Packaging does not run browser tests,
minify code, or change the `window.__demo` test contract.

This is a local release artifact, not a Poki submission: Poki SDK integration
and device/iframe validation are still required before submission.

## Controls

The main menu offers Career Mode, Single Match, Training Mode, and Statistics.
Career starts with match one and opens Match Upgrades between matches. Single Match
ends at a full-time results screen; Training repeats shots indefinitely. Both
standalone modes use baseline stats and do not change saved career progress. Reset
Progress asks for confirmation before erasing the career save.

Use Main Menu or Escape to leave a mode (the current match/run is discarded).
From the main menu: 1 starts Career, 2 starts Single Match, 3 starts Training,
and U opens Meta Upgrades. Left/right arrows or the visible style buttons cycle
Stadium, Daylight, Matchday, Clubhouse, and Arcade on overlay screens. The selected
style carries between screens for the current session; reloading resets it.
On localhost, Alt+1 opens Meta Upgrades, Alt+2 opens Match Upgrades, and Alt+G
opens the Career Over screen for inspection.
`node tools/game-modes.mjs` checks mode routing, repeating practice shots, save
isolation, reset confirmation, and mobile layout.

Click / tap / <kbd>Space</kbd>, three times per chance: **lock aim → set power → shoot.**
Power sets both shot speed and elevation: ~0.4 is along the floor, ~0.85 finds
the top corner, above ~0.92 goes over the bar.

Career trainer confidence starts at 70%, gains 10% per goal, loses 5% for every
resolved non-goal opportunity, and loses 1% at each five-minute mark. Reaching
zero during a match does not end the career: later goals can restore confidence.
At full time, wins add 5 confidence points, draws add 0, and losses subtract 5.
A results screen shows the score, outcome, adjustment and animated confidence
bar, then waits for Next. The adjustment is saved once and this screen resumes
on reload. Only zero confidence after this adjustment ends the career: a win
can rescue a player on zero, while a loss can trigger benching. The tenth-match
victory check also happens after the adjustment and Next. Single matches keep
their score-only ending, since trainer confidence belongs to career mode.
`node tools/match-results.mjs` checks all outcomes, limits and reload behavior.
Career Over is persisted
until the player selects Next and enters Meta Upgrades.
At that final whistle, an angry manager slides over the frozen overhead pitch
with “You are benched!!”. After 3.8 seconds, Career Over appears. The result and
Legacy Points are saved before the animation, so closing during it resumes at
Career Over without awarding points twice. Localhost Alt+G previews this sequence.

Every match has two guaranteed opportunities. A deterministic fair-chance
credit then grows by 1% per played match minute and carries between fixtures;
at 100% it schedules one additional opportunity and subtracts 100%. There is
no random success roll. Poacher Instinct and Star Player Status each add 0.2
percentage points per minute per level. Below 30% confidence, Super Sub adds
another 0.2 percentage points per minute per level.

Media Charm restores 10 percentage points of trainer confidence. Its price
increases by $100 after every use in the current run: $100, $200, $300, and so on.

Career and Single Match open with an opponent preview: club name, kit-colored
flag, and defense rating. The scoreboard tracks goals for and against in the
current fixture; career goals remain separate for cash and Legacy Points.
Careers face ten fixed clubs in order. Surviving match ten with confidence above
zero wins the game; this is a survival campaign, not a requirement to win every
scoreline. Zero confidence at the final whistle still means being benched.
The victory summary and 20 LP per career goal are saved before showing the ending;
reloading cannot award them twice. Next leads to meta upgrades. Existing careers
adopt the fixed opponent for their current match; completed training checkpoints
at match ten or later finish as victories if confidence remains positive.
`node tools/career-victory.mjs` checks progression, endings and payout persistence.
Localhost Alt+V previews the final-match result → Next → victory → Next → meta
upgrades flow. It checkpoints an active career but uses sample results, without
awarding LP or replacing saved progress. Also exposed as `__demo.previewVictory()`.

Winning a 16-match season offers Another Season with the same striker and permanent
summer upgrades, or New Career with a newly selected striker and reset upgrades and
LP. Statistics separates the current player's continuing career from all-time
records. It tracks seasons, goals, matches, W-D-L, titles, benchings, best season,
the highest normal-upgrade build out of 20, fully upgraded seasons, permanent-upgrade
progress and unspent LP. In-progress season totals are included immediately. Global
records survive New Career; the current-player record starts over. `npm run
test:career` checks this persistence and the season transitions. `npm run balance`
uses production shot physics to calibrate and simulate full careers.

Opponents accrue goal credit at a fixed 1% per played minute, starting at 50%.
Each full credit awards a goal during the next overhead segment, pausing play
for 1.8 seconds. Credit carries across career fixtures; scores reset at kickoff.
Scores, credit, the goal pause, and pre-match screens are saved with the career.
Conceding goals does not change trainer confidence or award cash.

Defense rating rises from 25 toward 88 over a career using the match progression
curve. Goalkeeper progression remains active; defender speed increases
by up to 25.5%, reaction delay decreases by up to 38.25%, and shot-reading error
decreases by up to 55.25%. This changes scoring difficulty and needs playtesting.

## Layout

```
index.html      entry point & overlay containers
style.css       high-contrast minimalist UI
js/
  app.js        state machine + ALL game data (run, career, upgrades, AI)
  gameEngine.js Three.js scene, squad rigs, ambient match, build-up choreography
  physics.js    vectors, ball kinetics, continuous collision (no Ammo/Cannon)
  uiManager.js  every DOM write: HUD, ticker, procedural upgrade tables
  saveSystem.js localStorage interface for permanent upgrades
```

## Notes on the implementation

- **Continuous collision.** The ball travels up to 40 m/s — 0.67m per frame at
  60Hz, wider than the keeper or the posts. Discrete per-frame tests let it
  tunnel straight through, so the flight integrates at a fixed 1/240s substep
  and every test is swept: `distance(segment, segment) < sum of radii`.
- **Collision follows the animation.** The keeper's and defenders' capsules are
  read off their live rig joints, so what you see reaching for the ball is what
  the save/block test uses.
- **Long shots are harder to aim.** Marker speed scales with distance to the
  goal centre: 1x within 10m, 1.5x at 20m, 2x at 30m, capped at 2.5x from 40m.
  Target Practice and Ice in the Veins still reduce speed multiplicatively.
  Power timing is unchanged. This increases long-range difficulty; historical
  conversion rates need remeasurement.
- **Aiming freezes the action.** Player poses (including idle), crowd/flags and
  net animation pause during AIM and POWER. Aim and power controls remain live;
  animation resumes with the windup. `node tools/aim-pause.mjs` checks frozen
  player transforms and crowd time, responsive controls and resumption.
  All player mixers are explicitly paused and cached transforms are held before
  rendering, including both goalkeepers, so late procedural updates cannot
  change the frozen pose during either selection phase.
  Selection retains the current build-up animation poses rather than sampling
  a fresh idle, walking or kick pose when the pause begins.
  The shooter's root and preserved torso yaw are aligned toward goal before
  locking the pose, including when the build-up ends mid-turn.
- **Goals trigger the supplied celebrations.** The scorer performs Backflip,
  Backflip and Hooks, All Night Dance or Big Heart Gesture, with no consecutive
  repeat in a run. He first runs about 5.4m toward the nearer sideline crowd over
  1.5 seconds, slows to a stop and performs facing the supporters. The camera
  follows the run, then slowly orbits the scorer at about 10 degrees/second
  while framing the full clip (roughly 4–10 seconds total including
  recovery), then match simulation resumes. Clips keep
  their vertical motion and rotation; gameplay owns horizontal positioning.
  `node tools/celebrations.mjs` checks all four performances and goal triggering.
- **Misses and conceded goals trigger reactions.** Angry Ground Stomp,
  Shouting Angrily, Confused Scratch and Walk Sad are randomly selected for the shooter
  after a missed chance, or the goalkeeper while the scorer celebrates.
  Reactions blend from the current pose and play for at most 4.5 seconds,
  followed by a 0.3-second return to idle. `node tools/reactions.mjs` checks
  all four clips on both roles, missed-shot triggering and cleanup.
  Walk Sad retains its original lower-body motion, with relaxed upper-body
  articulation and lowered clavicles to avoid a hunched, inflated neck/shoulder
  appearance. `node tools/sad-walk.mjs` renders four poses beside normal walking.
  During a missed-shot reaction, an in-bounds ball remains live for everyone
  except the reacting shooter: nearby players chase, teammates reposition and
  defenders can clear slow balls. Pursuit stops when the ball leaves the pitch.
  The verdict and reward stay fixed. `node tools/miss-continuation.mjs` checks
  both cases while preserving the shooter's reaction.
- **Defenders walk after conceding.** All ten opposing outfield players head
  in varied directions at a slow pace during the scorer's celebration. Half
  use Walk Sad before blending into walking; the rest walk slowly throughout.
  No idle/alert poses interrupt this movement. The keeper retains his separate
  reaction, and normal match movement resumes after the celebration.
  `node tools/defender-reactions.mjs` checks all ten through a long celebration.
- **Forward gaits follow facing.** Players turn first for destinations behind
  them, then walk or run forward through the turn. Rebound spacing follows the
  final movement direction, and scorers turn before running toward the crowd.
  `node tools/forward-movement.mjs` checks walking/running at 30, 60 and 144 Hz.
- **Player faces share clean, animated surface detail.** The importer welds
  split seams before decimation, smooths the head and reshapes the scalp.
  Continuous skin/hair shading supplies hairlines, eyes, brows and restrained
  stubble on selected looks. The headband is flush with the scalp. Crew cuts,
  side parts and swept hair join the existing styles (17 appearance presets).
  `node tools/faces.mjs` renders every preset to `.captures/faces.png`.
- **Both elevens wear conventional shirt numbers.** Keepers use 1; fullbacks
  2/3, centre-backs 4/5, midfielders 6/8/10 and attackers 7/9/11. Back prints
  inherit the shirt's skin weights so they bend with running, kicking and diving.
  White digits have a dark outline for contrast across all kit palettes.
- **Opponent and supporter colours change per match.** Ten palettes cover
  two solid, four striped, two hooped and two checkered kits with contrasting
  goalkeeper colours. Patterns follow bind-space shirt vertices through animation;
  materials and uniforms are prepared once, with no texture downloads. The home
  kit stays blue. `node tools/teams-review.mjs` captures all ten designs.
  Crowd shirts, scarves and flags follow the opponent, mixed with home fans and
  neutral clothing. `run.opponentColors` and `run.crowdColorSeed` are chosen once
  at kickoff; career fixtures use a fixed club order and other modes draw random kits. Materials
  and crowd buffers are reused. `node tools/team-colors.mjs` checks all palettes,
  crowd variation and preservation of player skin, hair and home colours.
- **Three pitch surfaces rotate between matches.** Emerald stripes, summer
  checkerboard and worn diagonal turf combine mowing patterns, colour variation,
  goal-mouth wear and a fine grass bump texture. All maps are generated once at
  boot. `run.pitchSurface` is randomly selected at match start and retained for
  every chance; consecutive matches can draw the same surface. This is visual
  only and does not change ball physics.
- **The ball uses the supplied Meshy soccer GLB.** `assets/ball.glb` keeps its
  panel geometry at 6,000 triangles with 512 px JPEG textures (about 279 KB).
  The export script enforces a 500,000-byte maximum. Rebuild it with
  Blender using `tools/blender/build_ball.py`. The model is centred and scaled
  at boot to the 11 cm collision radius; loading failure retains the procedural
  ball. Physics and kick timing are unchanged.
- **Advertising boards rebound the ball.** All four pitch-side boards share
  their dimensions with swept collision boxes, including their top and ends.
  Impacts retain 55% of normal speed and 90% of tangential speed; balls above
  the boards can clear them. Collisions continue during the verdict display,
  without changing an already out-of-play result. `node tools/advertising-boards.mjs`
  checks rebounds at 30/60/144 Hz, tunneling and rendered board alignment.
- **The net is four real surfaces, and it stretches.** Back, both sides and
  roof use square cord grids, with rear uprights and support rails on both
  goals. Net motion integrates at 240Hz and continues until it settles.
  Contacting cords wrap around the ball while ripples spread outwards;
  progressive tension catches hard shots and caps release at 0.8m/s so the
  ball drops inside the goal. Pockets clear when play leaves the goal.
  `node tools/goal-net.mjs` tests back, side, roof, corner and 60m/s impacts
  at 30/60/144Hz, plus visible deformation and settling.
  The back, both sides and
  roof are spring-dampers the ball sinks into, not walls it bounces off - a
  35 m/s shot opens a pocket about half a metre deep. The damping is
  asymmetric (light going in, heavy coming out), because netting is lossy
  rather than springy: symmetric damping either kills the stretch or turns the
  goal into a trampoline. Each panel is also a little cloth - per-vertex
  displacement coupled to its grid neighbours and pinned at the rim - so a
  strike drags the surrounding mesh in with it and the bulge spreads outward
  before it settles.
- **Deflections stay live.** A ball off a post, a keeper's glove or a
  defender's shin is still in play, and if it ends up over the line it is a
  goal like any other. The keeper parries away from his own goal rather than
  rebounding off a rigid limb, and gathers anything slower than 12 m/s, so
  shooting straight at him is not a strategy.
  Rebounds have a three-second limit from their first bounce/deflection. A
  clearance moving upfield beyond 6m from goal for 0.35 seconds resolves
  sooner (after at least 0.45 seconds of rebound play). Goal entry is checked
  first. Non-goal verdicts remain visible for 0.8 seconds before continuing.
  `node tools/rebound-end.mjs` checks clearances, near-goal grace and the limit
  at 30/60/144Hz. Very late rebound goals are intentionally cut off.
- **The whole squad uses the Meshy Captain biped.** `assets/squad.glb` shares
  body geometry across all 22 footballers and the referee, with independent skeletons and
  materials. Fifteen performances from the updated biped pack are included:
  Walking, Quick Walk, Running, Run 03, four turns, the soccer kick, two dives,
  goalkeeper preparation, Alert and both slide tackles.
  A breathing idle is derived from the kick's starting pose. Keeper dives blend
  imported torso/leg motion with procedural reach and ballistic positioning;
  defenders use Alert while set, procedural upright blocks for higher balls,
  and the supplied left/right slides against selected low shots. Defender collision includes torso, thighs, shins and boots,
  while only keepers can block with hands. Collision capsules
  read those same visible bones. The previous procedural rigs remain as a
  fallback if asset loading fails.
- **Players have different appearances.** `LOOKS` in `js/gameEngine.js` deals
  light through dark skin tones, hair colours, hair volume, headbands/tails,
  height and build. Kits distinguish both teams, the goalkeeper and referee;
  only the keeper has coloured gloves. These are stylised player-inspired
  appearances, not scanned likenesses. The imported mesh has no base-colour
  texture, so the preparation script assigns skin/hair/garment regions.
  `parade(offset, count)` lines up the squad for inspection.
  `window.__demo.players` exposes each model, appearance and role for tests.
- **A living stadium.** Roughly 6,600 instanced supporters fill four stepped
  stands, following the low-poly cheering/scarf references in
  `references/stadium crowd`. Rounded heads, shaped torsos, bent elbows and
  knees, and separate shoes give the supporters softer human silhouettes.
  Clothing, skin, hair and poses vary; scarves,
  swaying supporters and eight fluttering flags animate on the GPU. Goals
  briefly increase their movement. The crowd uses 20 instanced draw calls,
  with no per-spectator JavaScript updates. `window.__demo.crowd` exposes
  counts, animation time and reaction strength.
- **Consistent metre scale.** The pitch is 105 × 68 m, with markings at both
  ends and an opposite goal. The goal opening is 7.32 × 2.44 m; post axes sit
  outside that opening, using 12 cm diameter woodwork. The ball has an 11 cm
  radius (69.1 cm circumference) and rests on the turf. Player models retain
  their 1.85 m base height with individual height variations and animated poses.
  The goal and ball dimensions follow
  [IFAB Law 1](https://www.theifab.com/laws/latest/the-field-of-play/) and
  [Law 2](https://www.theifab.com/laws/latest/the-ball/).

- **A goal has to be entered, not just occupied.** The ball must cross the
  line inside the frame AND then get the whole way over it. Occupying the goal
  volume is not enough on its own, because a ball shoved clear of the inside
  of a post - which stands ON the line - lands in that volume without ever
  having crossed. Net contact is independent of scoring: finite panels collide
  from both sides, retaining the impact side throughout the stretch. Outside
  hits deform inward and return outward; a ball landing on the roof can rest
  there. None of these contacts grants goal entry. `node tools/outside-net.mjs`
  covers both sides, the back, roof, fast sweeps and 30/60/144 Hz agreement.
- **Nobody freezes.** The keeper's dive height is a real ballistic arc, not a
  number baked into the dive pose - he pushes off, peaks around 0.8m as the
  ball arrives, lands, lies there a beat and picks himself up. Defenders get
  out of their blocking stance, the striker follows through and then stands instead of
  holding his leg out, and everyone not directly involved tracks the ball.
  After a turf bounce or deflection, players within 7m may chase a loose ball
  near their position, releasing it beyond 10m or when it leaves play. Distant
  players walk at 0.65–1.45m/s toward their formation targets, shifting at most
  4m sideways from their home lane and moving up/down the pitch with the ball.
  The referee seeks an 8m buffer from the ball, retreating at up to 3.4m/s
  when play comes within 6m, including during aiming. Scripted build-up runs
  retain their dedicated movement. The two closest opposing outfield players
  always close down during live play, regardless of distance or whether the
  ball has bounced. The selection updates with the ball; active shot blockers
  can join the approach and use their leg block when close enough.
  The closest defender sprints immediately at 7.2m/s, slowing only on reaching
  the ball. The nearest available attacker within 18m also sprints to contest
  it; the shooter becomes available after 0.9s of kick recovery. Other players
  retain their formation behavior. `BALL_PURSUIT` in app.js controls these values.
  Even small translations play the walking cycle at the corresponding speed;
  formation spacing nudges and the far goalkeeper's adjustments are included.
  Locomotion uses final frame displacement for all players, including the striker
  and both keepers. Moving idle/Alert/ready poses and expired kick recovery yield
  to walking or running; slow moving turns use walking turn clips. Active kicks,
  slides, dives and keeper save reaches retain their action animation. Teleports
  between chances are excluded. `node tools/glide.mjs` reproduces these cases,
  including movement as slow as 0.04m/s.
  Upright defenders can clear loose balls below 0.35m and 7m/s when within
  boot reach. They plant and play the soccer kick; at contact, a reachable
  ball is sent upfield and wide at 18m/s with a small lift. Fast balls and
  defenders still sliding do not trigger clearance attempts. The existing
  rebound deadline still applies. `node tools/clearance.mjs` verifies referee
  retreat, clearance contact and fast-shot exclusion.
  `window.__demo.formation` exposes actors and their targets for diagnostics;
  `node tools/formation.mjs` checks rebound pursuit, lane retention and motion
  at 30, 60 and 144Hz.
- **Full teams and longer chances.** Each side fields a goalkeeper and ten
  outfield players in a 4-3-3 shape. The second keeper guards the far goal.
  About 35% of chances start 18–25m from goal, beyond the penalty area; the
  remainder start 9–16m out. After a bounce or deflection the camera smoothly
  pans and turns toward the ball, then returns to the broadcast view for SIM.
  `node tools/full-pitch.mjs` checks team counts, chance distribution and
  rebound framing. The longer chance mix changes scoring difficulty.
- **The striker's boot actually meets the ball.** He is placed relative to the
  ball by his kicking-foot offset and squared up to the shot angle, so he
  strikes it rather than swiping past the side of it.
- **The keeper leaps.** A dive has a vertical dimension as well as a lateral
  one. Before takeoff he plays the supplied crouched goalkeeper preparation
  clip, including its lateral footwork, with a smoothed loop ending.
  He adjusts along the line at 1.8m/s before committing to the jump. The ready
  legs blend into the supplied dive articulation, while collisions continue
  to follow his visible joints. `node tools/keeper-ready.mjs` checks the stance,
  turf clearance, frame-rate agreement and transition into the dive. This
  pre-jump adjustment and lower stance change the keeper's save coverage.
  Shot reads now use arrival at the keeper's line with smaller lateral/height
  errors. He stays grounded inside a 0.7m adjustment zone and times wider
  jumps to arrival. Standing saves guide actual hand joints toward the ball;
  low shots use a real boot block. Collision radii are unchanged.
  While the ball is distant he repositions at up to 3.8m/s, refines his live
  trajectory read, and saves the dive/recovery for the last 0.24s before arrival.
  Longer flight gives him more time to cover the goal; final dive travel remains
  capped at 1.75m from his improved position. `node tools/keeper-saves.mjs` checks
  27 close and 20m/30m shots across three heights, including delayed commitment.
  Reading a high shot converts the sideways sprawl into an upright leap
  with overhead arms. Without it the top third of the goal was free, because a
  body lying horizontal at hip height cannot get near it — and no amount of
  tuning his speed, reach or reaction changed the conversion rate.
- **Chances are choreographed.** The chance minute is known in advance, so the
  possession is built backwards from it: a pass chain whose final leg lands on
  the striker's boot at his shooting spot, exactly on the scheduled minute.
  Nothing teleports when the highlight begins.
- **Framerate independence.** All displacement scales against a single
  `clock.getDelta()`; the physics accumulator makes 30Hz, 60Hz and 144Hz agree.

Rebuild the squad asset with Blender:
`blender --background --factory-startup --python tools/blender/build_squad.py`.
The script reads the supplied `references/Meshy_AI_Captain_of_Tomorrow_biped (1)/Meshy_AI_Captain_of_Tomorrow_biped`
folder and writes `assets/squad.glb` plus clip/contact metadata in
`assets/squad.json`. Run `node tools/squad.mjs` for appearance and live capsule
checks, `node tools/striker.mjs` for striker animation checks, and
`node tools/validate.mjs squad-match` for a match/performance check. Browser
checks use the existing server and `CHROMIUM_PATH` pointing to installed Chrome.
`node tools/stadium.mjs` checks dimensions, crowd animation, player height,
swept woodwork collisions, and agreement at 30/60/144 Hz, and captures the
crowd and a player/goal comparison at the same depth.

### Biped animation mapping

| Supplied animation | In-game use |
|---|---|
| Walking | Normal walking, scaled to measured stride speed and player height |
| Quick Walk | Brisk repositioning between walking and running; its three repeated cycles are reduced to one |
| Running / Run 03 | Running and pursuit; players use either running style, with aligned foot phases |
| Idle Turn Left / Right | Stepping turns while nearly stationary |
| Walk Turn Left / Right | Direction changes while walking |
| Kick a Soccer Ball | Striker shots and timed ambient/build-up passes |
| `01a0c35d…` / `01a0c35e…` | Left/right keeper dive articulation |
| `01a0c3d7…` | Goalkeeper ready preparation and lateral footwork |
| Alert | Stationary defenders and slide recovery |
| slide_light / slide_right | Left/right low-shot slide tackles |

Turn clips have their baked yaw removed because navigation owns facing. Dive
clips retain torso/leg articulation, while the game supplies translation,
leap, recovery and arm reach; their ending ground rolls are not played.
Slide translation is removed so gameplay owns the approach; the clip retains
its body drop, leading leg and recovery. Low shots predicted below 0.65m can
trigger a slide once a blocker is within 8m, with a 65% attempt chance.
Slides play at twice source speed to fit shot timing. Idle 3, 8 and 12 were
reviewed as alternate poses; the existing general idle is retained.
The short `.001` actions in each file are setup helpers, not
performances. The soccer kick contacts on its forward swing at 0.5 seconds;
the preparation script adjusts only the kicking leg near contact for a ground
ball. Passers arrive and plant before their scheduled release. The aim pose
stays still, and run cycles never blend in a walking turn at sprint speed.

`node tools/biped-audit.mjs` renders a contact sheet of every original file;
`node tools/animations.mjs` checks gait selection, turn normalization, dive
usage, forward-swing contact and both build-up pass animations. Clip provenance
and source/cycle durations are recorded in `assets/squad.json`.

### Difficulty

First-time players take one assisted tutorial shot before reaching the menu:
tap / Space locks aim, then a second tap sets power and shoots. The tutorial
uses a central 10m chance, no blockers, a slow keeper starting off-center, and
forgiving aim/power ranges. It awards no career currency. Completion is saved
after the shot, including misses; interrupted tutorials restart on next load.
Older saved records skip onboarding. Reset Progress also resets the tutorial.
Alt+T replays the tutorial from any screen, checkpointing an active career first.
After the shot, a congratulations screen waits for Next. It is restored on reload
until acknowledged. Next restores any pending Career Over result; otherwise the menu opens.
No additional image assets are needed. Tutorial assistance does not change
normal match shooting or goalkeeper tuning.

Keeper ability progresses continuously with distance, goals conceded in the
current match and career run match number. `KEEPER_PROGRESS` tunes the curve;
`shot.keeperAbility` exposes the profile captured at chance start. Higher skill
reduces read/position errors and reaction time, increases movement speed, speeds
up dive extension and improves catches/parries. Improvements approach bounded
limits; body size and collision radii do not grow. Match goals reset for the next
fixture, while match-number progression continues until a new run.
`node tools/keeper-progression.mjs` checks each progression axis and its limits.

Career progression now uses .10 match pressure (previously .14), with opening
keeper assistance fading out by match 6 instead of match 4. Career keeper skill
approaches 90% of the previous elite profile. Defender progression uses a .10
curve instead of .14 and caps at 85% of the previous added difficulty. These
changes make the ramp slower and the ceiling easier; conversion rates need
playtesting. Starting confidence is 70 for new careers; existing saves retain
their current confidence.

The table below predates the imported squad skeleton, dive animations and corrected goal,
post and ball dimensions. These alter coverage, target size and collision
clearance, so conversion rates need remeasurement. Keeper reads, standing saves
and jump timing have since been strengthened to punish shots close to him;
the historical conversion figures below do not represent the current balance.

Measured against the real modules, by aim quality (goal % per chance):

| play | converts |
|---|---|
| random mashing | ~24% |
| straight down the middle | ~36% |
| decent aim and power | ~37% |
| threading it just inside the post | ~35% |
| top corner, precise | ~47% |
| + Leg Day 5 and Natural Talent 5 | ~56% |

Aiming *at* the post rather than just inside it converts **0%** and hits the
woodwork 60% of the time - the reward for precision has a cliff right next to
it. Drilling low into a two-man block converts ~6%; lifting the same shot over
it converts ~30%, which is what the power phase is really for.

### Deliberate deviations from the design docs

1. `V_y = Power * 4.0` caps the ball's apex at `Vy²/2g = 0.82m`, which puts the
   much of the 2.44m goalmouth out of reach and makes the power
   phase one-dimensional. `LIFT = 9.0` (`js/physics.js`) maps power 0.35→0.92
   across floor → top corner → over the bar.
2. Woodwork is a real swept collision against the post and bar cylinders rather
   than a 0.2m tolerance band, because that band was narrower than a single
   frame of ball travel and fired more or less at random.
3. Goal, post and ball dimensions now use real football proportions rather
   than the original 8 × 3 m goal and 44 cm diameter ball. The updated constants
   are shared by rendering and collision.

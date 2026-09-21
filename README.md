# BENCHED — A Striker's Roguelite

A turn-based attacking-football roguelite in Three.js. Matches simulate at
**10 in-game minutes per real second** (90' in 9s). When a chance arrives the
clock freezes, the arena brightens and you aim, power up and shoot.

## Run it

Any static server — the game is plain ES modules with no build step.

```bash
npm start                  # http://localhost:5173
# or
python -m http.server 5173
```

Three.js is pulled from a CDN via the import map in `index.html`.

## Controls

Click / tap / <kbd>Space</kbd>, three times per chance: **lock aim → set power → shoot.**
Power sets both shot speed and elevation: ~0.4 is along the floor, ~0.85 finds
the top corner, above ~0.92 goes over the bar.

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
- **The net is four real surfaces, and it stretches.** Back, both sides and
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
- **The whole squad uses the Meshy Captain biped.** `assets/squad.glb` shares
  body geometry across all 22 footballers and the referee, with independent skeletons and
  materials. All eleven supplied performances are included: Walking, Quick
  Walk, Running, Run 03, four turns, the soccer kick and two dive/fall clips.
  A breathing idle is derived from the kick's starting pose. Keeper dives blend
  imported torso/leg motion with procedural reach and ballistic positioning;
  defenders use procedural upright lateral blocks with tucked arms and a
  leading boot. Defender collision includes torso, thighs, shins and boots,
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
  having crossed. The netting is gated on the same flag, so a shot sailing
  over the bar cannot clip the roof panel from above and get pushed back down
  into the goal.
- **Nobody freezes.** The keeper's dive height is a real ballistic arc, not a
  number baked into the dive pose - he pushes off, peaks around 0.8m as the
  ball arrives, lands, lies there a beat and picks himself up. Defenders get
  out of their blocking stance, the striker follows through and then stands instead of
  holding his leg out, and everyone not directly involved tracks the ball.
  After a turf bounce or deflection, players within 7m may chase a loose ball
  near their position, releasing it beyond 10m or when it leaves play. Distant
  players walk at 0.65–1.45m/s toward their formation targets, shifting at most
  4m sideways from their home lane and moving up/down the pitch with the ball.
  Referees hold a support position rather than chase. Scripted build-up runs
  retain their dedicated movement. The two closest opposing outfield players
  always close down during live play, regardless of distance or whether the
  ball has bounced. The selection updates with the ball; active shot blockers
  can join the approach and use their leg block when close enough.
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
  one. Before takeoff he holds a wide, bent-knee crouch and uses short lateral
  shuffle steps; their phase follows distance travelled, not frame count.
  He adjusts along the line at 1.8m/s before committing to the jump. The ready
  legs blend into the supplied dive articulation, while collisions continue
  to follow his visible joints. `node tools/keeper-ready.mjs` checks the stance,
  turf clearance, frame-rate agreement and transition into the dive. This
  pre-jump adjustment and lower stance change the keeper's save coverage.
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
The script reads the supplied `references/Meshy_AI_Captain_of_Tomorrow_biped`
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

Turn clips have their baked yaw removed because navigation owns facing. Dive
clips retain torso/leg articulation, while the game supplies translation,
leap, recovery and arm reach; their ending ground rolls are not played. No
supplied clip depicts the defender's lateral leg block, so that action remains
procedural. The short `.001` actions in each file are setup helpers, not
performances. The soccer kick contacts on its forward swing at 0.5 seconds;
the preparation script adjusts only the kicking leg near contact for a ground
ball. Passers arrive and plant before their scheduled release. The aim pose
stays still, and run cycles never blend in a walking turn at sprint speed.

`node tools/biped-audit.mjs` renders a contact sheet of every original file;
`node tools/animations.mjs` checks gait selection, turn normalization, dive
usage, forward-swing contact and both build-up pass animations. Clip provenance
and source/cycle durations are recorded in `assets/squad.json`.

### Difficulty

The table below predates the imported squad skeleton, dive animations and corrected goal,
post and ball dimensions. These alter coverage, target size and collision
clearance, so conversion rates need remeasurement. Shot speed, lift and AI
tuning constants have not been retuned to compensate.

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

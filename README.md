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
- **Every player looks like a different person.** Each rig is dealt a "look"
  from `LOOKS` in `js/gameEngine.js`: skin tone, hair colour, hair style
  (crop, buzz, bald, curls, afro, ponytail, bun, headband, floppy), height and
  build. Heights scale the root uniformly and the collision capsule radii
  scale with them, so a taller defender genuinely covers more. Eyes, brows and
  beards are only built for the four players you ever see close up — the
  keeper, the striker and the two active defenders. `parade(offset, count)` is
  exported as a dev aid to line the squad up for a look at the variety.
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
  up off their slide, the striker follows through and then stands instead of
  holding his leg out, and everyone not directly involved turns to watch the
  ball and breaks toward it once it is live.
- **The striker's boot actually meets the ball.** He is placed relative to the
  ball by his kicking-foot offset and squared up to the shot angle, so he
  strikes it rather than swiping past the side of it.
- **The keeper leaps.** A dive has a vertical dimension as well as a lateral
  one: reading a high shot converts the sideways sprawl into an upright leap
  with overhead arms. Without it the top third of the goal was free, because a
  body lying horizontal at hip height cannot get near it — and no amount of
  tuning his speed, reach or reaction changed the conversion rate.
- **Chances are choreographed.** The chance minute is known in advance, so the
  possession is built backwards from it: a pass chain whose final leg lands on
  the striker's boot at his shooting spot, exactly on the scheduled minute.
  Nothing teleports when the highlight begins.
- **Framerate independence.** All displacement scales against a single
  `clock.getDelta()`; the physics accumulator makes 30Hz, 60Hz and 144Hz agree.

### Difficulty

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

### Two deliberate deviations from the design docs

1. `V_y = Power * 4.0` caps the ball's apex at `Vy²/2g = 0.82m`, which puts the
   upper two thirds of the 3.0m goalmouth out of reach and makes the power
   phase one-dimensional. `LIFT = 9.0` (`js/physics.js`) maps power 0.35→0.92
   across floor → top corner → over the bar.
2. Woodwork is a real swept collision against the post and bar cylinders rather
   than a 0.2m tolerance band, because that band was narrower than a single
   frame of ball travel and fired more or less at random.

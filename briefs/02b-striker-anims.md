# Task: author idle, walk, run and kick clips for the rigged striker

Task 02a produced `assets/striker.glb`: the Captain, skinned to 22 bones, deterministic, rebuilt
in about 5 s by `tools/blender/build_striker.py`. It has been reviewed, and it loads and deforms
correctly in three.js. This task adds the four animation clips the game needs. Integration comes
next (task 03), so **do not touch `js/`, `index.html` or `style.css`.**

**Do not change the mesh, skeleton, skin weights or textures.** Only add animations and the
sidecar file. The orchestrator will compare the mesh and skin data against the 02a export.

## How the game will drive these clips
- **Locomotion by ground speed.** The game moves the striker's root itself at 0 to 7 m/s and
  will blend idle, walk and run by speed, setting `timeScale = groundSpeed / clipSpeed`. The
  clips must therefore be **in place** (no horizontal root motion), with an honestly measured
  `speed` (see step 4), or his feet will slide.
- **The kick is scrubbed, not played.** The game sets the kick's time directly from its own
  timers: the 0.28 s windup maps onto clip time 0 to 0.28, and the ball launches at that instant.
  So the right foot must reach the ball at **exactly 0.28 s**.

## Conventions (proven by 02a's pose renders; keep them)
Rotations are bone-local, in the same `('X', degrees)` form as `POSES`:
- `thigh`: negative X swings the leg forward (flexion), positive X swings it back.
- `shin`: positive X bends the knee. `forearm`: negative X bends the elbow.
- `upperarm`: X swings the arm forward and back; `chest` and `head` Z twists.
- He faces -Y in Blender, which is +Z in three.js. The **right** leg kicks.
Extend the data format as needed, for example several axes per bone and hips height, but keep it
a table at the top of the script, like `POSES`.

## Build
1. Extend `tools/blender/build_striker.py` so the same single command also authors the clips.
   Put the key poses in a `CLIPS` table at the top. Use Bezier interpolation, not linear, so the
   motion eases. The whole build must stay deterministic.
2. **Clips.** Each is a separate glTF animation named exactly `idle`, `walk`, `run` and `kick`.
   Export with actions as separate animations (`export_animation_mode='ACTIONS'` or equivalent),
   and make sure no stray extra animation is exported. The loops must be seamless: the last key
   equals the first.
   - `idle`, loop, 2.0 s: a ready stance. Weight forward, knees bent about 12 degrees, arms loose
     and slightly away from the body, with a subtle breathing and weight-shift sway. Hips move less
     than 2 cm.
   - `walk`, loop, about 1.10 s per two steps: heel strike, with the stance knee about 15 degrees
     and the swing knee about 60 degrees. Arms swing about 18 degrees with a slight elbow bend.
     Hips bob 2 to 3 cm with a little lateral sway. Torso upright.
   - `run`, loop, about 0.70 s per two steps: contact, down, passing, flight, then mirrored. The
     front foot lands just ahead of the hips; the stance knee loads to about 40 degrees; the swing
     knee folds to about 100 degrees, heel toward the buttock; the swing thigh reaches about 55
     degrees forward. Include a flight phase with both feet off the ground. Torso leans forward
     about 10 degrees, the chest counter-rotates about 8 degrees against the hips, elbows are
     bent about 90 degrees, and the arms swing about 40 degrees, opposite arm to leg. Hips bob 4
     to 6 cm. Keep the head steady.
   - `kick`, one-shot, 1.0 s, a right-footed instep drive at a ball on the ground:
     - **0.00**: the `idle` start pose.
     - **0.00 to 0.16**: the left foot plants beside the ball, the body leans a little toward it,
       and the left arm swings out wide for balance. At the end of this phase the right leg
       reaches its backswing peak: hip extended about 40 degrees back, knee flexed about 100
       degrees, toe pointed.
     - **0.28, contact**: the right thigh is about 20 degrees forward of vertical, the knee is
       nearly straight, and the foot is pointed, with the instep facing the ball. The body is over
       the ball and the planted left knee is slightly bent.
     - **0.28 to 0.55**: follow-through. The right thigh carries on to about 70 degrees, the knee
       extends fully, the torso leans back slightly and the arms counter-swing.
     - **0.55 to 1.00**: the foot comes down and he settles back into the `idle` start pose. The
       last frame equals `idle` frame 0, so the game can hand back without a pop.
3. **Keep him grounded.** In every clip the stance foot sits on the floor (sole at y=0, within
   2 cm) and never sinks below it. Adjust the hips' height per key to achieve this. It is the
   commonest way hand-keyed cycles look wrong.
4. **Measure, don't assume.** In Blender, step through each locomotion clip, find the stance
   foot's contact window, and compute the ground speed at which it would stay planted: its
   travel along the forward axis relative to the root, divided by the time. Report the residual
   slide. For the kick, record the world position at 0.28 s of the midpoint between the
   `foot_R` and `toe_R` heads (the instep, the point that meets the ball), relative to the root,
   in **three.js axes** (Y up, +Z forward).
5. **Sidecar** `assets/striker.json`, written by the script:
   ```json
   { "clips": {
       "idle": { "duration": 2.0,  "loop": true },
       "walk": { "duration": 1.10, "loop": true, "speed": <measured m/s> },
       "run":  { "duration": 0.70, "loop": true, "speed": <measured m/s> },
       "kick": { "duration": 1.0,  "loop": false, "contact": 0.28 } },
     "kickFoot": { "x": <m>, "y": <m>, "z": <m> } }
   ```
6. **Filmstrips** into `.captures/`: for each clip, one image tiling 8 evenly spaced frames in a
   row. Side views for all four clips (`anim-<clip>-side.png`) and a front view for `kick`
   (`anim-kick-front.png`). Also `anim-kick-contact.png`: the contact frame alone from the side,
   with a 0.22 m-radius sphere drawn where the ball would sit so it touches the instep. Workbench,
   textured, with the floor line visible so grounding can be judged.
7. Extend `tools/blender/inspect_glb.mjs` to check that exactly four animations exist with those
   names; that durations match the sidecar within 1 frame; that the loops close (the first and
   last sampled rotations of every channel agree within 1 degree); and that the joint list,
   triangle count and vertex count are unchanged (22 / 24,500 / 15,834). Keep every existing
   check.

## Constraints
- Don't edit `js/`, `index.html`, `style.css`, `package.json`, the reference GLB, `tools/lib.mjs`
  or `tools/validate.mjs`.
- Mesh, skeleton, weights and textures stay identical to 02a's export; only animations are added.
- The file stays under 3 MB. Budget about 400 KB for animation data; if the sampled export is
  larger, sample at 30 fps.
- No new npm dependencies. Write output only to `assets/`, `tools/blender/` and `.captures/`.

## Files
`tools/blender/build_striker.py`, `tools/blender/inspect_glb.mjs`, `assets/striker.glb`
(regenerated), `assets/striker.json` (new, generated), `.captures/anim-*.png` (generated).
The game server is running at http://localhost:5173; don't start another.

## Done when
- One headless command (`blender --background --factory-startup --python
  tools/blender/build_striker.py`) rebuilds everything deterministically, and two runs produce a
  byte-identical GLB.
- `node tools/blender/inspect_glb.mjs` passes, including the new animation checks.
- The filmstrips show grounded, readable motion: planted feet on the floor line, knees and elbows
  bending the right way, the kick's instep meeting the ball sphere at contact, and the kick
  ending in the idle pose.
- `npm run check` still passes; no game code changed.
- Report: the measured walk and run speeds with their residual slide, `kickFoot`, the file size,
  and anything in the key poses you had to change from this brief to keep him grounded or looking
  right. Keep it short.

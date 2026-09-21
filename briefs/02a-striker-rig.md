# Task: rig the Captain GLB into a skinned, game-ready striker asset

The user wants `references/Meshy_AI_Captain_of_Tomorrow_0921090505_texture.glb` to replace the
procedural striker (#9, the player's character; everyone else stays procedural). It is a
**static mesh: no skeleton, no animations** - one mesh, 65,510 tris / 37,805 verts, one PBR
material, three embedded JPEGs (~5.8 MB of the 7.5 MB file). This task only produces the rigged
asset. Animation clips are the next task (02b) and in-game integration the one after (03), so
**do not touch `js/`, `index.html` or `style.css`.**

Front and side renders are attached. He stands with arms hanging close to his sides and legs
apart. In Blender space he faces -Y, his origin is at mid-body (bbox z -0.953 to 0.947), and he
is 1.90 m tall.

## Build
1. `tools/blender/build_striker.py`, run headless with
   `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/blender/build_striker.py`.
   It must rebuild the asset from the reference GLB deterministically in one run, with no manual
   steps. Keep every tunable (tri budget, texture sizes, bone positions) as a named constant at the
   top.
2. **Prepare the mesh.** Merge by distance if needed. Decimate to **at most 25,000 tris**, keeping
   the face, hands and boots readable. Move the origin to **between the soles, at floor level**,
   and scale him to **1.85 m** tall. He must still face -Y in Blender, so he faces **+Z in
   three.js** after export, the way the game's rigs face.
3. **Build a deform skeleton** by hand with `bpy` (not Rigify: its control rig does not export
   cleanly to glTF). Use exactly these bone names. Use **underscores, not dots**: three.js's
   `PropertyBinding.sanitizeNodeName` strips dots, so `foot.R` would load as `footR` and break
   bindings.
   `root` (at the origin, parent of everything), `hips`, `spine`, `chest`, `neck`, `head`,
   `shoulder_L/R`, `upperarm_L/R`, `forearm_L/R`, `hand_L/R`, `thigh_L/R`, `shin_L/R`,
   `foot_L/R`, `toe_L/R`. Place the joints from the mesh's anatomy (measure it; don't guess
   proportions): knees at the knees, elbows at the elbows, ankles at the ankles. Give the knees
   and elbows a slight bend in the rest pose, so they bend the right way.
4. **Skin it.** Try `ARMATURE_AUTO` (bone heat) first. Meshy meshes are often non-manifold, and
   heat weighting can fail with "failed to find solution for one or more bones". If it fails or
   leaves vertices unweighted, fall back to a weighting you compute in Python, for example
   distance to the nearest bone segments with falloff, then normalise and smooth. **Every vertex
   must end up weighted, with at most 4 influences.** The arms sit close to the torso, so check
   the armpits, the sides of the shirt and the inner thighs for weight bleed (arm vertices pulled
   by the spine, or shirt vertices pulled by the arm) and clean it up.
5. **Export** to `assets/striker.glb`: glTF binary, +Y up, skinned, deform bones only, no
   animation clips yet. Keep the PBR material. Embed the textures as JPEG, downsized to at most
   2048 px for base colour and 1024 px for the other maps. **Target at most 3 MB.**
6. **Deformation test renders** into `.captures/rig-*.png` (Workbench, textured, front and side,
   posed through the armature and not baked into the export):
   - `rest`: the bind pose, which must match the source silhouette
   - `arms-up`: both arms raised overhead
   - `kick`: right thigh swung forward about 70 degrees with the knee extended, and the left
     knee slightly bent
   - `run`: a mid-stride pose, left thigh forward and right thigh back, with knees bent and the
     arms counter-swinging
   - `twist`: chest rotated 35 degrees against the hips, head turned 40 degrees
7. `tools/blender/inspect_glb.mjs`: a Node script that parses `assets/striker.glb` without
   Blender and prints the skin count, joint names, tri and vertex counts, the largest joint
   influence count, texture sizes and file size. It exits non-zero if any requirement in "Done
   when" is violated.

## Constraints
- Don't edit `js/`, `index.html`, `style.css`, the reference GLB or `package.json`.
- No new npm dependencies. Parse the GLB with Node's built-ins; the format is a 12-byte header
  followed by JSON and BIN chunks.
- Write output only to `assets/`, `tools/blender/` and `.captures/`.
- If Blender won't run in your sandbox (for example it can't write its config or temp files),
  stop and report the exact error rather than working around it outside the repo.

## Files
`tools/blender/build_striker.py` (new), `tools/blender/inspect_glb.mjs` (new),
`assets/striker.glb` (new, generated), `.captures/rig-*.png` (generated, gitignored).
The game server is running at http://localhost:5173. This task doesn't need it; don't start
another.

## Done when
- The build script runs clean headless from a fresh Blender (`--factory-startup`) and rewrites
  `assets/striker.glb`.
- `node tools/blender/inspect_glb.mjs` passes: exactly 1 skin, all 22 named joints present, at most
  25,000 tris, at most 4 influences per vertex, every vertex weighted, textures within their
  size limits, file at most 3 MB.
- The five `.captures/rig-*.png` renders exist in front and side views. In them, arms and legs
  bend cleanly with no torso or shirt stretching toward the limbs, and knees and elbows bend the
  correct way.
- `npm run check` still passes; no game code changed.
- Report the weighting method that finally worked (and any fallback taken), the final tri count,
  file size, and the measured joint heights (hip, knee, ankle, shoulder, elbow, wrist). Keep the
  report short.

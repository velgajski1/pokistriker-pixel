# Three.js 0.169.0

Vendored unchanged from `https://cdn.jsdelivr.net/npm/three@0.169.0/`.
The retained `LICENSE` applies to all upstream files in this directory.

Runtime dependency closure:

- `build/three.module.js`
- `examples/jsm/loaders/GLTFLoader.js`
- `examples/jsm/utils/SkeletonUtils.js`
- `examples/jsm/utils/BufferGeometryUtils.js` (imported by GLTFLoader)

The import map preserves the upstream addon directory layout. If game code
adds another addon or compressed model decoder, vendor its dependencies too
and update the release file list. No automatic network refresh runs at build
or game startup.

/**
 * voxel.js - boot-time voxelization of static triangle meshes (the ball).
 *
 * Triangles are rasterized into a lattice aligned with the geometry's axes
 * (cell = floor(p / size)), the outside is flood filled, and only faces between
 * a solid cell and the outside are emitted. Output geometry carries a `voxel`
 * attribute (cell centre xyz, exposed-face mask in w) for voxelShade.
 *
 * Nothing here runs per frame.
 */
import * as THREE from 'three';

export const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32;

// Per direction: neighbour offset, normal, mask bit and four corners (cell units)
// wound counter-clockwise when seen from outside.
const FACES = [
  { d: [1, 0, 0], bit: FACE_PX, c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], bit: FACE_NX, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], bit: FACE_PY, c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { d: [0, -1, 0], bit: FACE_NY, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], bit: FACE_PZ, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], bit: FACE_NZ, c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * parts: [{ key, geometry, priority = 0, uv = false }]
 *   A cell hit by several parts belongs to the highest priority one.
 * options:
 *   size       lattice spacing, in geometry units
 *   color      (part, u, v, out) => void: per-cell colour from the hit's UV,
 *              written as a linear `color` attribute
 * Returns { geometries: Map(key -> BufferGeometry), size, cells }.
 */
export function voxelize(parts, options) {
  const size = options.size;
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox);
  }
  // One empty cell of padding on every side so the flood fill surrounds the model.
  const i0 = Math.floor(box.min.x / size) - 1, j0 = Math.floor(box.min.y / size) - 1;
  const k0 = Math.floor(box.min.z / size) - 1;
  const nx = Math.floor(box.max.x / size) + 2 - i0, ny = Math.floor(box.max.y / size) + 2 - j0;
  const nz = Math.floor(box.max.z / size) + 2 - k0;
  const total = nx * ny * nz;
  const owner = new Int16Array(total).fill(-1);
  const rank = new Float32Array(total).fill(-Infinity);
  const wantUv = parts.some(part => part.uv);
  const cellU = wantUv ? new Float32Array(total) : null;
  const cellV = wantUv ? new Float32Array(total) : null;
  const at = (i, j, k) => (i - i0) + nx * ((j - j0) + ny * (k - k0));

  // Rasterize: sample every triangle densely enough that the hit cells form a
  // closed (26-connected) shell, which then blocks a 6-connected flood fill.
  const step = size * .45;
  parts.forEach((part, partIndex) => {
    const geometry = part.geometry;
    const position = geometry.attributes.position;
    const uv = part.uv ? geometry.attributes.uv : null;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const priority = part.priority || 0;
    for (let t = 0; t < count; t += 3) {
      const ia = index ? index.getX(t) : t, ib = index ? index.getX(t + 1) : t + 1;
      const ic = index ? index.getX(t + 2) : t + 2;
      _a.fromBufferAttribute(position, ia);
      _b.fromBufferAttribute(position, ib);
      _c.fromBufferAttribute(position, ic);
      const edge = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
      const n = Math.max(1, Math.ceil(edge / step));
      for (let s = 0; s <= n; s++) {
        for (let r = 0; r <= n - s; r++) {
          const wb = s / n, wc = r / n, wa = 1 - wb - wc;
          _p.set(_a.x * wa + _b.x * wb + _c.x * wc, _a.y * wa + _b.y * wb + _c.y * wc,
            _a.z * wa + _b.z * wb + _c.z * wc);
          const cell = at(Math.floor(_p.x / size), Math.floor(_p.y / size), Math.floor(_p.z / size));
          if (priority < rank[cell]) continue;
          rank[cell] = priority;
          owner[cell] = partIndex;
          if (uv) {
            cellU[cell] = uv.getX(ia) * wa + uv.getX(ib) * wb + uv.getX(ic) * wc;
            cellV[cell] = uv.getY(ia) * wa + uv.getY(ib) * wb + uv.getY(ic) * wc;
          }
        }
      }
    }
  });

  // Flood the outside from the padded corner through empty cells only.
  const outside = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  outside[0] = 1; queue[tail++] = 0;
  while (head < tail) {
    const cell = queue[head++];
    const x = cell % nx, y = ((cell / nx) | 0) % ny, z = (cell / (nx * ny)) | 0;
    for (const { d } of FACES) {
      const X = x + d[0], Y = y + d[1], Z = z + d[2];
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const next = X + nx * (Y + ny * Z);
      if (outside[next] || owner[next] >= 0) continue;
      outside[next] = 1;
      queue[tail++] = next;
    }
  }
  const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz
    && !outside[x + nx * (y + ny * z)];

  const buffers = parts.map(() => ({ position: [], normal: [], voxel: [], index: [],
    color: options.color ? [] : null }));
  const rgb = [0, 0, 0];
  let cells = 0;
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const cell = x + nx * (y + ny * z);
    if (outside[cell]) continue;
    const i = x + i0, j = y + j0, k = z + k0;
    let mask = 0;
    for (const face of FACES) if (!solid(x + face.d[0], y + face.d[1], z + face.d[2])) mask |= face.bit;
    if (!mask) continue;
    // Enclosed filler cells are only ever exposed at an open seam; give them
    // the nearest owned neighbour's region.
    let part = owner[cell];
    if (part < 0) part = nearestOwner(owner, x, y, z, nx, ny, nz);
    if (part < 0) continue;
    cells++;
    const out = buffers[part];
    if (options.color) {
      options.color(parts[part], cellU ? cellU[cell] : 0, cellV ? cellV[cell] : 0, rgb);
    }
    const cx = (i + .5) * size, cy = (j + .5) * size, cz = (k + .5) * size;
    for (const face of FACES) {
      if (!(mask & face.bit)) continue;
      const base = out.position.length / 3;
      for (const corner of face.c) {
        const ci = i + corner[0], cj = j + corner[1], ck = k + corner[2];
        out.position.push(ci * size, cj * size, ck * size);
        out.normal.push(face.d[0], face.d[1], face.d[2]);
        out.voxel.push(cx, cy, cz, mask);
        if (out.color) out.color.push(rgb[0], rgb[1], rgb[2]);
      }
      out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometries = new Map();
  parts.forEach((part, n) => {
    const b = buffers[n];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3));
    geometry.setAttribute('voxel', new THREE.Float32BufferAttribute(b.voxel, 4));
    if (b.color) geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 3));
    geometry.setIndex(b.position.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.index, 1) : b.index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.voxelSize = size;
    geometries.set(part.key, geometry);
  });
  return { geometries, size, cells };
}

function nearestOwner(owner, x, y, z, nx, ny, nz) {
  for (let r = 1; r <= 3; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const part = owner[X + nx * (Y + ny * Z)];
      if (part >= 0) return part;
    }
  }
  return -1;
}

/**
 * Voxelizes one static mesh's geometry in its own local frame, keeping the
 * material colour (and its texture's colours as vertex colours, when it has one).
 */
export function voxelizeGeometry(geometry, size, sampler = null) {
  const result = voxelize([{ key: 0, geometry, uv: !!sampler && !!geometry.attributes.uv }], {
    size, color: sampler ? (part, u, v, out) => sampler(u, v, out) : null });
  return result.geometries.get(0);
}

/**
 * Shader patch shared by every voxel material: passes the cell centre and its
 * exposed-face mask to the fragment stage, and gives each cell a small,
 * stable brightness offset so flat colours read as individual blocks.
 * `fragment` runs after <color_fragment> with `vCell` (cell index), `vVoxel`
 * (centre) and `vMask` available.
 */
export function voxelShade(material, { size, jitter = .07, key = 'plain', uniforms = {}, fragment = '' }) {
  const previous = material.onBeforeCompile;
  material.customProgramCacheKey = () => 'voxel-' + key;
  material.onBeforeCompile = shader => {
    previous?.(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'attribute vec4 voxel;\nvarying vec3 vVoxel;\nvarying float vMask;\n'
      + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvVoxel = voxel.xyz;\nvMask = voxel.w;');
    shader.fragmentShader = `varying vec3 vVoxel;
      varying float vMask;
      ${Object.keys(uniforms).map(name => uniformDeclaration(name, uniforms[name].value)).join('\n')}
      float voxelHash(vec3 c) { return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      bool voxelOpen(float bit) { return mod(floor(vMask / bit), 2.0) > .5; }
      ` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 vCell = floor(vVoxel / ${size.toFixed(6)});
      ${fragment}
      diffuseColor.rgb *= 1.0 + (voxelHash(vCell) - .5) * ${jitter.toFixed(3)};`);
  };
  return material;
}

function uniformDeclaration(name, value) {
  const type = value?.isColor || value?.isVector3 ? 'vec3' : value?.isVector2 ? 'vec2'
    : value?.isTexture ? 'sampler2D' : 'float';
  return `uniform ${type} ${name};`;
}

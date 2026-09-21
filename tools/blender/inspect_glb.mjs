import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const path = process.argv[2] ?? fileURLToPath(new URL('../../assets/striker.glb', import.meta.url));
const file = fs.readFileSync(path);
assert.equal(file.toString('ascii', 0, 4), 'glTF');
assert.equal(file.readUInt32LE(4), 2);
assert.equal(file.readUInt32LE(8), file.length);
let gltf, bin;
for (let offset = 12; offset < file.length;) {
  const length = file.readUInt32LE(offset);
  const type = file.readUInt32LE(offset + 4);
  const data = file.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) gltf = JSON.parse(data.toString('utf8'));
  if (type === 0x004e4942) bin = data;
  offset += 8 + length;
}
function accessor(index) {
  const a = gltf.accessors[index];
  assert(!a.sparse, 'Sparse accessors unsupported');
  const view = gltf.bufferViews[a.bufferView];
  const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const [size, read, divisor] = {
    5121: [1, 'readUInt8', 255], 5123: [2, 'readUInt16LE', 65535],
    5125: [4, 'readUInt32LE', 4294967295], 5126: [4, 'readFloatLE', 1],
  }[a.componentType];
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: count }, (_, c) => {
    const value = bin[read]((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? size * count) + c * size);
    return a.normalized ? value / divisor : value;
  }));
}
function jpegSize(data) {
  assert.equal(data.readUInt16BE(0), 0xffd8, 'Texture must be JPEG');
  for (let p = 2; p < data.length;) {
    assert.equal(data[p++], 255);
    while (data[p] === 255) p++;
    const marker = data[p++];
    const length = data.readUInt16BE(p);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [data.readUInt16BE(p + 5), data.readUInt16BE(p + 3)];
    p += length;
  }
  throw new Error('JPEG dimensions missing');
}
const expected = ['root', 'hips', 'spine', 'chest', 'neck', 'head'];
for (const side of ['L', 'R']) for (const name of ['shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe']) expected.push(`${name}_${side}`);
assert.equal(gltf.skins?.length, 1, 'Exactly one skin required');
const joints = gltf.skins[0].joints.map(i => gltf.nodes[i].name);
assert.deepEqual([...joints].sort(), expected.sort(), 'All 22 explicitly requested joints required');
const sidecar = JSON.parse(fs.readFileSync(path.replace(/\.glb$/, '.json'), 'utf8'));
assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['idle', 'kick', 'run', 'walk']);
for (const animation of gltf.animations) {
  const info = sidecar.clips[animation.name];
  let duration = 0;
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    const times = accessor(sampler.input).flat();
    duration = Math.max(duration, times.at(-1));
    assert(Math.abs(times[0]) < 1e-6, 'Clips start at zero');
    const values = accessor(sampler.output);
    if (info.loop) {
      const first = values[0], last = values.at(-1);
      if (channel.target.path === 'rotation') {
        const norm = Math.hypot(...first) * Math.hypot(...last);
        const dot = Math.abs(first.reduce((sum, x, i) => sum + x * last[i], 0) / norm);
        assert(2 * Math.acos(Math.min(1, dot)) < Math.PI / 180, `${animation.name}: rotation loop`);
      } else assert(first.every((x, i) => Math.abs(x - last[i]) < 1e-4), `${animation.name}: translation/scale loop`);
    }
    if (gltf.nodes[channel.target.node].name === 'root' && channel.target.path === 'translation') {
      assert(values.every(v => Math.abs(v[0]) < 1e-6 && Math.abs(v[2]) < 1e-6), 'In-place root');
    }
  }
  assert(Math.abs(duration - info.duration) <= 1 / 50, `${animation.name}: duration`);
  if (['walk', 'run'].includes(animation.name)) assert(info.speed > 0 && Number.isFinite(info.speed));
  const capture = fileURLToPath(new URL(`../../.captures/anim-${animation.name}-side.png`, import.meta.url));
  assert(fs.existsSync(capture), `Missing ${capture}`);
}
const idle = gltf.animations.find(a => a.name === 'idle');
const kick = gltf.animations.find(a => a.name === 'kick');
for (const channel of kick.channels) {
  const match = idle.channels.find(c => c.target.node === channel.target.node && c.target.path === channel.target.path);
  assert(match, 'Kick channels match idle');
  const rest = accessor(idle.samplers[match.sampler].output)[0];
  const values = accessor(kick.samplers[channel.sampler].output);
  for (const endpoint of [values[0], values.at(-1)]) {
    assert(rest.every((x, i) => Math.abs(x - endpoint[i]) < 1e-5), 'Kick returns to idle');
  }
}
assert.equal(sidecar.clips.kick.contact, .28);
assert(Object.values(sidecar.kickFoot).every(Number.isFinite));
for (const suffix of ['front', 'contact']) assert(fs.existsSync(fileURLToPath(new URL(`../../.captures/anim-kick-${suffix}.png`, import.meta.url))));
assert.equal(sidecar.clips.run.duration, .64);
assert.equal(sidecar.clips.walk.duration, 1.1);
assert(sidecar.clips.run.speed >= 5.8 && sidecar.clips.run.speed <= 6.4, 'Run speed');
assert(sidecar.clips.walk.speed >= 1.3 && sidecar.clips.walk.speed <= 1.5, 'Walk speed');
const contactPoint = sidecar.kickFoot;
assert(Math.hypot(contactPoint.x + .229, contactPoint.y - .138431, contactPoint.z - .289139) < .03, 'Contact point retained');
const footChannel = kick.channels.find(c => gltf.nodes[c.target.node].name === 'foot_R' && c.target.path === 'rotation');
const footSampler = kick.samplers[footChannel.sampler];
const contactIndex = accessor(footSampler.input).findIndex(t => Math.abs(t[0] - .28) < 1e-6);
assert(contactIndex >= 0, 'Exact contact key');
const ankleRest = gltf.nodes[footChannel.target.node].rotation ?? [0, 0, 0, 1];
const ankleContact = accessor(footSampler.output)[contactIndex];
const ankleDot = Math.abs(ankleRest.reduce((sum, x, i) => sum + x * ankleContact[i], 0)) / (Math.hypot(...ankleRest) * Math.hypot(...ankleContact));
const ankleAngle = 2 * Math.acos(Math.min(1, ankleDot)) * 180 / Math.PI;
assert(ankleAngle >= 30 && ankleAngle <= 35, `Contact ankle: ${ankleAngle}`);
let triangles = 0, vertices = 0, largestInfluences = 0;
for (const node of gltf.nodes.filter(n => n.mesh !== undefined)) {
  assert.equal(node.skin, 0, 'Every mesh must be skinned');
  for (const p of gltf.meshes[node.mesh].primitives) {
    assert.equal(p.mode ?? 4, 4);
    const positions = accessor(p.attributes.POSITION);
    const heights = positions.map(v => v[1]);
    assert(Math.abs(Math.min(...heights)) < 0.0001, 'Soles must sit at Y=0');
    assert(Math.abs(Math.max(...heights) - 1.85) < 0.0001, 'Height must be 1.85 m');
    vertices += positions.length;
    triangles += (p.indices === undefined ? positions.length : gltf.accessors[p.indices].count) / 3;
    const sets = Object.keys(p.attributes).filter(k => k.startsWith('WEIGHTS_')).map(k => ({
      weights: accessor(p.attributes[k]), joints: accessor(p.attributes[k.replace('WEIGHTS_', 'JOINTS_')]),
    }));
    assert(sets.length, 'Missing weights');
    for (let i = 0; i < positions.length; i++) {
      let sum = 0, influences = 0;
      for (const set of sets) set.weights[i].forEach((w, k) => {
        assert(Number.isFinite(w) && w >= 0);
        if (w > 0) {
          influences++;
          assert(set.joints[i][k] < joints.length);
        }
        sum += w;
      });
      assert(Math.abs(sum - 1) < 0.001, `Vertex ${i} weights sum to ${sum}`);
      largestInfluences = Math.max(largestInfluences, influences);
    }
  }
}
const baseImages = new Set(gltf.materials.map(m => gltf.textures[m.pbrMetallicRoughness.baseColorTexture.index].source));
const textures = gltf.images.map((image, index) => {
  assert.equal(image.mimeType, 'image/jpeg');
  const v = gltf.bufferViews[image.bufferView];
  const dimensions = jpegSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  assert(Math.max(...dimensions) <= (baseImages.has(index) ? 2048 : 1024));
  return { name: image.name, dimensions, bytes: v.byteLength };
});
console.log(JSON.stringify({ skins: gltf.skins.length, joints, triangles, vertices, largestInfluences, textures, bytes: file.length }, null, 2));
assert.equal(triangles, 24500, 'Triangle count unchanged');
assert.equal(vertices, 15834, 'Vertex count unchanged');
assert(triangles <= 25000, 'Triangle budget exceeded');
assert(largestInfluences <= 4, 'Influence budget exceeded');
assert(file.length <= 3000000, '3 MB file budget exceeded');
for (const pose of ['rest', 'arms-up', 'kick', 'run', 'twist']) {
  for (const view of ['front', 'side']) {
    const capture = fileURLToPath(new URL(`../../.captures/rig-${pose}-${view}.png`, import.meta.url));
    assert(fs.existsSync(capture), `Missing ${capture}`);
  }
}
console.log('PASS');

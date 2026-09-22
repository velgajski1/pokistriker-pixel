// Strips the scanned mesh out of assets/squad.glb. The block players only use
// the skeleton, the skin's inverse bind matrices and the animation clips; the
// mesh is hidden at runtime. One tiny skinned triangle is kept so the loader
// still builds a SkinnedMesh and its Skeleton exactly as before.
// Run after tools/blender/build_squad.py:  node tools/slim-squad.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] || 'assets/squad.glb';
const file = readFileSync(path);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.toString('utf8', 20, 20 + jsonLength));
const binStart = 20 + jsonLength + 8;
const bin = file.subarray(binStart, binStart + file.readUInt32LE(20 + jsonLength));
if (gltf.meshes.length !== 1) throw new Error('Expected the single squad mesh');

// Views still needed: everything except the mesh primitives' accessors.
const meshAccessors = new Set();
for (const primitive of gltf.meshes[0].primitives) {
  for (const index of Object.values(primitive.attributes)) meshAccessors.add(index);
  if (primitive.indices !== undefined) meshAccessors.add(primitive.indices);
}
const keepAccessors = gltf.accessors.map((_, i) => !meshAccessors.has(i));

// The stub triangle: three vertices bound fully to the first joint.
const stub = Buffer.alloc(3 * 12 + 3 * 8 + 3 * 16);
[[0, 0, 0], [.01, 0, 0], [0, .01, 0]].forEach((p, i) => p.forEach((v, c) => stub.writeFloatLE(v, i * 12 + c * 4)));
for (let i = 0; i < 3; i++) { stub.writeUInt16LE(0, 36 + i * 8); stub.writeFloatLE(1, 60 + i * 16); }

const views = [], chunks = [];
let offset = 0;
const addView = (bytes, extra = {}) => {
  const pad = (4 - offset % 4) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...extra });
  chunks.push(bytes);
  offset += bytes.length;
  return views.length - 1;
};
const viewMap = new Map();
const accessors = [], accessorMap = new Map();
gltf.accessors.forEach((accessor, i) => {
  if (!keepAccessors[i]) return;
  if (accessor.bufferView !== undefined && !viewMap.has(accessor.bufferView)) {
    const view = gltf.bufferViews[accessor.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const { buffer, byteOffset, byteLength, ...extra } = view;
    viewMap.set(accessor.bufferView, addView(Buffer.from(bytes), extra));
  }
  accessorMap.set(i, accessors.length);
  accessors.push({ ...accessor, ...(accessor.bufferView !== undefined ? { bufferView: viewMap.get(accessor.bufferView) } : {}) });
});
const stubView = addView(stub);
const stubAccessor = (byteOffset, componentType, type, extra = {}) => {
  accessors.push({ bufferView: stubView, byteOffset, componentType, count: 3, type, ...extra });
  return accessors.length - 1;
};
const position = stubAccessor(0, 5126, 'VEC3', { min: [0, 0, 0], max: [.01, .01, 0] });
const joints = stubAccessor(36, 5123, 'VEC4');
const weights = stubAccessor(60, 5126, 'VEC4');

const remap = i => accessorMap.get(i);
for (const skin of gltf.skins) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap(skin.inverseBindMatrices);
for (const animation of gltf.animations) for (const sampler of animation.samplers) {
  sampler.input = remap(sampler.input);
  sampler.output = remap(sampler.output);
}
gltf.meshes[0].primitives = [{ attributes: { POSITION: position, JOINTS_0: joints, WEIGHTS_0: weights }, material: 0 }];
gltf.accessors = accessors;
gltf.bufferViews = views;
gltf.buffers = [{ byteLength: offset }];

const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const binData = Buffer.concat(chunks);
const binPadded = Buffer.concat([binData, Buffer.alloc((4 - binData.length % 4) % 4)]);
const header = Buffer.alloc(12);
header.write('glTF', 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
const out = Buffer.concat([header, chunk(0x4e4f534a, jsonPadded), chunk(0x004e4942, binPadded)]);
writeFileSync(path, out);
console.log(`${path}: ${file.length} -> ${out.length} bytes`);

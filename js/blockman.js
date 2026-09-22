/**
 * blockman.js - Minecraft-style block people.
 *
 * Players keep the squad model's skeleton and animation; the scanned mesh is
 * hidden and each bone carries rigid, textured boxes instead. Box sizes come
 * from the rig's rest-pose joints (the model is the guide, not the source), in
 * whole "pixels" of BLOCK_PX. Every face is painted onto a small per-player
 * skin canvas, texel for texel, so kit colours, numbers and looks are just a
 * repaint. Nothing here runs per frame; repaints happen on kit or look changes.
 */
import * as THREE from 'three';

// Minecraft proportions, 32 px tall: head 8, body 12 (shirt 9 + shorts 3), legs 12.
export const BLOCK_PX = 0.0575;  // one skin texel, in model units
const P = BLOCK_PX;
export const SKIN_SIZE = 128;
/** Head centre above the shirt top, in pixels: 8 px head sunk 1.5 px over the collar. */
export const HEAD_RISE = 2.5;

/*
 * Each part: the bone it rides, its box in pixels [w, h, d] and where its
 * texture sits in the skin. The strip layout is Minecraft's: top and bottom
 * above, then right side, front, left side and back in one row.
 */
const LAYOUT = {
  head: [8, 8, 8, 0, 0], hat: [8, 8, 8, 32, 0], torso: [8, 9, 4, 64, 0], hips: [8, 3, 4, 88, 0],
  armL: [4, 10, 4, 0, 16], armR: [4, 10, 4, 16, 16],
  thighL: [4, 5, 4, 64, 16], thighR: [4, 5, 4, 80, 16], shinL: [4, 7, 4, 96, 16], shinR: [4, 7, 4, 112, 16],
  bootL: [4, 2, 5, 0, 32], bootR: [4, 2, 5, 18, 32], tail: [2, 5, 2, 40, 32], bun: [3, 3, 3, 48, 32],
};

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

const partGeometries = new Map();
/** Shared box for a named skin part, for rigs built by hand rather than measured. */
export function blockPart(name, grow = 1) {
  const key = name + ':' + grow;
  if (!partGeometries.has(key)) partGeometries.set(key, blockGeometry(LAYOUT[name], grow));
  return partGeometries.get(key);
}

/** Box with Minecraft-strip UVs; `grow` inflates it (the hair layer) without changing its texels. */
function blockGeometry([w, h, d, u0, v0], grow = 1) {
  const a = w * P / 2 * grow, b = h * P / 2 * grow, c = d * P / 2 * grow;
  const positions = [], normals = [], uvs = [], index = [];
  const face = (corners, normal, u, v, fw, fh) => {
    // corners: top-left, top-right, bottom-right, bottom-left as seen from outside
    const base = positions.length / 3;
    const tex = [[u, v], [u + fw, v], [u + fw, v + fh], [u, v + fh]];
    corners.forEach((p, i) => {
      positions.push(...p);
      normals.push(...normal);
      uvs.push(tex[i][0] / SKIN_SIZE, 1 - tex[i][1] / SKIN_SIZE);
    });
    index.push(base, base + 3, base + 2, base, base + 2, base + 1);
  };
  face([[-a, b, c], [a, b, c], [a, -b, c], [-a, -b, c]], [0, 0, 1], u0 + d, v0 + d, w, h);            // front
  face([[a, b, -c], [-a, b, -c], [-a, -b, -c], [a, -b, -c]], [0, 0, -1], u0 + 2 * d + w, v0 + d, w, h); // back
  face([[-a, b, -c], [-a, b, c], [-a, -b, c], [-a, -b, -c]], [-1, 0, 0], u0, v0 + d, d, h);          // right (-x)
  face([[a, b, c], [a, b, -c], [a, -b, -c], [a, -b, c]], [1, 0, 0], u0 + d + w, v0 + d, d, h);      // left (+x)
  face([[-a, b, -c], [a, b, -c], [a, b, c], [-a, b, c]], [0, 1, 0], u0 + d, v0, w, d);              // top
  face([[-a, -b, c], [a, -b, c], [a, -b, -c], [-a, -b, -c]], [0, -1, 0], u0 + d + w, v0, w, d);    // bottom
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Measures the rest-pose skeleton once and returns the part list shared by
 * every player: { name, bone, geometry, local } with `local` the box's matrix
 * in its bone's frame.
 */
export function measureBlockParts(model, boneName) {
  model.updateMatrixWorld(true);
  const bone = name => model.getObjectByName(boneName(name));
  const at = name => bone(name).getWorldPosition(new THREE.Vector3());
  const up = new THREE.Vector3(0, 1, 0);
  const front = at('HeadFront').sub(at('Head')).setY(0).normalize();
  const hips = at('Hips');
  const parts = [];
  const add = (name, boneKey, center, axisY, grow = 1) => {
    _y.copy(axisY).normalize();
    _z.copy(front).addScaledVector(_y, -front.dot(_y)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z).setPosition(center);
    const owner = bone(boneKey);
    const local = owner.matrixWorld.clone().invert().multiply(_m);
    parts.push({ name, bone: boneName(boneKey), geometry: blockPart(name, grow), local });
  };
  const side = new THREE.Vector3().crossVectors(up, front); // the model's left
  const along = (from, to, px, start = 0) => from.clone().lerp(to, 0).addScaledVector(
    to.clone().sub(from).normalize(), (start + px / 2) * P);

  // Torso: shirt from shoulder height down, shorts under it, both centred on
  // the hips. The body runs 12 px, below the hip joints, so the legs read short.
  const shoulderY = at('LeftArm').y;
  const torsoTop = shoulderY + P * .5;
  const legTop = torsoTop - 12 * P;
  add('torso', 'Spine1', new THREE.Vector3(hips.x, torsoTop - 4.5 * P, hips.z), up);
  add('hips', 'Hips', new THREE.Vector3(hips.x, legTop + 1.5 * P, hips.z), up);
  // Head sits over the shirt collar (1.5 px down), a little forward of the
  // neck, so the crown stays at the scanned player's height.
  const head = new THREE.Vector3(hips.x, torsoTop + HEAD_RISE * P, at('Head').z).addScaledVector(front, P * .5);
  add('head', 'Head', head, up);
  add('hat', 'Head', head, up, 1.14);
  add('tail', 'Head', head.clone().addScaledVector(front, -5 * P).addScaledVector(up, -1.5 * P), up);
  add('bun', 'Head', head.clone().addScaledVector(front, -5 * P).addScaledVector(up, 2 * P), up);

  for (const [s, L] of [[1, 'Left'], [-1, 'Right']]) {
    const key = s > 0 ? 'L' : 'R';
    // One straight arm per side, as in Minecraft: it rides the upper-arm bone
    // and ignores the elbow. It hangs outside the shirt: the box is shifted off
    // the bone axis towards the rest pose's "up", which becomes "outward" once
    // the arm hangs down.
    const shoulder = at(L + 'Arm'), hand = at(L + 'HandMiddle4');
    const outward = up.clone().multiplyScalar(4 * P + 2 * P - Math.abs(shoulder.clone().sub(hips).dot(side)));
    add('arm' + key, L + 'Arm', along(shoulder, hand, 10, -.5).add(outward), shoulder.clone().sub(hand));
    const hip = at(L + 'UpLeg'), knee = at(L + 'Leg'), foot = at(L + 'Foot'), toe = at(L + 'Toe_End');
    const legX = side.clone().multiplyScalar(s * 2 * P);
    const legOffset = legX.sub(side.clone().multiplyScalar(hip.clone().sub(hips).dot(side)));
    // The visible thigh starts under the shorts and ends at the knee; it still
    // pivots at the hip joint above it, as Minecraft legs pivot at the body.
    const thighStart = (hip.y - legTop) / P - .5;
    add('thigh' + key, L + 'UpLeg', along(hip, knee, 5, thighStart).add(legOffset), hip.clone().sub(knee));
    add('shin' + key, L + 'Leg', along(knee, foot, 7).add(legOffset), knee.clone().sub(foot));
    // Boots stand on the ground, heel under the ankle, toes forward.
    const forward = toe.clone().sub(foot).setY(0).normalize();
    const boot = foot.clone().add(legOffset).setY(P).addScaledVector(forward, 1.5 * P);
    const saved = front.clone();
    front.copy(forward);
    add('boot' + key, L + 'Foot', boot, up);
    front.copy(saved);
  }
  return parts;
}

// ---- Skins -----------------------------------------------------------------
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

/** Calls fn(face, x, y, fw, fh) for every texel of a part and writes the colour it returns. */
function paintPart(data, name, fn) {
  const [w, h, d, u0, v0] = LAYOUT[name];
  const faces = [['top', u0 + d, v0, w, d], ['bottom', u0 + d + w, v0, w, d],
    ['right', u0, v0 + d, d, h], ['front', u0 + d, v0 + d, w, h],
    ['left', u0 + d + w, v0 + d, d, h], ['back', u0 + 2 * d + w, v0 + d, w, h]];
  for (const [face, u, v, fw, fh] of faces) {
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const colour = fn(face, x, y, fw, fh);
      const i = ((v + y) * SKIN_SIZE + u + x) * 4;
      if (colour === null) { data[i + 3] = 0; continue; }
      data[i] = (colour >> 16) & 255; data[i + 1] = (colour >> 8) & 255; data[i + 2] = colour & 255;
      data[i + 3] = 255;
    }
  }
}

const shade = (colour, f) => {
  const r = Math.min(255, ((colour >> 16) & 255) * f), g = Math.min(255, ((colour >> 8) & 255) * f);
  const b = Math.min(255, (colour & 255) * f);
  return (r << 16) | (g << 8) | b;
};
// Stable per-texel noise so flat colours read as pixel art rather than plastic.
const grain = (x, y, seed) => {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return .94 + (n - Math.floor(n)) * .1;
};

const LONG = new Set(['floppy', 'swept', 'curls', 'afro', 'ponytail', 'bun']);

/**
 * Paints one player's skin. `dress` = { look, kit: { kit, shorts, socks, boots,
 * gloves? }, number, pattern: 'stripes'|'hoops'|'checks'|null, accent, sleeves,
 * trousers } - `sleeves` and `trousers` give long clothes (keepers, staff).
 */
export function paintSkin(canvas, dress) {
  const paint = canvas.getContext('2d');
  const image = paint.createImageData(SKIN_SIZE, SKIN_SIZE);
  const data = image.data;
  const { look, kit, number } = dress;
  const skin = look.skin, hair = look.style === 'bald' ? look.skin : look.hair;
  const style = look.style;
  const seed = (skin ^ hair) & 1023;
  const texel = (colour, x, y, face) => shade(colour, grain(x + face.length * 7, y, seed));
  const accent = dress.accent ?? kit.kit;
  const shirtAt = (face, x, y) => {
    const stripe = x % 2 === 0, hoop = y % 2 === 0;
    const on = dress.pattern === 'stripes' ? stripe : dress.pattern === 'hoops' ? hoop
      : dress.pattern === 'checks' ? stripe !== hoop : false;
    return on ? accent : kit.kit;
  };

  // Head: skin, hair by style, then the face.
  const hairRows = { front: style === 'floppy' ? 2 : style === 'bald' ? 0 : 1,
    side: style === 'bald' ? 0 : style === 'buzz' || style === 'crop' ? 1 : LONG.has(style) ? 4 : 2,
    back: style === 'bald' ? 0 : style === 'buzz' ? 2 : LONG.has(style) ? 7 : 4 };
  const hairColour = style === 'buzz' ? shade(hair, 1.15) : hair;
  paintPart(data, 'head', (face, x, y) => {
    let c = skin;
    const rows = face === 'front' ? hairRows.front : face === 'back' ? hairRows.back
      : face === 'top' ? 99 : face === 'bottom' ? 0 : hairRows.side;
    if (style !== 'bald' && y < rows) c = hairColour;
    if (style === 'sidepart' && face === 'front' && y === 1 && x < 3) c = hairColour;
    if (style === 'swept' && face === 'front' && y === 1 && x > 3) c = hairColour;
    if (face === 'front') {
      if (y === 4 && (x === 1 || x === 6)) c = 0xf2f2ee;           // eye whites
      if (y === 4 && (x === 2 || x === 5)) c = 0x2b3a55;           // pupils
      if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6) && style !== 'bald') c = shade(hair, .9); // brows
      if (y === 5 && (x === 3 || x === 4)) c = shade(skin, .82);   // nose
      if (y === 6 && x >= 3 && x <= 4) c = shade(skin, .55);       // mouth
      if (look.beard >= .4 && y >= 6 && !(y === 6 && (x === 3 || x === 4))) c = shade(look.hair, .95);
      if (look.moustache && y === 6 && x >= 2 && x <= 5) c = look.hair;
    }
    if ((face === 'left' || face === 'right') && look.beard >= .4 && y >= 5
      && (face === 'left' ? x < 3 : x > 4)) c = look.hair;
    if (style === 'headband' && y === 2 && face !== 'top' && face !== 'bottom') c = 0x1d1f24;
    return texel(c, x, y, face);
  });
  // Hair layer: volume for curls and afros, transparent elsewhere.
  const volume = style === 'afro' ? 5 : style === 'curls' ? 3 : 0;
  paintPart(data, 'hat', (face, x, y) => {
    if (!volume) return null;
    if (face === 'bottom') return null;
    if (face === 'front' && y >= 1) return null;
    if ((face === 'left' || face === 'right') && y >= volume) return null;
    if (face === 'back' && y >= volume + 2) return null;
    const curl = (x + y) % 3 === 0 ? .82 : 1;
    return texel(shade(hair, curl), x, y, face);
  });
  paintPart(data, 'tail', (face, x, y) => texel(y === 0 ? 0x292b30 : hair, x, y, face));
  paintPart(data, 'bun', (face, x, y) => texel(hair, x, y, face));

  // Shirt: pattern, collar, and the number on the back in 3x5 digits.
  const text = number == null ? '' : String(number);
  const digits = new Set();
  if (text) {
    let x0 = Math.floor((8 - (text.length * 4 - 1)) / 2);
    for (const ch of text) {
      const glyph = DIGITS[+ch];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (glyph[r * 3 + c] === '1') digits.add((r + 1) * 8 + x0 + c);
      x0 += 4;
    }
  }
  const numberColour = (kit.kit & 0xff) + ((kit.kit >> 8) & 0xff) + (kit.kit >> 16) > 520 ? 0x1b1f27 : 0xf4f6f8;
  paintPart(data, 'torso', (face, x, y) => {
    let c = shirtAt(face, x, y);
    if (face === 'back' && digits.has(y * 8 + x)) c = numberColour;
    if (face === 'front' && y === 0 && (x === 3 || x === 4)) c = skin;   // open collar
    if (face === 'top' && x >= 3 && x <= 4 && y >= 1 && y <= 2) c = skin;
    return texel(c, x, y, face);
  });
  paintPart(data, 'hips', (face, x, y) => texel(face !== 'top' && y === 0 ? shade(kit.shorts, .8) : kit.shorts, x, y, face));

  for (const key of ['L', 'R']) {
    const sleeves = dress.sleeves ? 8 : 3;
    paintPart(data, 'arm' + key, (face, x, y) => {
      const hand = face === 'bottom' || y >= 8;
      let c = face === 'top' || y < sleeves ? shirtAt(face, x, y) : skin;
      if (hand && kit.gloves) c = kit.gloves;
      if (!hand && !dress.sleeves && y === sleeves - 1 && face !== 'top') c = shade(shirtAt(face, x, y), .8); // cuff
      return texel(c, x, y, face);
    });
    // Shorts run from the hips block over the thighs; socks are pulled to the knee.
    paintPart(data, 'thigh' + key, (face, x, y) => texel(face !== 'top' && y === 4 && !dress.trousers
      ? shade(kit.shorts, .82) : kit.shorts, x, y, face));
    paintPart(data, 'shin' + key, (face, x, y) => texel(dress.trousers ? kit.shorts
      : y === 0 && face !== 'bottom' ? skin : y === 1 && face !== 'bottom' ? shade(kit.socks, .78) : kit.socks, x, y, face));
    paintPart(data, 'boot' + key, (face, x, y) => {
      let c = kit.boots;
      if (face !== 'top' && y === 1) c = shade(kit.boots, 1.8) || 0x3a3f46;   // sole
      if (face === 'top' && y < 2) c = kit.socks;                             // sock cuff
      return texel(c || 0x1a1d22, x, y, face);
    });
  }
  paint.putImageData(image, 0, 0);
}

/** Which optional pieces a look shows. */
export function blockPartVisible(name, look) {
  if (name === 'hat') return look.style === 'afro' || look.style === 'curls';
  if (name === 'tail') return look.style === 'ponytail';
  if (name === 'bun') return look.style === 'bun';
  return true;
}

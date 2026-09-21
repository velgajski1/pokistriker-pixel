/**
 * gameEngine.js - Three.js setup, scene rendering, and match simulation.
 *
 * Every mesh in the arena is built exactly once during boot: one squad of
 * rigged humanoids is created and then repositioned via .position.set() for
 * the rest of the session. Nothing is disposed or rebuilt at runtime.
 *
 * Two modes share the same actors:
 *   AMBIENT   - a live match plays out behind the dimmer: players hold shape,
 *               the ball is passed around, the referee follows the play.
 *   CHANCE    - the squad snaps into a shooting scenario at an arbitrary spot
 *               on the pitch and the camera cuts in behind the striker.
 *
 * Players are hierarchical rigs (shoulder -> elbow -> hand), which matters for
 * more than looks: the keeper's and defenders' collision capsules are read
 * straight off their animated joints, so what you see reaching for the ball is
 * exactly what the save/block test uses.
 */
import * as THREE from 'three';
import { GOAL, BALL_START, BALL_R, NET, netPockets } from './physics.js';

// ---- File-scope scratch. Never allocate inside the rAF path. --------------
const _camTarget = new THREE.Vector3(0, 1.35, GOAL.PLANE_Z);
const _camTargetWant = new THREE.Vector3(0, 1.35, GOAL.PLANE_Z);
const _camHome = new THREE.Vector3(0, 3.6, 8.2);
const _camWant = new THREE.Vector3();
const _wp = new THREE.Vector3();

const CLEAR = 0x0d141d;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let renderer, scene, camera, clock;
let frameCb = null;
let shakeAmp = 0;
let started = false;

export const objects = { ball: null, arrow: null, guide: null, elevation: null };

// ---------------------------------------------------------------------------
// Rigged humanoid
// ---------------------------------------------------------------------------
const RIG = {
  HIP_Y: 0.90, KNEE: 0.46, ANKLE: 0.42,
  SHOULDER_Y: 1.44, SHOULDER_X: 0.245,
  UPPER_ARM: 0.33, FOREARM: 0.30,
  HEAD_Y: 1.70,
};

// ---------------------------------------------------------------------------
// Appearance
//
// A squad of identical clones reads as placeholder art, so every player is
// dealt a "look": skin tone, hair colour and style, build, and facial detail.
// The spread is weighted the way a European league actually looks - mostly
// fair-to-olive with a real mixture - rather than uniformly random.
// ---------------------------------------------------------------------------
const SKIN = {
  pale:  0xf1d0b4, fair: 0xeac3a0, light: 0xe0b089, olive: 0xcf9a70,
  tan:   0xbc8452, brown: 0x96603a, deep: 0x6d4527, dark: 0x4e3119,
};

const HAIR = {
  black: 0x131010, darkBrown: 0x2b1b11, brown: 0x4a2f1b, lightBrown: 0x6d4727,
  darkBlond: 0x8d6b36, blond: 0xcaa75f, platinum: 0xdccb95,
  ginger: 0x9d4b1f, grey: 0x93949a,
};

/**
 * Player archetypes. Each is a silhouette you can tell apart at match camera
 * distance. The comments name the kind of player each one is modelled on -
 * these are build-and-hair references for the artwork, not real individuals.
 */
const LOOKS = [
  // tall, lean, fair, blond with a headband and a short tail
  { skin: SKIN.pale,  hair: HAIR.blond,      style: 'headband', height: 1.075, build: 0.95, beard: 0.2, brow: 1 },
  // short, low centre of gravity, olive, dark hair, heavy stubble
  { skin: SKIN.olive, hair: HAIR.darkBrown,  style: 'curls',    height: 0.935, build: 1.07, beard: 0.7, brow: 1 },
  // small, quick, fair, floppy dark-blond mop
  { skin: SKIN.fair,  hair: HAIR.darkBlond,  style: 'floppy',   height: 0.945, build: 0.97, beard: 0.15, brow: 1 },
  // tall, athletic, tan, razor-short crop, trimmed beard
  { skin: SKIN.tan,   hair: HAIR.black,      style: 'buzz',     height: 1.055, build: 1.04, beard: 0.45, brow: 1 },
  // young, light olive, plain dark crop
  { skin: SKIN.light, hair: HAIR.black,      style: 'crop',     height: 0.98,  build: 0.94, beard: 0,   brow: 1 },
  // very tall, fair, brown crop with a full beard
  { skin: SKIN.fair,  hair: HAIR.brown,      style: 'crop',     height: 1.07,  build: 1.05, beard: 0.9, brow: 1 },
  // brown skin, big natural curls
  { skin: SKIN.brown, hair: HAIR.black,      style: 'afro',     height: 1.0,   build: 1.0,  beard: 0.35, brow: 1 },
  // deep skin, shaved close
  { skin: SKIN.deep,  hair: HAIR.black,      style: 'buzz',     height: 1.03,  build: 1.03, beard: 0.3, brow: 1 },
  // pale, shaved head
  { skin: SKIN.pale,  hair: HAIR.grey,       style: 'bald',     height: 1.01,  build: 1.02, beard: 0.5, brow: 1 },
  // pale, ginger crop
  { skin: SKIN.pale,  hair: HAIR.ginger,     style: 'crop',     height: 0.99,  build: 0.99, beard: 0.25, brow: 1 },
  // olive, hair tied up in a bun
  { skin: SKIN.olive, hair: HAIR.darkBrown,  style: 'bun',      height: 1.02,  build: 0.98, beard: 0.4, brow: 1 },
  // fair, long hair tied back
  { skin: SKIN.light, hair: HAIR.lightBrown, style: 'ponytail', height: 1.04,  build: 0.96, beard: 0,   brow: 1 },
  // dark skin, tight curls
  { skin: SKIN.dark,  hair: HAIR.black,      style: 'curls',    height: 1.045, build: 1.02, beard: 0.2, brow: 1 },
  // pale, platinum-bleached crop
  { skin: SKIN.fair,  hair: HAIR.platinum,   style: 'crop',     height: 1.0,   build: 1.0,  beard: 0.3, brow: 1 },
];

/** Deals distinct looks so no two players on screen are the same person. */
function dealLooks(n) {
  const pool = LOOKS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  return out;
}

function buildHair(style, matHair, body) {
  const y = RIG.HEAD_Y;
  const cap = (r, theta, dy, dz) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * theta), matHair);
    m.position.set(0, y + (dy || 0.014), dz === undefined ? -0.018 : dz);
    m.scale.z = 1.1;
    m.rotation.x = -0.14;          // ride it back off the forehead
    body.add(m);
    return m;
  };

  switch (style) {
    case 'bald':
      break;
    case 'buzz':
      cap(0.129, 0.46);
      break;
    case 'floppy': {
      const c = cap(0.138, 0.62, 0.008, -0.004);
      c.rotation.x = 0.13;
      break;
    }
    case 'curls': {
      cap(0.140, 0.58);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), matHair);
        b.position.set(Math.cos(a) * 0.104, y + 0.052, Math.sin(a) * 0.104 - 0.012);
        body.add(b);
      }
      break;
    }
    case 'afro': {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.176, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.64), matHair);
      m.position.set(0, y - 0.005, -0.022);
      body.add(m);
      break;
    }
    case 'ponytail': {
      cap(0.131, 0.55);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.15, 4, 8), matHair);
      tail.position.set(0, y - 0.048, -0.148);
      tail.rotation.x = -0.5;
      body.add(tail);
      break;
    }
    case 'bun': {
      cap(0.131, 0.54);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), matHair);
      bun.position.set(0, y + 0.046, -0.134);
      body.add(bun);
      break;
    }
    case 'headband': {
      cap(0.131, 0.54);
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.127, 0.016, 6, 18),
        new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.85 }));
      band.position.set(0, y + 0.036, 0);
      band.rotation.x = Math.PI / 2 - 0.1;
      band.scale.z = 1.08;
      body.add(band);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.12, 4, 8), matHair);
      tail.position.set(0, y - 0.03, -0.142);
      tail.rotation.x = -0.45;
      body.add(tail);
      break;
    }
    default:                 // 'crop'
      cap(0.130, 0.53);
  }
}

const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x15191f });

/** Eyes, brows and beard. Only worth building on the players you see close up. */
function buildFace(body, look, matHair) {
  const y = RIG.HEAD_Y;

  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6), EYE_MAT);
    eye.position.set(sx * 0.047, y + 0.008, 0.116);
    body.add(eye);
  }
  if (look.brow) {
    for (const sx of [-1, 1]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.011, 0.014), matHair);
      brow.position.set(sx * 0.049, y + 0.050, 0.108);
      brow.rotation.z = sx * 0.13;
      body.add(brow);
    }
  }
  if (look.beard > 0) {
    const light = look.beard < 0.6;
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(0.133, 14, 8, 0, Math.PI, Math.PI * 0.56, Math.PI * 0.26),
      new THREE.MeshStandardMaterial({
        color: matHair.color, roughness: 0.95,
        transparent: light, opacity: light ? 0.5 + look.beard * 0.6 : 1,
      }));
    beard.position.set(0, y, 0.004);
    beard.scale.z = 1.1;
    body.add(beard);
  }
}

const numberCache = new Map();
function numberTexture(n) {
  if (numberCache.has(n)) return numberCache.get(n);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.font = 'bold 92px ui-monospace, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  numberCache.set(n, t);
  return t;
}

function buildHumanoid({ kit, shorts, socks, boots, gloves, number, lite }, look) {
  const { skin, hair } = look;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Height is a uniform scale on the root, so collision capsules - which are
  // read from world-space joints - stay consistent with what is drawn. Their
  // radii are scaled to match in makeCapsuleSet().
  root.scale.setScalar(look.height);

  const matKit = new THREE.MeshStandardMaterial({ color: kit, roughness: 0.78 });
  const matShorts = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.82 });
  const matSocks = new THREE.MeshStandardMaterial({ color: socks, roughness: 0.85 });
  const matBoots = new THREE.MeshStandardMaterial({ color: boots, roughness: 0.5 });
  const matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const matHair = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 });
  const matHand = new THREE.MeshStandardMaterial({ color: gloves || skin, roughness: 0.6 });

  const cast = (m, always) => { if (always || !lite) m.castShadow = true; return m; };

  // --- torso ---------------------------------------------------------------
  const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 6, 14), matKit), true);
  torso.position.y = 1.17;
  torso.scale.set(look.build, 1, 0.72 * look.build);
  body.add(torso);

  const hips = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.12, 4, 12), matShorts), true);
  hips.position.y = 0.94;
  hips.scale.z = 0.75;
  body.add(hips);

  const shoulders = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.30, 4, 10), matKit));
  shoulders.scale.y = look.build;
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = RIG.SHOULDER_Y;
  body.add(shoulders);

  if (number != null) {
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.3),
      new THREE.MeshBasicMaterial({ map: numberTexture(number), transparent: true })
    );
    back.position.set(0, 1.22, -0.147);
    back.rotation.y = Math.PI;
    body.add(back);
  }

  // --- head ----------------------------------------------------------------
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), matSkin);
  neck.position.y = 1.55;
  body.add(neck);

  const head = cast(new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 12), matSkin), true);
  head.position.y = RIG.HEAD_Y;
  head.scale.z = 1.1;
  body.add(head);

  buildHair(look.style, matHair, body);
  if (!lite) buildFace(body, look, matHair);   // only the players seen close up

  // --- arms ----------------------------------------------------------------
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * RIG.SHOULDER_X, RIG.SHOULDER_Y, 0);
    body.add(shoulder);

    const upper = cast(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.058, RIG.UPPER_ARM - 0.116, 4, 8), matKit));
    upper.position.y = -RIG.UPPER_ARM / 2;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -RIG.UPPER_ARM;
    shoulder.add(elbow);

    const fore = cast(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, RIG.FOREARM - 0.1, 4, 8), matSkin));
    fore.position.y = -RIG.FOREARM / 2;
    elbow.add(fore);

    const hand = cast(new THREE.Mesh(
      new THREE.SphereGeometry(gloves ? 0.085 : 0.062, 8, 6), matHand));
    hand.position.y = -RIG.FOREARM;
    hand.scale.z = 0.8;
    elbow.add(hand);

    const handMarker = new THREE.Object3D();
    handMarker.position.y = -RIG.FOREARM;
    elbow.add(handMarker);

    arms.push({ sx, shoulder, elbow, handMarker });
  }

  // --- legs ----------------------------------------------------------------
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.105, RIG.HIP_Y, 0);
    body.add(hip);

    const thigh = cast(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.093, RIG.KNEE - 0.186, 4, 8), matShorts), true);
    thigh.position.y = -RIG.KNEE / 2;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -RIG.KNEE;
    hip.add(knee);

    const shin = cast(new THREE.Mesh(
      new THREE.CapsuleGeometry(0.072, RIG.ANKLE - 0.144, 4, 8), matSocks), true);
    shin.position.y = -RIG.ANKLE / 2;
    knee.add(shin);

    const boot = cast(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.085, 0.27), matBoots));
    boot.position.set(0, -RIG.ANKLE - 0.02, 0.055);
    knee.add(boot);

    const ankleMarker = new THREE.Object3D();
    ankleMarker.position.y = -RIG.ANKLE;
    knee.add(ankleMarker);

    legs.push({ sx, hip, knee, ankleMarker });
  }

  const hipMarker = new THREE.Object3D();
  hipMarker.position.y = 0.94;
  body.add(hipMarker);
  const neckMarker = new THREE.Object3D();
  neckMarker.position.y = 1.50;
  body.add(neckMarker);

  return { root, body, arms, legs, hipMarker, neckMarker, scale: look.height };
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------
const KIT_HOME = { kit: 0x2f6bff, shorts: 0xf4f7fa, socks: 0x2f6bff, boots: 0x101418 };
const KIT_AWAY = { kit: 0xe23b4e, shorts: 0x1b1f27, socks: 0xe23b4e, boots: 0x0f1116 };
const KIT_REF  = { kit: 0x14181f, shorts: 0x14181f, socks: 0x14181f, boots: 0x0a0c10 };
const KIT_KEEP = { kit: 0xff8a2b, shorts: 0x14202e, socks: 0x1b2836, boots: 0x0c1017, gloves: 0xe8f0ff };

const squad = { keeper: null, striker: null, mates: [], foes: [], ref: null };

function buildSquad() {
  const looks = dealLooks(10);   // keeper + striker + 3 mates + 4 foes + referee
  let n = 0;

  // The keeper's height is pinned: his capsules are the save volume, and the
  // shot balance is tuned against it.
  squad.keeper = buildHumanoid({ ...KIT_KEEP, number: 1 }, { ...looks[n++], height: 1.02 });
  squad.keeper.root.position.set(0, 0, GOAL.PLANE_Z + 0.75);
  scene.add(squad.keeper.root);

  squad.striker = buildHumanoid({ ...KIT_HOME, number: 9 }, looks[n++]);
  scene.add(squad.striker.root);

  for (let i = 0; i < 3; i++) {
    const m = buildHumanoid({ ...KIT_HOME, number: [7, 8, 11][i], lite: true }, looks[n++]);
    squad.mates.push(m);
    scene.add(m.root);
  }
  for (let i = 0; i < 4; i++) {
    const f = buildHumanoid({ ...KIT_AWAY, number: 2 + i, lite: i > 1 }, looks[n++]);
    squad.foes.push(f);
    scene.add(f.root);
  }
  squad.ref = buildHumanoid({ ...KIT_REF, lite: true }, looks[n++]);
  scene.add(squad.ref.root);
}

// ---------------------------------------------------------------------------
// Collision capsules, read from the live rigs
// ---------------------------------------------------------------------------
function makeCapsuleSet(rig) {
  const caps = [];
  const src = [];
  const s = rig.scale || 1;
  const add = (from, to, r) => {
    caps.push({ a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, r: r * s });
    src.push([from, to]);
  };
  add(rig.hipMarker, rig.neckMarker, 0.23);          // torso
  for (const arm of rig.arms) {
    add(arm.shoulder, arm.elbow, 0.10);              // upper arm
    add(arm.elbow, arm.handMarker, 0.10);            // forearm + hand
  }
  for (const leg of rig.legs) add(leg.hip, leg.ankleMarker, 0.13);
  return { rig, caps, src };
}

function refreshCapsules(set, out, at) {
  set.rig.root.updateWorldMatrix(true, true);
  for (let i = 0; i < set.caps.length; i++) {
    const [from, to] = set.src[i];
    const cap = set.caps[i];
    from.getWorldPosition(_wp); cap.a.x = _wp.x; cap.a.y = _wp.y; cap.a.z = _wp.z;
    to.getWorldPosition(_wp);   cap.b.x = _wp.x; cap.b.y = _wp.y; cap.b.z = _wp.z;
    out[at + i] = cap;
  }
  return at + set.caps.length;
}

let keeperSet = null;
const blockerSets = [];
const _keeperCaps = [];
const _blockerCaps = [];

/** Keeper's world-space collision capsules, refreshed from his live pose. */
export function getKeeperCapsules() {
  _keeperCaps.length = refreshCapsules(keeperSet, _keeperCaps, 0);
  return _keeperCaps;
}

/** Active defenders' collision capsules. Empty when no one is in the way. */
export function getBlockerCapsules() {
  let n = 0;
  for (let i = 0; i < chance.blockerCount; i++) n = refreshCapsules(blockerSets[i], _blockerCaps, n);
  _blockerCaps.length = n;
  return _blockerCaps;
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------
function turfTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#1d5f34' : '#19532d';
    g.fillRect(0, i * 32, 256, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 9);
  t.anisotropy = 4;
  return t;
}

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f9fb';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#14181d';
  const spots = [[40, 46], [128, 30], [212, 54], [84, 122], [176, 118], [40, 198], [130, 214], [214, 190]];
  for (const [cx, cy] of spots) {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * 26, py = cy + Math.sin(a) * 26;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function buildField() {
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 170),
    new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: 0.95 })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.z = -40;
  field.receiveShadow = true;
  scene.add(field);

  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const strip = (pts) => {
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map((p) => new THREE.Vector3(p[0], 0.02, p[1]))
    );
    scene.add(new THREE.Line(geo, lineMat));
  };

  strip([[-34, GOAL.PLANE_Z], [34, GOAL.PLANE_Z]]);
  strip([[-9.16, GOAL.PLANE_Z], [-9.16, GOAL.PLANE_Z + 5.5], [9.16, GOAL.PLANE_Z + 5.5], [9.16, GOAL.PLANE_Z]]);
  strip([[-20.16, GOAL.PLANE_Z], [-20.16, GOAL.PLANE_Z + 16.5], [20.16, GOAL.PLANE_Z + 16.5], [20.16, GOAL.PLANE_Z]]);
  strip([[-34, GOAL.PLANE_Z + 52], [34, GOAL.PLANE_Z + 52]]);          // halfway line
  strip([[-34, GOAL.PLANE_Z], [-34, GOAL.PLANE_Z + 52]]);              // touchlines
  strip([[34, GOAL.PLANE_Z], [34, GOAL.PLANE_Z + 52]]);

  const arc = [];
  for (let i = 0; i <= 28; i++) {
    const a = Math.PI * (0.15 + 0.7 * (i / 28));
    arc.push([Math.cos(a) * 9.15, GOAL.PLANE_Z + 11 + Math.sin(a) * 9.15]);
  }
  strip(arc);

  const circle = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    circle.push([Math.cos(a) * 9.15, GOAL.PLANE_Z + 52 + Math.sin(a) * 9.15]);
  }
  strip(circle);
}

function buildGoal() {
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(GOAL.POST_R, GOAL.POST_R, GOAL.HEIGHT, 12);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, frame);
    p.position.set(sx * GOAL.HALF_W, GOAL.HEIGHT / 2, GOAL.PLANE_Z);
    p.castShadow = true;
    scene.add(p);
  }
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(GOAL.POST_R, GOAL.POST_R, GOAL.HALF_W * 2 + GOAL.POST_R * 2, 12), frame);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL.HEIGHT, GOAL.PLANE_Z);
  bar.castShadow = true;
  scene.add(bar);

  const net = new THREE.MeshBasicMaterial({
    color: 0xc4d6e8, wireframe: true, transparent: true, opacity: 0.42,
  });
  const depth = NET.DEPTH;

  // Panel order must match physics.NET_PANELS: back, left, right, roof.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL.HALF_W * 2, GOAL.HEIGHT, 22, 9), net);
  back.position.set(0, GOAL.HEIGHT / 2, GOAL.PLANE_Z - depth);
  scene.add(back);
  registerNetPanel(back, 0, 0, -1);

  let idx = 1;
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, GOAL.HEIGHT, 6, 9), net);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * GOAL.HALF_W, GOAL.HEIGHT / 2, GOAL.PLANE_Z - depth / 2);
    scene.add(side);
    registerNetPanel(side, idx++, sx, 0);
  }

  const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL.HALF_W * 2, depth, 22, 6), net);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, GOAL.HEIGHT, GOAL.PLANE_Z - depth / 2);
  scene.add(top);
  registerNetPanel(top, 3, 0, 0, 1);
}

// ---------------------------------------------------------------------------
// Net deformation
//
// Each panel is a little cloth: per-vertex displacement along the panel's own
// local Z, coupled to its grid neighbours so a strike drags the surrounding
// mesh in with it, and pinned at the edges where the netting is tied to the
// frame. The pocket the ball is physically resting in (physics.netPockets)
// drives the middle of it, so the stretch you see is the stretch it is in.
// ---------------------------------------------------------------------------
const netPanels = [];
const _local = new THREE.Vector3();
let netEnergy = 0;

const NET_TENSION = 620;     // pull toward the neighbours - the "connected" feel
const NET_ANCHOR = 26;       // weak pull back to flat; the pinned rim does the rest
const NET_DAMP = 5.5;
const NET_DRIVE = 2400;      // how hard the ball's pocket drags the mesh
const NET_RELAX_STEPS = 3;

function registerNetPanel(mesh, index, outX, outZ, outY) {
  mesh.updateWorldMatrix(true, false);
  const attr = mesh.geometry.attributes.position;
  const params = mesh.geometry.parameters;
  const cols = params.widthSegments + 1;
  const rows = params.heightSegments + 1;

  // Which way is "outward" in this panel's LOCAL z? Compare the mesh's local
  // +Z, taken into world space, against the direction the ball pushes.
  const zWorld = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  const out = new THREE.Vector3(outX || 0, outY || 0, outZ || 0);
  const sign = zWorld.dot(out) >= 0 ? 1 : -1;

  // Neighbour table, and a pinned rim: the netting is tied to the woodwork.
  const count = attr.count;
  const nbr = new Int32Array(count * 4).fill(-1);
  const pinned = new Uint8Array(count);
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = iy * cols + ix;
      if (ix === 0 || iy === 0 || ix === cols - 1 || iy === rows - 1) pinned[i] = 1;
      nbr[i * 4 + 0] = ix > 0 ? i - 1 : -1;
      nbr[i * 4 + 1] = ix < cols - 1 ? i + 1 : -1;
      nbr[i * 4 + 2] = iy > 0 ? i - cols : -1;
      nbr[i * 4 + 3] = iy < rows - 1 ? i + cols : -1;
    }
  }

  netPanels[index] = {
    mesh, attr, sign, cols, rows, nbr, pinned,
    baseZ: Float32Array.from({ length: count }, (_, i) => attr.getZ(i)),
    localX: Float32Array.from({ length: count }, (_, i) => attr.getX(i)),
    localY: Float32Array.from({ length: count }, (_, i) => attr.getY(i)),
    disp: new Float32Array(count),
    vel: new Float32Array(count),
    drive: new Float32Array(count),
  };
}

/**
 * Shapes each panel around the pocket physics says the ball is sitting in,
 * then relaxes the cloth. Called once per rendered frame.
 */
function updateNets(dt) {
  let live = false;

  for (let i = 0; i < netPanels.length; i++) {
    const panel = netPanels[i];
    if (!panel) continue;
    const pocket = netPockets[i];
    panel.drive.fill(0);

    if (pocket.touched && pocket.depth > 0.001) {
      live = true;
      _local.set(pocket.x, pocket.y, pocket.z);
      panel.mesh.worldToLocal(_local);

      // A deeper punch drags a wider area of mesh in with it.
      const radius = 0.55 + pocket.depth * 1.5;
      const r2 = radius * radius;
      for (let v = 0; v < panel.drive.length; v++) {
        if (panel.pinned[v]) continue;
        const dx = panel.localX[v] - _local.x;
        const dy = panel.localY[v] - _local.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = 1 - Math.sqrt(d2) / radius;
        panel.drive[v] = pocket.depth * f * f * panel.sign;
      }
    }
  }

  if (!live && netEnergy <= 0) return;
  netEnergy = live ? 0.9 : netEnergy - dt;

  const h = Math.min(dt, 1 / 60) / NET_RELAX_STEPS;
  for (let step = 0; step < NET_RELAX_STEPS; step++) {
    for (const panel of netPanels) {
      if (!panel) continue;
      const { disp, vel, drive, nbr, pinned } = panel;
      for (let v = 0; v < disp.length; v++) {
        if (pinned[v]) continue;

        let sum = 0, n = 0;
        for (let k = 0; k < 4; k++) {
          const j = nbr[v * 4 + k];
          if (j >= 0) { sum += disp[j]; n++; }
        }
        const lap = n ? sum / n - disp[v] : 0;

        const accel = NET_TENSION * lap
          - NET_ANCHOR * disp[v]
          - NET_DAMP * vel[v]
          + (drive[v] ? NET_DRIVE * (drive[v] - disp[v]) : 0);

        vel[v] += accel * h;
        disp[v] += vel[v] * h;
      }
    }
  }

  let stillMoving = false;
  for (const panel of netPanels) {
    if (!panel) continue;
    const { attr, baseZ, disp, vel } = panel;
    for (let v = 0; v < disp.length; v++) {
      if (Math.abs(disp[v]) > 2e-4 || Math.abs(vel[v]) > 2e-3) stillMoving = true;
      attr.setZ(v, baseZ[v] + disp[v]);
    }
    attr.needsUpdate = true;
  }
  if (!stillMoving && !live) {
    netEnergy = 0;
    for (const panel of netPanels) {
      if (!panel) continue;
      panel.disp.fill(0);
      panel.vel.fill(0);
    }
  }
}

/** Speckled crowd. Cheap, and it stops the sky reading as a black wall. */
function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0f1520';
  g.fillRect(0, 0, 256, 128);
  const tones = ['#212c3b', '#2b374a', '#1b2430'];
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256, y = Math.random() * 128;
    g.fillStyle = i % 23 === 0 ? '#45566d' : tones[i % 3];
    g.fillRect(x, y, 2.1, 2.1);
  }
  // Darken toward the top so the tier falls away into the night.
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(6,9,14,0.92)');
  grad.addColorStop(1, 'rgba(6,9,14,0.25)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildStands() {
  const crowd = crowdTexture();
  crowd.repeat.set(6, 2);
  const tier = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x18212d, roughness: 1 });

  // Behind the goal: a low wall, then a raked tier of spectators.
  const hoard = new THREE.Mesh(new THREE.BoxGeometry(86, 2.2, 2), wall);
  hoard.position.set(0, 1.1, GOAL.PLANE_Z - 8);
  scene.add(hoard);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(86, 15), tier);
  back.position.set(0, 8.4, GOAL.PLANE_Z - 10.5);
  back.rotation.x = -0.28;
  scene.add(back);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(86, 1.4, 9), wall);
  roof.position.set(0, 15.6, GOAL.PLANE_Z - 13.5);
  scene.add(roof);

  // Along the touchlines.
  const sideTex = crowdTexture();
  sideTex.repeat.set(7, 2);
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 1 });
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 74), wall);
    w.position.set(sx * 37, 1.1, GOAL.PLANE_Z + 24);
    scene.add(w);

    const s = new THREE.Mesh(new THREE.PlaneGeometry(74, 14), sideMat);
    s.position.set(sx * 39.5, 8, GOAL.PLANE_Z + 24);
    s.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    s.rotation.x = 0.26 * 0;
    scene.add(s);
  }

  const lamp = new THREE.MeshBasicMaterial({ color: 0xeaf2fb });
  for (const sx of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 0.4), lamp);
    pylon.position.set(sx * 20, 17.5, GOAL.PLANE_Z - 12);
    scene.add(pylon);
  }
}

function buildBall() {
  const b = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 20, 14),
    new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55 })
  );
  b.castShadow = true;
  b.position.set(BALL_START.x, BALL_START.y, BALL_START.z);
  scene.add(b);
  objects.ball = b;
}

function buildAimRig() {
  const accent = 0xd6ff3f;
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.8, 4), new THREE.MeshBasicMaterial({ color: accent }));
  arrow.rotation.x = Math.PI;
  arrow.position.set(0, GOAL.HEIGHT + 1.1, GOAL.PLANE_Z);
  arrow.visible = false;
  scene.add(arrow);
  objects.arrow = arrow;

  const guide = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, GOAL.HEIGHT + 0.8, 0)]),
    new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.45 }));
  guide.position.set(0, 0, GOAL.PLANE_Z);
  guide.visible = false;
  scene.add(guide);
  objects.guide = guide;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.26, 0.38, 20),
    new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide }));
  ring.position.set(0, 1.2, GOAL.PLANE_Z + 0.05);
  ring.visible = false;
  scene.add(ring);
  objects.elevation = ring;
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------
function poseRun(rig, phase, amp) {
  const s = Math.sin(phase), c = Math.cos(phase);
  rig.legs[0].hip.rotation.x = s * 0.72 * amp;
  rig.legs[1].hip.rotation.x = -s * 0.72 * amp;
  rig.legs[0].knee.rotation.x = -Math.max(0, c) * 1.0 * amp - 0.08;
  rig.legs[1].knee.rotation.x = -Math.max(0, -c) * 1.0 * amp - 0.08;
  rig.legs[0].hip.rotation.z = 0;
  rig.legs[1].hip.rotation.z = 0;
  rig.arms[0].shoulder.rotation.x = -s * 0.55 * amp;
  rig.arms[1].shoulder.rotation.x = s * 0.55 * amp;
  rig.arms[0].shoulder.rotation.z = -0.22;
  rig.arms[1].shoulder.rotation.z = 0.22;
  rig.arms[0].elbow.rotation.x = -0.6 * amp;
  rig.arms[1].elbow.rotation.x = -0.6 * amp;
  rig.body.rotation.x = 0.06 * amp;
  rig.body.rotation.z = 0;
  rig.body.position.y = Math.abs(s) * 0.035 * amp;
}

/**
 * Keeper dive. `dive` 0..1 scales commitment from a lean to a full stretch.
 * `high` 0..1 converts that dive from a low sideways sprawl into an upward
 * leap: he stays more upright, gets airborne, and his overhead arms reach the
 * top corner. Without it the top third of the goal was free, because a body
 * lying horizontal at hip height simply cannot get near it.
 */
/**
 * Keeper pose. `dive` 0..1 is how extended he is, `airY` is how far off the
 * turf he currently is - driven by a real ballistic arc in app.js, NOT baked
 * into the dive parameter. Deriving height from `dive` left him hanging in
 * mid-air for as long as the pose was held.
 */
export function setKeeper(x, dive, side, high, airY, ground) {
  const r = squad.keeper;
  const h = high || 0;
  const lean = dive * (1.35 - h * 0.55);
  r.root.position.x = x;
  // Mid-dive the pivot is the hips, so a horizontal body hangs at hip height.
  // Once he is down that is wrong - it leaves him lying flat in mid-air - so
  // drive the hip toward a lying height as he settles. Expressing it as a
  // target hip height rather than a fixed drop is what makes it work for both
  // a flat sprawl and a half-propped landing from a leap.
  const lay = (ground || 0) * Math.sin(lean) * dive;
  const hipY = RIG.HIP_Y - (RIG.HIP_Y - 0.25) * lay;
  r.body.position.y = hipY - RIG.HIP_Y * Math.cos(lean) + (airY || 0);
  r.body.rotation.z = -side * lean;
  r.body.rotation.x = 0;

  for (const arm of r.arms) {
    arm.shoulder.rotation.z = lerp(arm.sx * 0.34, arm.sx * Math.PI, dive);
    arm.shoulder.rotation.x = lerp(-0.12, 0, dive);
    arm.elbow.rotation.z = lerp(arm.sx * -0.25, 0, dive);
    arm.elbow.rotation.x = 0;
  }
  for (const leg of r.legs) {
    leg.hip.rotation.x = lerp(0.04, 0.42, dive);
    leg.hip.rotation.z = lerp(leg.sx * 0.03, -side * 0.22, dive);
    leg.knee.rotation.x = lerp(-0.08, -0.3, dive);
  }
}

/**
 * Defender block. `lunge` 0..1 slides him low across the shot line - the body
 * ends up near horizontal at roughly 0.4m, so a lofted ball clears him and a
 * drilled one does not.
 */
export function setBlocker(i, x, lunge, side, airY) {
  const r = blockerSets[i].rig;
  const lean = lunge * 1.3;
  r.root.position.x = x;
  r.body.position.y = RIG.HIP_Y * (1 - Math.cos(lean)) - lunge * 0.58 + (airY || 0);
  r.body.rotation.z = -side * lean;
  r.body.rotation.x = 0;

  for (const arm of r.arms) {
    arm.shoulder.rotation.z = lerp(arm.sx * 0.3, arm.sx * 1.1, lunge);
    arm.shoulder.rotation.x = 0;
    arm.elbow.rotation.z = 0;
    arm.elbow.rotation.x = lerp(-0.5, 0, lunge);
  }
  const lead = side > 0 ? r.legs[1] : r.legs[0];
  const trail = side > 0 ? r.legs[0] : r.legs[1];
  lead.hip.rotation.z = -side * lunge * 0.55;
  lead.hip.rotation.x = lerp(0.1, -0.15, lunge);
  lead.knee.rotation.x = lerp(-0.15, -0.05, lunge);
  trail.hip.rotation.z = -side * lunge * 0.1;
  trail.hip.rotation.x = lerp(0.1, 0.75, lunge);
  trail.knee.rotation.x = lerp(-0.15, -1.1, lunge);
}

/**
 * Striker kick. `t` 0..1: backswing through the first 30%, then the strike.
 * Contact is at t ~= 0.55, which is when app.js releases the ball.
 */
export function setStrikerSwing(t) {
  const r = squad.striker;
  const draw = Math.min(1, t / 0.3);
  const u = t <= 0.3 ? 0 : (t - 0.3) / 0.7;
  const through = Math.sin(Math.min(1, u) * Math.PI * 0.5);

  const kick = r.legs[1];
  const plant = r.legs[0];

  kick.hip.rotation.x = 0.95 * draw - 2.15 * through;
  kick.knee.rotation.x = -1.0 * draw + 0.95 * through;
  kick.hip.rotation.z = 0;
  plant.hip.rotation.x = -0.18 * draw;
  plant.knee.rotation.x = -0.12;
  plant.hip.rotation.z = 0;

  r.body.position.y = 0;
  r.body.rotation.z = 0;
  r.body.rotation.x = -0.05 * draw + 0.16 * through;
  r.arms[0].shoulder.rotation.x = -0.35 * draw + 0.9 * through;
  r.arms[1].shoulder.rotation.x = 0.3 * draw - 0.7 * through;
  r.arms[0].shoulder.rotation.z = -0.5 - 0.35 * through;
  r.arms[1].shoulder.rotation.z = 0.5 + 0.35 * through;
  r.arms[0].elbow.rotation.x = -0.3;
  r.arms[1].elbow.rotation.x = -0.3;
}

// ---------------------------------------------------------------------------
// AMBIENT: a match playing out behind the dimmer
// ---------------------------------------------------------------------------
const HOME_SPOTS = [
  { x: -14, z: -4 }, { x: 13, z: -6 }, { x: -3, z: 2 },
];
const FOE_SPOTS = [
  { x: -11, z: -14 }, { x: -3.5, z: -15.5 }, { x: 4, z: -15 }, { x: 11.5, z: -13 },
];

const ambient = {
  actors: [],
  ball: { x: 0, y: BALL_R, z: -6 },
  from: { x: 0, z: -6 },
  to: { x: 0, z: -6 },
  t: 1, dur: 1, holder: 0, wait: 0,
};

function initAmbient() {
  const add = (rig, home, team) => ambient.actors.push({
    rig, home, team,
    x: home.x, z: home.z, phase: Math.random() * 6.28, speed: 0, heading: 0,
  });

  add(squad.striker, { x: 0, z: -9 }, 'home');
  squad.mates.forEach((m, i) => add(m, HOME_SPOTS[i], 'home'));
  squad.foes.forEach((f, i) => add(f, FOE_SPOTS[i], 'away'));
  add(squad.ref, { x: 9, z: -2 }, 'ref');
}

function pickReceiver() {
  // Anyone but the current holder and the referee.
  let i = 0, guard = 0;
  do {
    i = (Math.random() * ambient.actors.length) | 0;
    guard++;
  } while ((i === ambient.holder || ambient.actors[i].team === 'ref') && guard < 30);
  return i;
}

/**
 * Walks every actor toward its target and plays the run cycle.
 * A `script` target (set during a build-up) overrides the loose shape-holding
 * and gets a higher top speed, because those players have somewhere to be.
 */
function moveActors(dt) {
  const a = ambient;
  for (let i = 0; i < a.actors.length; i++) {
    const p = a.actors[i];
    let tx, tz, top;

    if (p.script) {
      tx = p.script.x; tz = p.script.z; top = p.script.top;
    } else if (p.team === 'ref') {
      tx = a.ball.x + 7; tz = a.ball.z + 5; top = 3.4;
    } else if (i === a.holder && a.t >= 1) {
      tx = a.ball.x; tz = a.ball.z; top = 5.6;
    } else {
      const pull = p.team === 'away' ? 0.22 : 0.3;
      tx = p.home.x + (a.ball.x - p.home.x) * pull;
      tz = p.home.z + (a.ball.z - p.home.z) * pull;
      top = 5.6;
    }

    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const v = d > 0.3 ? Math.min(top, d * 2.6) : 0;
    if (v > 0) {
      p.x += (dx / d) * v * dt;
      p.z += (dz / d) * v * dt;
      p.heading = Math.atan2(dx, dz);
    }
    p.speed = lerp(p.speed, v, Math.min(1, dt * 6));
    p.phase += p.speed * dt * 2.1;

    p.rig.root.position.set(p.x, 0, p.z);
    p.rig.root.rotation.y = p.heading;
    poseRun(p.rig, p.phase, clamp(p.speed / 4.5, 0.12, 1));
  }
}

function updateAmbient(dt) {
  const a = ambient;

  // --- ball: a chain of passes ---------------------------------------------
  if (a.t >= 1) {
    a.wait -= dt;
    if (a.wait <= 0) {
      const next = pickReceiver();
      const rx = a.actors[next];
      a.from.x = a.ball.x; a.from.z = a.ball.z;
      a.to.x = rx.x; a.to.z = rx.z;
      const dist = Math.hypot(a.to.x - a.from.x, a.to.z - a.from.z);
      a.dur = clamp(dist / 17, 0.25, 1.3);
      a.t = 0;
      a.holder = next;
      a.wait = 0.35 + Math.random() * 0.8;
    }
  } else {
    a.t = Math.min(1, a.t + dt / a.dur);
    a.ball.x = lerp(a.from.x, a.to.x, a.t);
    a.ball.z = lerp(a.from.z, a.to.z, a.t);
    a.ball.y = BALL_R + Math.sin(a.t * Math.PI) * 0.9;
  }
  objects.ball.position.set(a.ball.x, a.ball.y, a.ball.z);
  objects.ball.rotation.x -= dt * 6;

  moveActors(dt);

  // Keeper shuffles his line, watching the ball.
  const kx = clamp(a.ball.x * 0.22, -3.2, 3.2);
  setKeeper(kx, 0, 1);
  squad.keeper.body.position.y = Math.sin(a.t * 7) * 0.015;
  squad.keeper.root.rotation.y = 0;
}

// ---------------------------------------------------------------------------
// BUILD-UP: the move that creates the chance
//
// The chance minute is known in advance, so the possession is choreographed
// backwards from it: a pass chain whose final leg lands on the striker's boot
// at the spot he will shoot from, at the exact moment the clock reaches the
// scheduled minute. Nothing teleports when the highlight then begins.
// ---------------------------------------------------------------------------
const buildup = {
  active: false, t: 0, dur: 1,
  origin: { x: 0, y: BALL_R, z: 0 },
  leg: 0, legT: 0, legDur: 1, legs: 3,
  from: { x: 0, z: 0 }, to: { x: 0, z: 0 },
  carriers: [],
  camCut: false,
};

/** Move an actor onto a path he can actually finish in the time available. */
function seedRun(actor, tx, tz, seconds, topSpeed) {
  const dx = tx - actor.x, dz = tz - actor.z;
  const d = Math.hypot(dx, dz);
  const reach = seconds * topSpeed;
  if (d > reach && d > 0.01) {
    // Too far to make it: slide him up his own approach line so the run still
    // reads as a run rather than a teleport to the spot.
    actor.x = tx - (dx / d) * reach;
    actor.z = tz - (dz / d) * reach;
  }
  actor.script = { x: tx, z: tz, top: topSpeed };
}

/**
 * Choreographs the move that ends in a chance at `origin`, `duration` seconds
 * from now. Defenders converge on their marking positions over the same window.
 */
export function startBuildup(origin, duration, blockerCount) {
  const a = ambient;
  buildup.active = true;
  buildup.t = 0;
  buildup.dur = Math.max(0.5, duration);
  buildup.camCut = false;
  buildup.origin.x = origin.x;
  buildup.origin.y = origin.y;
  buildup.origin.z = origin.z;

  const dx = 0 - origin.x, dz = GOAL.PLANE_Z - origin.z;
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len, dirZ = dz / len;       // toward the goal
  const perpX = -dirZ, perpZ = dirX;

  // The striker makes a run onto the spot, arriving as the ball does.
  const striker = a.actors[0];
  seedRun(striker, origin.x, origin.z, buildup.dur, 7.0);

  // Two team-mates work it forward from deeper and wider.
  buildup.carriers.length = 0;
  const mates = a.actors.filter((p) => p.team === 'home' && p !== striker);
  const side = Math.random() < 0.5 ? 1 : -1;
  const spots = [
    { x: origin.x - dirX * 17 + perpX * side * 7, z: origin.z - dirZ * 17 + perpZ * side * 7 },
    { x: origin.x - dirX * 8 + perpX * side * 5.5, z: origin.z - dirZ * 8 + perpZ * side * 5.5 },
  ];
  for (let i = 0; i < Math.min(2, mates.length); i++) {
    const c = mates[i];
    seedRun(c, spots[i].x, spots[i].z, buildup.dur * (0.3 + i * 0.25), 6.6);
    buildup.carriers.push(c);
  }

  // Defenders drop into the positions they will be blocking from.
  chance.blockerCount = Math.min(blockerCount, blockerSets.length);
  for (let i = 0; i < chance.blockerCount; i++) {
    const rig = blockerSets[i].rig;
    const actor = a.actors.find((p) => p.rig === rig);
    if (!actor) continue;
    const along = 5.5 + i * 3.0 + Math.random() * 1.6;
    seedRun(actor,
      origin.x + dirX * along + (Math.random() - 0.5) * 7.0,
      origin.z + dirZ * along, buildup.dur, 6.2);
  }

  // Ball: three legs, the last one arriving exactly on the beat.
  buildup.legs = buildup.carriers.length + 1;
  buildup.legDur = buildup.dur / buildup.legs;
  buildup.leg = 0;
  buildup.legT = 0;
  buildup.from.x = a.ball.x; buildup.from.z = a.ball.z;
  const first = buildup.carriers[0];
  buildup.to.x = first ? first.script.x : origin.x;
  buildup.to.z = first ? first.script.z : origin.z;
}

/** Advances the choreography. Returns true on the frame the chance begins. */
export function runBuildup(dt) {
  const a = ambient;
  buildup.t += dt;
  buildup.legT += dt;

  if (buildup.legT >= buildup.legDur && buildup.leg < buildup.legs - 1) {
    buildup.leg++;
    buildup.legT = 0;
    buildup.from.x = a.ball.x; buildup.from.z = a.ball.z;
    const next = buildup.carriers[buildup.leg];
    // The final leg always targets the shooting spot itself.
    buildup.to.x = next ? next.x : buildup.origin.x;
    buildup.to.z = next ? next.z : buildup.origin.z;
  }
  if (buildup.leg === buildup.legs - 1) {
    buildup.to.x = buildup.origin.x;      // keep the last pass honest
    buildup.to.z = buildup.origin.z;
  }

  const k = clamp(buildup.legT / buildup.legDur, 0, 1);
  a.ball.x = lerp(buildup.from.x, buildup.to.x, k);
  a.ball.z = lerp(buildup.from.z, buildup.to.z, k);
  a.ball.y = BALL_R + Math.sin(k * Math.PI) * 0.55;
  objects.ball.position.set(a.ball.x, a.ball.y, a.ball.z);
  objects.ball.rotation.x -= dt * 7;

  moveActors(dt);

  const kx = clamp(a.ball.x * 0.22, -3.2, 3.2);
  setKeeper(kx, 0, 1);

  // Ease the camera in over the back half of the move instead of cutting.
  const progress = buildup.t / buildup.dur;
  if (!buildup.camCut && progress > 0.4) {
    buildup.camCut = true;
    aimCameraAt(buildup.origin);
  }

  if (buildup.t >= buildup.dur) {
    buildup.active = false;
    for (const p of a.actors) p.script = null;
    return true;
  }
  return false;
}

export const buildupActive = () => buildup.active;

/** Shortest-way turn toward a heading, capped at `maxStep` radians. */
function turnToward(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + (d > maxStep ? maxStep : d < -maxStep ? -maxStep : d);
}

/**
 * Everyone not directly involved in the chance tracks the ball: they turn to
 * face it, and once it is live (`chase`) they break toward it the way players
 * follow a shot in for a rebound. Standing frozen and facing nowhere made the
 * whole box look like a diorama.
 */
export function watchBall(dt, chase) {
  const bx = objects.ball.position.x;
  const bz = objects.ball.position.z;

  for (const p of ambient.actors) {
    if (p.rig === squad.striker) continue;
    let involved = false;
    for (let i = 0; i < chance.blockerCount; i++) {
      if (blockerSets[i].rig === p.rig) { involved = true; break; }
    }
    if (involved) continue;

    const want = Math.atan2(bx - p.x, bz - p.z);
    p.heading = turnToward(p.heading, want, dt * 4.5);

    if (chase) {
      // Break toward the ball, but never past the goal line - they were
      // jogging straight into the net after it.
      const tx = bx;
      const tz = Math.max(bz, GOAL.PLANE_Z + 1.4);
      const dx = tx - p.x, dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      const keepOff = p.team === 'ref' ? 6.5 : 1.8;
      if (d > keepOff) {
        const top = p.team === 'ref' ? 3.2 : 5.4;
        const v = Math.min(top, (d - keepOff) * 1.6);
        p.x += (dx / d) * v * dt;
        p.z += (dz / d) * v * dt;
        p.speed = lerp(p.speed, v, Math.min(1, dt * 7));
      } else {
        p.speed = lerp(p.speed, 0, Math.min(1, dt * 7));
      }
    } else {
      p.speed = lerp(p.speed, 0, Math.min(1, dt * 4));
    }

    // Always tick the run cycle a little so nobody is a statue.
    p.phase += Math.max(p.speed, 0.8) * dt * 2.1;
  }

  separate(dt);

  for (const p of ambient.actors) {
    if (p.rig === squad.striker) continue;
    let involved = false;
    for (let i = 0; i < chance.blockerCount; i++) {
      if (blockerSets[i].rig === p.rig) { involved = true; break; }
    }
    if (involved) continue;
    p.rig.root.position.set(p.x, 0, p.z);
    p.rig.root.rotation.y = p.heading;
    poseRun(p.rig, p.phase, clamp(p.speed / 4.5, 0.17, 1));
  }
}

/**
 * Keeps chasers from stacking into one another. Everyone converging on the
 * same ball ends up occupying the same square metre otherwise, which reads as
 * one four-headed player.
 */
const MIN_SEP = 1.15;
function separate(dt) {
  const a = ambient.actors;
  const push = Math.min(1, dt * 9);
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const dx = a[j].x - a[i].x, dz = a[j].z - a[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= MIN_SEP * MIN_SEP || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const shove = (MIN_SEP - d) * 0.5 * push;
      const nx = dx / d, nz = dz / d;
      a[i].x -= nx * shove; a[i].z -= nz * shove;
      a[j].x += nx * shove; a[j].z += nz * shove;
    }
  }

  // ...and nobody stands inside the striker either.
  const s = squad.striker.root.position;
  for (const p of a) {
    if (p.rig === squad.striker) continue;
    const dx = p.x - s.x, dz = p.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d >= MIN_SEP || d < 1e-6) continue;
    p.x += (dx / d) * (MIN_SEP - d) * push;
    p.z += (dz / d) * (MIN_SEP - d) * push;
  }
}

/**
 * Turns the keeper toward the ball. Only partially: his dive leans along
 * world X, so squaring him fully to a wide chance would tip that dive out of
 * the plane his lateral tracking and collision capsules assume.
 */
export function faceKeeper(dt, blend) {
  const k = squad.keeper;
  const want = Math.atan2(
    objects.ball.position.x - k.root.position.x,
    objects.ball.position.z - k.root.position.z) * blend;
  k.root.rotation.y = turnToward(k.root.rotation.y, want, dt * 5);
}

/** The striker follows his shot in, rather than admiring it from the spot. */
export function strikerFollowThrough(dt, speed) {
  const s = squad.striker;
  if (s.root.position.z <= GOAL.PLANE_Z + 2.0) return;   // pull up short of the line
  s.root.position.x += chance.dirX * speed * dt;
  s.root.position.z += chance.dirZ * speed * dt;
}

// ---------------------------------------------------------------------------
// CHANCE: freeze the match and set up a shooting scenario
// ---------------------------------------------------------------------------
export const chance = {
  origin: { x: 0, y: BALL_R, z: 0 },
  dirX: 0, dirZ: -1,      // unit vector from the spot toward the goal centre
  perpX: 1, perpZ: 0,
  blockerCount: 0,
  blockers: [],           // {z, baseX, side}
};

/** Camera: behind the striker, offset so he never masks the goalmouth. */
function aimCameraAt(origin) {
  const dx = 0 - origin.x, dz = GOAL.PLANE_Z - origin.z;
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len, dirZ = dz / len;
  _camHome.set(
    origin.x - dirX * 9.2 - dirZ * 3.1, 5.0,
    origin.z - dirZ * 9.2 + dirX * 3.1);
  // Aim low: it tilts the camera down, which lifts the ball clear of the
  // ticker and stops the shot being framed against empty stand.
  _camTargetWant.set(origin.x * 0.16, 1.25, GOAL.PLANE_Z + 1.5);
}

/**
 * Puts the squad into a shooting scenario at `origin`.
 *
 * `soft` is the normal path: a build-up has just delivered the ball, so
 * everybody is already where they belong and we only read their positions.
 * The hard path teleports the scenario into place, and is used when a chance
 * appears with no move behind it (a Super Sub injection).
 */
export function setupChance(origin, blockerCount, soft) {
  chance.origin.x = origin.x;
  chance.origin.y = origin.y;
  chance.origin.z = origin.z;

  const dx = 0 - origin.x, dz = GOAL.PLANE_Z - origin.z;
  const len = Math.hypot(dx, dz) || 1;
  chance.dirX = dx / len; chance.dirZ = dz / len;
  chance.perpX = -chance.dirZ; chance.perpZ = chance.dirX;

  objects.ball.position.set(origin.x, origin.y, origin.z);
  chance.blockerCount = Math.min(blockerCount, blockerSets.length);
  chance.blockers.length = 0;

  const s = squad.striker;
  if (!soft) {
    s.root.position.set(
      origin.x - chance.dirX * 0.5 - chance.perpX * 0.55, 0,
      origin.z - chance.dirZ * 0.5 - chance.perpZ * 0.55);

    for (let i = 0; i < chance.blockerCount; i++) {
      const along = 5.5 + i * 3.0 + Math.random() * 1.6;
      blockerSets[i].rig.root.position.set(
        origin.x + chance.dirX * along + (Math.random() - 0.5) * 7.0, 0,
        origin.z + chance.dirZ * along);
    }

    let spare = 0;
    for (const p of ambient.actors) {
      if (p.rig === squad.striker) continue;
      if (blockerSets.slice(0, chance.blockerCount).some((b) => b.rig === p.rig)) continue;
      const side = spare % 2 ? 1 : -1;
      p.x = origin.x + chance.perpX * side * (5 + spare * 1.7) + chance.dirX * (spare * 1.2);
      p.z = origin.z + chance.perpZ * side * (5 + spare * 1.7) + chance.dirZ * (spare * 1.2 + 1);
      p.z = clamp(p.z, GOAL.PLANE_Z + 1.5, GOAL.PLANE_Z + 46);
      p.speed = 0;
      p.rig.root.position.set(p.x, 0, p.z);
      p.rig.root.rotation.y = Math.atan2(origin.x - p.x, origin.z - p.z);
      poseRun(p.rig, 0, 0.12);
      spare++;
    }
    setKeeper(0, 0, 1);
  }

  // The striker plants beside the ball and squares up to goal either way.
  placeStrikerForKick(Math.atan2(chance.dirX, -chance.dirZ));
  const strikerActor = ambient.actors[0];
  strikerActor.x = s.root.position.x;
  strikerActor.z = s.root.position.z;
  strikerActor.heading = s.root.rotation.y;
  strikerActor.speed = 0;
  setStrikerSwing(0);

  // Blockers hold wherever they ended up; their live spot is the marking spot.
  for (let i = 0; i < chance.blockerCount; i++) {
    const rig = blockerSets[i].rig;
    rig.root.rotation.y = Math.atan2(-chance.dirX, -chance.dirZ);
    chance.blockers.push({ z: rig.root.position.z, baseX: rig.root.position.x, side: 1 });
    setBlocker(i, rig.root.position.x, 0, 1);

    // Keep the ambient actor in step, or he snaps back when play resumes.
    const actor = ambient.actors.find((p) => p.rig === rig);
    if (actor) { actor.x = rig.root.position.x; actor.z = rig.root.position.z; actor.speed = 0; }
  }

  aimCameraAt(origin);
}

/** Restores the wide broadcast framing used while the match simulates. */
export function frameAmbient() {
  _camHome.set(0, 13.5, 11);
  _camTargetWant.set(0, 0, GOAL.PLANE_Z + 7);
  objects.arrow.visible = objects.guide.visible = objects.elevation.visible = false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function init(canvas) {
  if (started) return;
  started = true;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(CLEAR);
  scene.fog = new THREE.Fog(CLEAR, 60, 150);

  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  camera.position.copy(_camHome);
  camera.lookAt(_camTarget);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a3d24, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(9, 22, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  const sc = key.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 14; sc.bottom = -34; sc.near = 1; sc.far = 80;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9fd0ff, 0.6);
  rim.position.set(-12, 8, -26);
  scene.add(rim);

  buildField();
  buildGoal();
  buildStands();
  buildSquad();
  buildBall();
  buildAimRig();

  keeperSet = makeCapsuleSet(squad.keeper);
  for (let i = 0; i < 2; i++) blockerSets.push(makeCapsuleSet(squad.foes[i]));

  initAmbient();
  frameAmbient();

  clock = new THREE.Clock();
  addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(tick);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function tick() {
  // Single delta source: every consumer scales its displacement against this.
  const dt = Math.min(clock.getDelta(), 0.05);
  if (frameCb) frameCb(dt);
  updateNets(dt);

  _camWant.copy(_camHome);
  if (shakeAmp > 0.001) {
    shakeAmp = Math.max(0, shakeAmp - dt * 2.6);
    _camWant.x += (Math.random() - 0.5) * shakeAmp;
    _camWant.y += (Math.random() - 0.5) * shakeAmp;
  }
  camera.position.lerp(_camWant, Math.min(1, dt * 3.2));
  _camTarget.lerp(_camTargetWant, Math.min(1, dt * 3.2));
  camera.lookAt(_camTarget);

  renderer.render(scene, camera);
}

export const onFrame = (cb) => { frameCb = cb; };
export const shake = (amp) => { shakeAmp = Math.max(shakeAmp, amp); };
export const runAmbient = (dt) => updateAmbient(dt);

/**
 * Squares the striker up to the shot and stands him so his KICKING BOOT
 * arrives on the ball, rather than swiping past the side of it.
 *
 * `theta` is the launch angle, where the ball leaves along (sin t, -cos t),
 * so the facing that matches it is atan2(sin t, -cos t) - not `theta` itself,
 * and not the goal-centre heading the rig was previously being given.
 */
const FOOT_SIDE = 0.105;   // kicking hip offset, local +X
const FOOT_FWD = 0.40;     // how far in front of him the boot is at contact

export function placeStrikerForKick(theta) {
  const face = Math.atan2(Math.sin(theta), -Math.cos(theta));
  const fx = Math.sin(face), fz = Math.cos(face);     // his forward, in world
  const rx = Math.cos(face), rz = -Math.sin(face);    // his right, in world

  const s = squad.striker;
  s.root.rotation.y = face;
  s.root.position.set(
    objects.ball.position.x - rx * FOOT_SIDE - fx * FOOT_FWD, 0,
    objects.ball.position.z - rz * FOOT_SIDE - fz * FOOT_FWD);
}

/** Horizontal sweep: project the aim angle onto the goal plane. */
export function setAim(theta) {
  const range = chance.origin.z - GOAL.PLANE_Z;
  const x = chance.origin.x + Math.tan(theta) * range;
  objects.arrow.position.x = x;
  objects.guide.position.x = x;
  objects.elevation.position.x = x;
}

export function setElevation(y) { objects.elevation.position.y = y; }

export function showAimRig(arrow, guide) {
  objects.arrow.visible = arrow;
  objects.guide.visible = guide;
  objects.elevation.visible = guide;
}

export function setBall(p) { objects.ball.position.set(p.x, p.y, p.z); }

export function spinBall(vx, vz, dt) {
  objects.ball.rotation.x -= vz * dt * 0.9;
  objects.ball.rotation.z -= vx * dt * 0.9;
}

/**
 * Debug aid: lines the whole squad up facing the camera so the appearance
 * variety can be eyeballed. Not called by the game.
 */
export function parade(offset, count) {
  frameCb = null;                    // stop the ambient sim fighting the lineup
  const all = [squad.keeper, squad.striker, ...squad.mates, ...squad.foes, squad.ref];
  const from = offset || 0;
  const n = count || all.length;
  const shown = all.slice(from, from + n);

  for (const rig of all) rig.root.position.set(0, -50, 0);
  shown.forEach((rig, i) => {
    const x = (i - (shown.length - 1) / 2) * (n > 6 ? 1.75 : 1.15);
    rig.root.position.set(x, 0, GOAL.PLANE_Z + 9);
    rig.root.rotation.y = 0;           // rigs face +Z by default
    poseRun(rig, 0, 0.1);
  });

  const back = n > 6 ? 26 : 6.8;
  _camHome.set(0, 1.6, GOAL.PLANE_Z + 9 + back);
  _camTargetWant.set(0, 1.55, GOAL.PLANE_Z + 9);
  camera.position.copy(_camHome);
  _camTarget.copy(_camTargetWant);
}

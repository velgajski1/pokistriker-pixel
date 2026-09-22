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
import { GOAL, PITCH, BALL_START, BALL_R, NET, netPockets, releaseNetPockets,
  AD_BOARDS, BOARD_HEIGHT, BOARD_THICKNESS } from './physics.js';

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
export { renderer, scene, camera };
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
  { skin: SKIN.light, hair: HAIR.brown,      style: 'sidepart', height: 1.02,  build: 1.0,  beard: 0,   brow: 1 },
  { skin: SKIN.dark,  hair: HAIR.black,      style: 'crew',     height: 1.01,  build: 1.03, beard: 0.45, brow: 1 },
  { skin: SKIN.fair,  hair: HAIR.darkBlond,  style: 'swept',    height: 1.04,  build: 0.98, beard: 0,   brow: 1 },
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
  if (look.moustache) {
    const moustache = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.075, 4, 8), matHair);
    moustache.rotation.z = Math.PI / 2;
    moustache.position.set(0, y - 0.034, 0.121);
    body.add(moustache);
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
  g.strokeStyle = '#17202a';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.strokeText(String(n), 64, 68);
  g.fillText(String(n), 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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

  const face = new THREE.Group();
  body.add(face);
  buildHair(look.style, matHair, face);
  if (!lite) buildFace(face, look, matHair);   // only the players seen close up

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

  return { root, body, arms, legs, hipMarker, neckMarker, scale: look.height,
    number,
    appearance: { face, torso, shoulders, skin: matSkin, hand: matHand },
    kitMaterials: { kit: matKit, shorts: matShorts, socks: matSocks },
    look, kit: { kit, shorts, socks, boots, gloves }, avatar: null };
}

// ---------------------------------------------------------------------------
// Squad
// ---------------------------------------------------------------------------
const KIT_HOME = { kit: 0x2f6bff, shorts: 0xf4f7fa, socks: 0x2f6bff, boots: 0x101418 };
const KIT_AWAY = { kit: 0xe23b4e, shorts: 0x1b1f27, socks: 0xe23b4e, boots: 0x0f1116 };
const KIT_REF  = { kit: 0x14181f, shorts: 0x14181f, socks: 0x14181f, boots: 0x0a0c10 };
const KIT_KEEP = { kit: 0xff8a2b, shorts: 0x14202e, socks: 0x1b2836, boots: 0x0c1017, gloves: 0xe8f0ff };

function recolourKit(rig, kit) {
  for (const region of ['kit', 'shorts', 'socks']) {
    rig.kit[region] = kit[region];
    rig.kitMaterials[region].color.setHex(kit[region]);
  }
  rig.avatar?.model.traverse(node => {
    if (node.isMesh && Object.hasOwn(kit, node.material.name)) {
      node.material.color.setHex(kit[node.material.name]);
    }
  });
}

/** Match-only recolouring: reuse all rig materials and crowd instance buffers. */
export function setMatchColors(theme, seed) {
  for (const rig of squad.foes) recolourKit(rig, theme);
  recolourKit(squad.keeper, theme.keeper);
  const tint = new THREE.Color();
  for (const mesh of crowd.batches) {
    const part = mesh.userData.part;
    if (part !== 0 && part !== 5 && part !== 6) continue;
    for (let i = 0; i < mesh.count; i++) {
      const hash = (Math.imul(i + 1 + mesh.userData.pose * 917, 1664525) + seed) >>> 0;
      const awayFan = hash % 10 < 7;
      const primary = awayFan ? theme.kit : KIT_HOME.kit;
      const accent = awayFan ? theme.accent : KIT_HOME.shorts;
      const shirt = hash % 17 === 0 ? 0xd9d5c9 : hash % 13 === 0 ? 0x30343a
        : hash % 5 === 0 ? accent : primary;
      tint.setHex(part === 0 ? shirt : part === 5 ? primary : accent);
      if (part === 0) tint.multiplyScalar(.78 + ((hash >>> 8) % 23) / 100);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceColor.needsUpdate = true;
  }
  if (supporterFlagMap) {
    const canvas = supporterFlagMap.image, paint = canvas.getContext('2d');
    for (let i = 0; i < 8; i++) {
      paint.fillStyle = '#' + (i % 2 ? theme.accent : theme.kit).toString(16).padStart(6, '0');
      paint.fillRect(i * 16, 0, 16, 64);
    }
    supporterFlagMap.needsUpdate = true;
  }
}

const squad = { keeper: null, homeKeeper: null, striker: null, mates: [], foes: [], ref: null };

// Speed thresholds in metres/second. Finish the run blend before sprinting.
const RUN_FULL_SPEED = 3.5;
const MIN_GAIT_SPEED = 0.02;
const INSTANT_TURN_ANGLE = Math.PI / 9;
const TURN_RATE = Math.PI / 0.25;
const MOVE_ALIGNMENT = Math.cos(INSTANT_TURN_ANGLE);
const KICK_FADE = 0.15;
const STRIKER_SPEED_RESPONSE = 18;
let captain = null;
export const players = [];
const GAITS = ['walk', 'quick_walk', 'run', 'run_alt'];
export const CELEBRATIONS = ['celebrate_backflip', 'celebrate_backflip_hooks', 'celebrate_dance', 'celebrate_heart'];
export const REACTIONS = ['react_stomp', 'react_shout', 'react_confused', 'react_walk_sad'];
export const reactions = { keeper: null, shooter: null };
export const defenderReactions = { active: false, tracks: [] };
export const celebration = { name: null, time: 0, duration: 0, phase: null,
  runTime: 0, runDuration: 1.5, startX: 0, targetX: 0 };
const ANIMATIONS = ['idle', ...GAITS, 'kick', ...CELEBRATIONS, ...REACTIONS, 'turn_idle_left', 'turn_idle_right',
  'turn_walk_left', 'turn_walk_right', 'dive_left', 'dive_right',
  'keeper_idle', 'alert', 'slide_left', 'slide_right'];
const CAPTAIN_BIND_SCALE = 1.85 / 1.7; // Blender bakes this into mesh bind coordinates.
const BIPED = { hips: 'Hips', neck: 'Neck', head: 'Head',
  upperarm_L: 'LeftArm', forearm_L: 'LeftForeArm', hand_L: 'LeftHand',
  upperarm_R: 'RightArm', forearm_R: 'RightForeArm', hand_R: 'RightHand',
  thigh_L: 'LeftUpLeg', shin_L: 'LeftLeg', foot_L: 'LeftFoot', toe_L: 'LeftToeBase',
  thigh_R: 'RightUpLeg', shin_R: 'RightLeg', foot_R: 'RightFoot', toe_R: 'RightToeBase' };
const bipedBone = (model, name) => model.getObjectByName('mixamorig' + BIPED[name]);
const _poseQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _sourcePoseQ = new THREE.Quaternion();
const _downQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
let strikerLoad = null;
let captainSpeed = 0;
let kickTime = -1;
let launchPending = false;
const _instep = new THREE.Vector3();
const _toe = new THREE.Vector3();
export const lastLaunch = { instep: [0, 0, 0], ball: [0, 0, 0] };
export const striker = {
  model: 'procedural', mixer: null, root: null,
  bone: name => captain ? bipedBone(captain.model, name) : null,
  weights: () => captain ? Object.fromEntries(Object.entries(captain.actions)
    .map(([name, action]) => [name, action.getEffectiveWeight()])) : {},
  get speed() { return captainSpeed; },
};

export function loadStriker() {
  if (!strikerLoad) strikerLoad = loadCaptain();
  return strikerLoad;
}

async function loadCaptain() {
  let timer;
  try {
    const [gltf, data, skeletonUtils] = await Promise.race([
      Promise.all([import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
        new GLTFLoader().loadAsync('assets/squad.glb')),
        fetch('assets/squad.json').then(response => {
          if (!response.ok) throw new Error('Striker sidecar unavailable');
          return response.json();
        }), import('three/addons/utils/SkeletonUtils.js')]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Striker load timed out')), 10000); }),
    ]);
    const model = gltf.scene;
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const name of ANIMATIONS) {
      const clip = gltf.animations.find(clip => clip.name === name);
      if (!clip || !data.clips[name]) throw new Error('Missing striker clip: ' + name);
      actions[name] = mixer.clipAction(clip).play();
      actions[name].setEffectiveWeight(0);
      actions[name].paused = true;
    }
    const toe = bipedBone(model, 'toe_L');
    if (!toe || !bipedBone(model, 'foot_R') || !bipedBone(model, 'toe_R')) throw new Error('Missing striker bones');
    // Measure the same left-toe minimum in both cycles, rather than assuming
    // frame zero represents the same footfall. Sampling is boot-only.
    const offsets = {};
    for (const name of GAITS) {
      const action = actions[name];
      action.setEffectiveWeight(1);
      let lowest = Infinity;
      for (let i = 0; i < 512; i++) {
        action.time = i / 512 * action.getClip().duration;
        mixer.update(0);
        toe.getWorldPosition(_toe);
        if (_toe.y < lowest) { lowest = _toe.y; offsets[name] = i / 512; }
      }
      action.setEffectiveWeight(0);
    }
    const rigs = [squad.keeper, squad.striker, ...squad.mates, ...squad.foes, squad.homeKeeper, squad.ref];
    const template = skeletonUtils.clone(gltf.scene);
    // Clone before colouring: each skeleton and material is independent,
    // while geometry and animation clips are shared by the entire squad.
    for (const rig of rigs) {
      const avatarModel = rig === squad.striker ? model : skeletonUtils.clone(template);
      colourCaptain(avatarModel, rig);
      addShirtNumber(avatarModel, rig.number);
      if (rig !== squad.striker) attachCaptain(rig, avatarModel, gltf.animations, data, offsets);
      if (rig.avatar) rig.avatar.idleName = rig === squad.keeper || rig === squad.homeKeeper
        ? 'keeper_idle' : squad.foes.includes(rig) ? 'alert' : 'idle';
      players.push({ rig, root: rig.root, model: avatarModel, look: rig.look,
        motionX: rig.root.position.x, motionZ: rig.root.position.z,
        team: rig === squad.ref ? 'ref' : rig === squad.keeper || squad.foes.includes(rig) ? 'away' : 'home',
        role: rig === squad.keeper || rig === squad.homeKeeper ? 'keeper'
          : rig === squad.striker ? 'striker' : rig === squad.ref ? 'referee' : 'outfield' });
    }
    squad.striker.body.visible = false;
    squad.striker.root.scale.setScalar(1);
    squad.striker.root.add(model);
    captain = { model, mixer, actions, data, offsets, passTime: -1, turnTime: -1, turnName: '',
      turnRate: 0, phase: 0, runName: 'run', scale: 1, moveBlend: 0, moveBones: [], movePose: [] };
    model.traverse(node => {
      if (node.isBone) { captain.moveBones.push(node); captain.movePose.push(node.quaternion.clone()); }
    });
    striker.model = 'captain';
    striker.mixer = mixer;
    keeperSet = makeCapsuleSet(squad.keeper);
    for (let i = 0; i < blockerSets.length; i++) blockerSets[i] = makeCapsuleSet(squad.foes[i], false);
    cachePausePoses();
    for (const rig of squad.foes) {
      const track = { rig, actor: ambient.actors.find(p => p.rig === rig), time: 0,
        sad: false, speed: 0, heading: 0, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
      rig.avatar.goalWalk = track;
      defenderReactions.tracks.push(track);
    }
    for (const role of ['keeper', 'shooter']) {
      const rig = role === 'keeper' ? squad.keeper : squad.striker;
      const avatar = role === 'keeper' ? rig.avatar : captain;
      const bones = [], poses = [];
      avatar.model.traverse(node => { if (node.isBone) { bones.push(node); poses.push(node.quaternion.clone()); } });
      reactions[role] = { rig, avatar, bones, poses, name: null, time: 0, duration: 0,
        position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    }
  } catch (error) {
    console.warn('Captain unavailable; using procedural striker.', error);
  } finally {
    clearTimeout(timer);
  }
}

let shirtNumberGeometry;
function addShirtNumber(model, number) {
  if (number == null) return;
  let shirt;
  model.traverse(node => { if (node.isSkinnedMesh && node.material.name === 'kit') shirt = node; });
  if (!shirt) return;
  if (!shirtNumberGeometry) {
    // Copy the back's skin weights so the print bends with the actual shirt.
    const geometry = shirt.geometry.clone();
    const position = geometry.attributes.position, normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const scale = CAPTAIN_BIND_SCALE;
    const indices = [];
    for (let i = 0; i < geometry.index.count; i += 3) {
      const a = geometry.index.getX(i), b = geometry.index.getX(i + 1), c = geometry.index.getX(i + 2);
      const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
      const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
      if (Math.abs(x) < .24 * scale && y > 1.0 * scale && y < 1.5 * scale
        && normal.getZ(a) + normal.getZ(b) + normal.getZ(c) < -1) indices.push(a, b, c);
    }
    geometry.setIndex(indices);
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, .5 - position.getX(i) / (.32 * scale), (position.getY(i) / scale - 1.04) / .39);
      position.setXYZ(i, position.getX(i) + normal.getX(i) * .002,
        position.getY(i) + normal.getY(i) * .002, position.getZ(i) + normal.getZ(i) * .002);
    }
    shirtNumberGeometry = geometry;
  }
  const material = new THREE.MeshStandardMaterial({ map: numberTexture(number),
    roughness: .85, transparent: true, alphaTest: .1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.name = 'shirt-number';
  const print = new THREE.SkinnedMesh(shirtNumberGeometry, material);
  print.name = 'shirt-number';
  print.userData.number = number;
  print.frustumCulled = false;
  print.bind(shirt.skeleton, shirt.bindMatrix);
  shirt.add(print);
}

// Bind-space shading follows the animated skin without floating face overlays.
// Both imported head primitives use the same continuous hairline and colours.
function shadeCaptainFace(material, look) {
  material.roughness = .86;
  material.customProgramCacheKey = () => 'captain-face-v2';
  material.onBeforeCompile = shader => {
    shader.uniforms.faceSkin = { value: new THREE.Color(look.skin) };
    shader.uniforms.faceHair = { value: new THREE.Color(look.hair) };
    shader.uniforms.faceStyle = { value: ['bald', 'buzz', 'crew', 'sidepart', 'swept', 'floppy', 'headband'].indexOf(look.style) };
    shader.uniforms.faceBeard = { value: look.beard >= .4 ? Math.min(.48, look.beard * .55) : 0 };
    shader.uniforms.faceMoustache = { value: look.moustache || 0 };
    shader.vertexShader = 'varying vec3 faceBind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nfaceBind = position / ' + CAPTAIN_BIND_SCALE.toFixed(8) + ';');
    shader.fragmentShader = `varying vec3 faceBind;
      uniform vec3 faceSkin, faceHair;
      uniform float faceStyle, faceBeard, faceMoustache;
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (faceBind.y > 1.405 && abs(faceBind.x) < .14) {
        vec3 p = faceBind;
        float front = smoothstep(-.035, .065, p.z);
        float hairline = mix(1.505, 1.61, front);
        hairline -= .024 * smoothstep(.045, .085, abs(p.x)) * front;
        if (faceStyle == 3.0) hairline += .012 * sin(p.x * 28.0) * front;
        if (faceStyle == 4.0 || faceStyle == 5.0) hairline -= .016 * front;
        float edge = max(.002, fwidth(p.y) * 1.2);
        float hair = smoothstep(hairline - edge, hairline + edge, p.y);
        if (faceStyle == 0.0) hair = 0.0;
        if (faceStyle == 1.0) hair *= .68;
        float grain = sin(p.x * 1700.0) * sin(p.y * 1600.0 + p.z * 900.0);
        grain *= 1.0 - smoothstep(.0005, .003, fwidth(p.y));
        vec3 hairColour = faceHair * (1.0 + grain * .055);
        if (faceStyle == 3.0) {
          float part = 1.0 - smoothstep(.001, .0035, abs(p.x - .025 - p.z * .15));
          hairColour = mix(hairColour, faceSkin * .65, part * .65);
        }
        float jaw = smoothstep(1.443, 1.46, p.y) * (1.0 - smoothstep(1.505, 1.53, p.y));
        float beard = jaw * smoothstep(.005, .05, p.z) * faceBeard;
        vec3 skinColour = mix(faceSkin, faceHair, beard * (.88 + grain * .12));
        diffuseColor.rgb = mix(skinColour, hairColour, hair);
        float moustache = (1.0 - smoothstep(.035, .047, abs(p.x)))
          * (1.0 - smoothstep(.005, .011, abs(p.y - 1.535 + abs(p.x) * .12))) * front;
        diffuseColor.rgb = mix(diffuseColor.rgb, faceHair, moustache * faceMoustache);
        float eyeX = abs(p.x) - .033;
        float eye = 1.0 - smoothstep(.8, 1.2, length(vec2(eyeX / .012, (p.y - 1.576) / .0035)));
        eye *= smoothstep(.065, .08, p.z);
        float iris = 1.0 - smoothstep(.0025, .0045, abs(eyeX));
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(faceSkin * 1.08, vec3(.025), iris), eye * .8);
        float brow = (1.0 - smoothstep(.011, .016, abs(eyeX)))
          * (1.0 - smoothstep(.0015, .004, abs(p.y - 1.59 + eyeX * .10))) * front;
        diffuseColor.rgb = mix(diffuseColor.rgb, faceHair, brow * .65);
        if (faceStyle == 6.0) {
          float band = 1.0 - smoothstep(.004, .006, abs(p.y - 1.632 + p.z * .06));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.045), band);
        }
      }`);
  };
}

const captainHairShapes = new Map();
function captainHairGeometry(style, headIndex, career = false) {
  const key = style + ':' + headIndex + ':' + career;
  if (captainHairShapes.has(key)) return captainHairShapes.get(key);
  const positions = [], indices = [], joints = [], weights = [];
  const rings = 20, segments = 40;
  const volume = style === 'afro' ? .033 : style === 'curls' ? (career ? .03 : .016)
    : style === 'floppy' || style === 'swept' ? (career ? .025 : .014) : style === 'bald' || style === 'buzz' ? 0 : .006;
  for (let row = 0; row <= rings; row++) {
    for (let col = 0; col <= segments; col++) {
      const phi = col / segments * Math.PI * 2;
      const facing = Math.cos(phi);
      const edge = career ? 1.575 + facing * (facing > 0 ? .05 : .065)
        : 1.585 + facing * (facing > 0 ? .023 : .065);
      const height = career ? .105 : .108;
      const theta = row / rings * Math.acos((edge - 1.575) / height);
      const top = Math.max(0, Math.cos(theta));
      const curls = style === 'afro' || style === 'curls'
        ? (career ? .006 : .003) * Math.sin(phi * 12) * Math.sin(theta * 18) * Math.sin(theta) : 0;
      const radius = volume * top + curls;
      const sweep = style === 'sidepart' || style === 'swept' ? .012 * top * top : 0;
      positions.push((Math.sin(phi) * Math.sin(theta) * ((career ? .093 : .096) + radius) + sweep) * CAPTAIN_BIND_SCALE,
        (1.575 + Math.cos(theta) * height + volume * top * top + curls) * CAPTAIN_BIND_SCALE,
        (Math.cos(phi) * Math.sin(theta) * ((career ? .1 : .104) + radius) - (career ? .005 : 0)) * CAPTAIN_BIND_SCALE);
      joints.push(headIndex, 0, 0, 0); weights.push(1, 0, 0, 0);
      if (row < rings && col < segments) {
        const a = row * (segments + 1) + col, b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  captainHairShapes.set(key, geometry);
  return geometry;
}

function colourCaptain(model, rig) {
  let scalp = null;
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.frustumCulled = false;
    node.material = node.material.clone();
    const region = node.material.name;
    if (region === 'skin' || region === 'hair') shadeCaptainFace(node.material, rig.look);
    node.material.color.setHex(region === 'skin' ? rig.look.skin
      : region === 'hair' ? (rig.look.style === 'bald' ? rig.look.skin : rig.look.hair)
        : region === 'gloves' ? rig.kit.gloves || rig.look.skin : rig.kit[region] ?? 0xffffff);
    if (region === 'hair') {
      scalp = node;
      const headIndex = node.skeleton.bones.indexOf(bipedBone(model, 'head'));
      node.geometry = captainHairGeometry(rig.look.style, headIndex);
    }
  });
  if (scalp && ['headband', 'ponytail', 'bun'].includes(rig.look.style)) {
    buildCaptainAccessory(model, scalp, rig.look);
  }
}

function buildCaptainAccessory(model, scalp, look) {
  const head = bipedBone(model, 'head');
  const index = scalp.skeleton.bones.indexOf(head);
  const hair = new THREE.Group();
  hair.name = 'captain-hair-accessory';
  const material = new THREE.MeshStandardMaterial({ color: look.hair, roughness: .9 });
  const bun = look.style === 'bun';
  const tail = new THREE.Mesh(bun ? new THREE.SphereGeometry(.05, 10, 8)
    : new THREE.CapsuleGeometry(.03, .13, 4, 8), material);
  tail.position.set(.01, bun ? 1.60 : 1.53, -.13);
  tail.rotation.x = -.35;
  hair.add(tail);
  // Accessory vertices are authored in the same bind space as the scalp.
  hair.scale.setScalar(CAPTAIN_BIND_SCALE);
  hair.applyMatrix4(scalp.skeleton.boneInverses[index]);
  head.add(hair);
  return hair;
}

const strikerAppearances = new Map();
let defaultStrikerLook = null;

/** Boot-only variants: reuse the same skeleton, animations and foot positions. */
export function prepareStrikerAppearances(characters) {
  if (strikerAppearances.size) return;
  const rig = squad.striker;
  defaultStrikerLook = rig.look;
  const meshes = [];
  let scalp = null;
  const accessories = [];
  if (captain) captain.model.traverse(node => {
    if (node.name === 'captain-hair-accessory') accessories.push(node);
    if (!node.isMesh) return;
    if (node.material.name === 'hair') scalp = node;
    if (['skin', 'hair', 'gloves', 'kit', 'shirt-number'].includes(node.material.name)) meshes.push(node);
  });
  strikerAppearances.set(null, { look: rig.look, face: rig.appearance.face,
    meshes: meshes.map(mesh => ({ mesh, material: mesh.material, geometry: mesh.geometry })), accessories });
  for (const character of characters) {
    const look = character.look;
    const face = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: look.hair, roughness: .9 });
    buildHair(look.style, material, face);
    buildFace(face, look, material);
    face.visible = false;
    rig.body.add(face);
    const variant = { look, face, meshes: [], accessories: [] };
    for (const mesh of meshes) {
      const region = mesh.material.name;
      const mat = mesh.material.clone();
      let geometry = mesh.geometry;
      if (region === 'skin' || region === 'hair') shadeCaptainFace(mat, look);
      if (['skin', 'hair', 'gloves'].includes(region)) {
        mat.color.setHex(region === 'hair' && look.style !== 'bald' ? look.hair : look.skin);
      }
      if (region === 'hair') {
        geometry = captainHairGeometry(look.style,
          mesh.skeleton.bones.indexOf(bipedBone(captain.model, 'head')), true);
      } else {
        // Apply the same deformation to cloth, skin and shirt printing so
        // shared garment seams stay closed. Legs and foot positions stay fixed.
        geometry = mesh.geometry.clone();
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i) / CAPTAIN_BIND_SCALE;
          const chest = THREE.MathUtils.smoothstep(y, .85, 1.15)
            * (1 - THREE.MathUtils.smoothstep(y, 1.38, 1.46));
          pos.setX(i, pos.getX(i) * (1 + (look.build - 1) * chest));
        }
        // Preserve the imported seam normals across the split material regions.
        geometry.computeBoundingSphere();
      }
      variant.meshes.push({ mesh, material: mat, geometry });
    }
    if (scalp && ['headband', 'ponytail', 'bun'].includes(look.style)) {
      const accessory = buildCaptainAccessory(captain.model, scalp, look);
      accessory.visible = false;
      variant.accessories.push(accessory);
    }
    strikerAppearances.set(character.id, variant);
  }
}

/** Selection-time swap only; no new scene objects or changes to shot mechanics. */
export function setStrikerAppearance(id = null) {
  const variant = strikerAppearances.get(id) || strikerAppearances.get(null);
  if (!variant) return;
  for (const entry of strikerAppearances.values()) {
    entry.face.visible = entry === variant;
    for (const accessory of entry.accessories) accessory.visible = entry === variant;
  }
  for (const entry of variant.meshes) {
    entry.mesh.material = entry.material;
    entry.mesh.geometry = entry.geometry;
  }
  const rig = squad.striker;
  rig.look = variant.look;
  rig.appearance.skin.color.setHex(variant.look.skin);
  rig.appearance.hand.color.setHex(variant.look.skin);
  rig.appearance.torso.scale.set(variant.look.build, 1, .72 * variant.look.build);
  rig.appearance.shoulders.scale.y = variant.look.build;
  // Keep the original height and foot placement, including the procedural fallback.
  rig.scale = defaultStrikerLook.height;
  const player = players.find(player => player.role === 'striker');
  if (player) player.look = variant.look;
  striker.characterId = strikerAppearances.has(id) ? id : null;
}

function attachCaptain(rig, model, clips, data, offsets) {
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const name of ANIMATIONS) {
    actions[name] = mixer.clipAction(clips.find(clip => clip.name === name)).play();
    actions[name].setEffectiveWeight(name === 'idle' ? 1 : 0);
    actions[name].paused = true;
  }
  const bindings = [];
  // The controller's -X side is the character's right side.
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 'R' : 'L';
    bindings.push([bipedBone(model, 'upperarm_' + side), rig.arms[i].shoulder],
      [bipedBone(model, 'forearm_' + side), rig.arms[i].elbow],
      [bipedBone(model, 'thigh_' + side), rig.legs[i].hip],
      [bipedBone(model, 'shin_' + side), rig.legs[i].knee]);
  }
  rig.body.visible = false;
  model.scale.x = rig.look.build;
  rig.root.add(model);
  rig.avatar = { model, mixer, actions, data, offsets, bindings, procedural: false, phase: Math.random(), speed: 0,
    saveArms: ['L', 'R'].map(side => [bipedBone(model, 'forearm_' + side),
      bipedBone(model, 'upperarm_' + side), bipedBone(model, 'hand_' + side)]),
    saveLegs: ['L', 'R'].map(side => [bipedBone(model, 'shin_' + side),
      bipedBone(model, 'thigh_' + side), bipedBone(model, 'foot_' + side)]),
    passTime: -1, turnTime: -1, turnName: '', turnRate: 0, scale: rig.scale,
    motionMode: 'locomotion',
    runName: rig.look.build > 1 ? 'run_alt' : 'run', hipBone: bipedBone(model, 'hips'), hipPosition: bipedBone(model, 'hips').position.clone(),
    hipQuaternion: bipedBone(model, 'hips').quaternion.clone() };
  mixer.update(0);
  rig.avatar.hipPosition.copy(bipedBone(model, 'hips').position);
  rig.avatar.hipQuaternion.copy(bipedBone(model, 'hips').quaternion);
}

function sampleLocomotion(a, speed, dt) {
  const actions = a.actions, clips = a.data.clips;
  const localSpeed = speed / a.scale;
  // Small adjustments slow the walking cycle instead of fading its footfalls
  // into idle (which used to suppress both stride and phase advancement).
  const moving = localSpeed >= MIN_GAIT_SPEED ? 1 : 0;
  const brisk = THREE.MathUtils.smoothstep(localSpeed, clips.walk.speed, 2.25);
  const run = THREE.MathUtils.smoothstep(localSpeed, 2.25, RUN_FULL_SPEED);
  const walkWeight = moving * (1 - brisk);
  const quickWeight = moving * brisk * (1 - run);
  const runWeight = moving * run;
  a.phase = (a.phase + dt * localSpeed * (walkWeight / (clips.walk.speed * clips.walk.duration)
    + quickWeight / (clips.quick_walk.speed * clips.quick_walk.duration)
    + runWeight / (clips[a.runName].speed * clips[a.runName].duration))) % 1;
  for (const name of ANIMATIONS) actions[name].setEffectiveWeight(0);
  const idleName = a.idleName || 'idle';
  actions[idleName].setEffectiveWeight(1 - moving);
  actions.walk.setEffectiveWeight(walkWeight);
  actions.quick_walk.setEffectiveWeight(quickWeight);
  actions[a.runName].setEffectiveWeight(runWeight);
  for (const name of GAITS) actions[name].time = ((a.phase + a.offsets[name]) % 1) * clips[name].duration;
  actions.idle.time = (actions.idle.time + dt) % clips.idle.duration;
  if (idleName !== 'idle') actions[idleName].time = (actions[idleName].time + dt) % clips[idleName].duration;

  // Normalized turn clips supply the planted stepping pose; root heading is
  // still controlled by the movement code, so turns cannot spin twice.
  const turnPoseMismatch = (moving && a.turnName?.startsWith('turn_idle'))
    || (!moving && a.turnName?.startsWith('turn_walk'));
  if (localSpeed >= 3 || turnPoseMismatch) a.turnTime = -1;
  if (a.turnTime < 0 && Math.abs(a.turnRate) > .8 && localSpeed < 3) {
    a.turnName = !moving ? (a.turnRate > 0 ? 'turn_idle_left' : 'turn_idle_right')
      : (a.turnRate > 0 ? 'turn_walk_left' : 'turn_walk_right');
    a.turnTime = 0;
  }
  if (a.turnTime >= 0) {
    a.turnTime += dt * 2;
    const duration = clips[a.turnName].duration;
    const weight = Math.sin(Math.min(1, a.turnTime / duration) * Math.PI) * .65;
    for (const name of ANIMATIONS) actions[name].setEffectiveWeight(actions[name].getEffectiveWeight() * (1 - weight));
    actions[a.turnName].setEffectiveWeight(weight);
    actions[a.turnName].time = Math.min(duration, a.turnTime);
    if (a.turnTime >= duration) a.turnTime = -1;
  }
}

function passClipTime(a, dt) {
  a.passTime += dt;
  const elapsed = a.passTime;
  const contact = a.data.clips.kick.contact;
  const time = elapsed < .28 ? elapsed / .28 * contact : contact + elapsed - .28;
  if (time >= a.data.clips.kick.duration + KICK_FADE) a.passTime = -1;
  return time;
}

function sampleKick(a, time) {
  const weight = 1 - THREE.MathUtils.smoothstep(time, a.data.clips.kick.duration, a.data.clips.kick.duration + KICK_FADE);
  for (const name of ANIMATIONS) a.actions[name].setEffectiveWeight(0);
  a.actions.kick.setEffectiveWeight(weight);
  a.actions.idle.setEffectiveWeight(1 - weight);
  a.actions.kick.time = Math.min(time, a.data.clips.kick.duration);
}

function animateSquad(dt) {
  for (const player of players) {
    const rig = player.rig;
    if (rig === squad.keeper && reactions.keeper?.name) { sampleReaction(reactions.keeper, dt); continue; }
    if (defenderReactions.active && rig?.avatar?.goalWalk) { animateDefenderReaction(rig.avatar.goalWalk, dt); continue; }
    if (!rig?.avatar || rig.avatar.procedural) continue;
    const a = rig.avatar;
    if (a.passTime >= 0) sampleKick(a, passClipTime(a, matchFrameDt ? 0 : dt));
    else sampleLocomotion(a, a.speed, dt);
    a.mixer.update(dt);
  }
}

/** Use the final rendered displacement, after AI, collision poses and spacing.
 * A blocker could previously be moved by the chase controller and then have
 * its walking pose overwritten with Alert during the physics substeps. */
function syncPlayerLocomotion(dt) {
  for (const player of players) {
    const r = player.rig, a = r === squad.striker ? captain : r.avatar;
    const motionX = r.root.position.x - player.motionX;
    const motionZ = r.root.position.z - player.motionZ;
    const distance = Math.hypot(motionX, motionZ);
    player.motionX = r.root.position.x;
    player.motionZ = r.root.position.z;
    if (!a) continue;
    // Scene placement is not locomotion. Clear the previous gait immediately
    // so a teleported player cannot take one stale walking step in place.
    if (distance > 2) {
      a.speed = 0;
      a.turnRate = 0;
      a.turnTime = -1;
      if (r === squad.striker) captainSpeed = 0;
      continue;
    }
    const measuredSpeed = distance / Math.max(dt, .001);
    const speed = measuredSpeed >= MIN_GAIT_SPEED ? measuredSpeed : 0;
    // Keep real action clips while active, but never let their idle recovery
    // override translation. Include the striker and both keepers in this pass.
    const kickEnd = a.data.clips.kick.duration;
    const passing = a.passTime >= 0 && a.passTime < .28 + kickEnd - a.data.clips.kick.contact;
    const shooting = r === squad.striker && kickTime >= 0 && kickTime < kickEnd;
    const action = passing || shooting || (r === squad.striker && (celebration.name || reactions.shooter?.name))
      || (r === squad.keeper && reactions.keeper?.name) || (defenderReactions.active && a.goalWalk) || a.saveActive
      || a.motionMode && a.motionMode !== 'locomotion'
      || a.actions.slide_left.getEffectiveWeight() > .1 || a.actions.slide_right.getEffectiveWeight() > .1
      || a.actions.dive_left.getEffectiveWeight() > .35 || a.actions.dive_right.getEffectiveWeight() > .35;
    if (action) continue;
    if (speed > 0) {
      a.passTime = -1;
      if (r === squad.striker) kickTime = -1;
    }
    if (a.procedural && speed > 0) {
      a.turnTime = -1;
      a.turnRate = 0;
      poseRun(r, a.phase, speed / 4.5);
    }
    a.speed = speed;
    if (r === squad.striker) captainSpeed = speed;
  }
}

function poseCaptain(rig, dive = 0, side = 1) {
  if (!rig.avatar) return;
  const a = rig.avatar;
  a.procedural = true;
  const keeper = rig === squad.keeper;
  const idleName = keeper ? 'keeper_idle' : 'idle';
  // Reset the imported pose, then orient its real bones from the gameplay pose.
  for (const name of ANIMATIONS) a.actions[name].setEffectiveWeight(name === idleName ? 1 - dive : 0);
  if (dive > 0) {
    const name = side < 0 ? 'dive_left' : 'dive_right';
    a.actions[name].setEffectiveWeight(dive);
    a.actions[name].time = dive * .72;
  }
  a.actions.idle.time = 0;
  if (keeper) a.actions.keeper_idle.time = crowdTime.value % a.data.clips.keeper_idle.duration;
  a.mixer.update(0);
  // The simulation supplies the leap, lean and landing. The source supplies
  // torso/leg articulation, not a second translation or ballistic trajectory.
  const hips = a.hipBone;
  if (keeper) {
    hips.position.lerp(a.hipPosition, dive);
    hips.quaternion.slerp(a.hipQuaternion, dive);
  } else {
    hips.position.copy(a.hipPosition);
    hips.quaternion.copy(a.hipQuaternion);
  }
  a.model.position.copy(rig.body.position);
  a.model.quaternion.copy(rig.body.quaternion);
  if (keeper) {
    a.model.position.multiplyScalar(dive);
    a.model.quaternion.slerp(_poseQ.identity(), 1 - dive);
  }
  rig.root.updateWorldMatrix(true, true);
  for (const [bone, controller] of a.bindings) {
    const leg = bone.name === 'mixamorigLeftUpLeg' || bone.name === 'mixamorigLeftLeg'
      || bone.name === 'mixamorigRightUpLeg' || bone.name === 'mixamorigRightLeg';
    if (keeper && (leg || dive === 0)) continue;
    if (leg && dive >= .35) continue;
    _sourcePoseQ.copy(bone.quaternion);
    controller.getWorldQuaternion(_poseQ);
    _poseQ.multiply(_downQ);
    bone.parent.getWorldQuaternion(_parentQ).invert();
    bone.quaternion.copy(_parentQ).multiply(_poseQ);
    if (keeper) bone.quaternion.slerp(_sourcePoseQ, 1 - dive);
    if (leg && dive > 0) {
      const blend = clamp(dive / .35, 0, 1);
      bone.quaternion.slerp(_sourcePoseQ, blend * blend * (3 - 2 * blend));
    }
    bone.updateWorldMatrix(false, true);
  }
}

export function setStrikerKick(windup, flight = -1) {
  if (!captain || celebration.name || reactions.shooter?.name) return;
  kickTime = flight < 0 ? clamp(windup, 0, 1) * captain.data.clips.kick.contact
    : captain.data.clips.kick.contact + flight;
}

export function recordStrikerLaunch() {
  launchPending = true;
}

export function startCelebration(name) {
  if (!captain || !CELEBRATIONS.includes(name)) return 1.7;
  celebration.name = name;
  celebration.time = 0;
  celebration.duration = captain.data.clips[name].duration;
  celebration.phase = 'run';
  celebration.runTime = 0;
  captain.passTime = -1;
  captain.moveBlend = 0;
  captainSpeed = 0;
  kickTime = -1;
  for (let i = 0; i < captain.moveBones.length; i++) captain.movePose[i].copy(captain.moveBones[i].quaternion);
  const root = squad.striker.root;
  root.position.y = 0;
  celebration.startX = root.position.x;
  // Head toward the nearer sideline supporters, keeping the route clear of
  // the goal frame/net and finishing inside the touchline.
  const side = root.position.x < 0 ? -1 : 1;
  celebration.targetX = root.position.x + side * Math.min(5.4, Math.max(0, PITCH.WIDTH / 2 - 1 - Math.abs(root.position.x)));
  captain.turnTime = -1;
  captain.turnRate = 0;
  return celebration.runDuration + celebration.duration + .3;
}

export function stopCelebration() { celebration.name = null; celebration.phase = null; }

export function startReaction(role, name) {
  const track = reactions[role];
  if (!track || !REACTIONS.includes(name)) return .8;
  track.name = name; track.time = 0;
  track.duration = Math.min(4.5, track.avatar.data.clips[name].duration);
  track.avatar.passTime = -1;
  track.avatar.moveBlend = 0;
  track.position.copy(track.avatar.model.position);
  track.quaternion.copy(track.avatar.model.quaternion);
  for (let i = 0; i < track.bones.length; i++) track.poses[i].copy(track.bones[i].quaternion);
  if (role === 'shooter') {
    kickTime = -1; captainSpeed = 0;
    const root = track.rig.root;
    _camHome.set(root.position.x + Math.sin(root.rotation.y) * 5, 2.6, root.position.z + Math.cos(root.rotation.y) * 5);
    _camTargetWant.set(root.position.x, 1.15, root.position.z);
  }
  return track.duration + .3;
}

export function stopReactions() {
  defenderReactions.active = false;
  for (const role of ['keeper', 'shooter']) if (reactions[role]) reactions[role].name = null;
}

export function startDefenderReactions(tuning) {
  defenderReactions.active = true;
  const alternate = Math.random() < .5 ? 0 : 1;
  for (let i = 0; i < defenderReactions.tracks.length; i++) {
    const track = defenderReactions.tracks[i], a = track.rig.avatar;
    track.time = 0;
    track.sad = i % 2 === alternate;
    track.speed = track.sad ? tuning.sadSpeed : lerp(tuning.slowMin, tuning.slowMax, Math.random());
    track.heading = Math.random() * Math.PI * 2;
    track.position.copy(a.model.position);
    track.quaternion.copy(a.model.quaternion);
    a.passTime = -1; a.turnTime = -1; a.turnRate = 0; a.saveActive = false;
    a.procedural = false;
    track.actor.script = null;
    track.actor.pressing = track.actor.chasing = false;
  }
}

function animateDefenderReaction(track, dt) {
  const root = track.rig.root, a = track.rig.avatar;
  track.time += dt;
  const dx = Math.sin(root.rotation.y), dz = Math.cos(root.rotation.y);
  if ((Math.abs(root.position.x) > PITCH.WIDTH / 2 - 3 && dx * root.position.x > 0)
    || (root.position.z < GOAL.PLANE_Z + 3 && dz < 0)
    || (root.position.z > GOAL.PLANE_Z + PITCH.LENGTH - 3 && dz > 0)) {
    track.heading = Math.atan2(-root.position.x, GOAL.PLANE_Z + PITCH.LENGTH / 2 - root.position.z);
  }
  setHeading(root, track.heading, dt);
  root.position.x += Math.sin(root.rotation.y) * track.speed * dt;
  root.position.z += Math.cos(root.rotation.y) * track.speed * dt;
  root.position.y = 0;
  track.actor.x = root.position.x; track.actor.z = root.position.z;
  track.actor.heading = root.rotation.y; track.actor.speed = a.speed = track.speed;
  const walk = a.data.clips.walk, sad = a.data.clips.react_walk_sad;
  // The supplied sad walk is a finite performance. Finish into a walking
  // cycle, never its static end pose or an idle, for long celebrations.
  const sadWeight = track.sad ? 1 - THREE.MathUtils.smoothstep(track.time, sad.duration - .35, sad.duration) : 0;
  for (const name of ANIMATIONS) a.actions[name].setEffectiveWeight(0);
  a.actions.react_walk_sad.setEffectiveWeight(sadWeight);
  a.actions.react_walk_sad.time = Math.min(track.time, sad.duration);
  a.phase = (a.phase + dt * track.speed / (walk.speed * track.rig.root.scale.y * walk.duration)) % 1;
  a.actions.walk.setEffectiveWeight(1 - sadWeight);
  a.actions.walk.time = a.phase * walk.duration;
  a.mixer.update(0);
  const blend = Math.max(0, 1 - track.time / .3);
  a.model.position.copy(track.position).multiplyScalar(blend);
  a.model.quaternion.identity().slerp(track.quaternion, blend);
}

function sampleReaction(track, dt) {
  track.time += dt;
  const a = track.avatar;
  const fade = THREE.MathUtils.smoothstep(track.time, track.duration, track.duration + .3);
  for (const name of ANIMATIONS) a.actions[name].setEffectiveWeight(0);
  a.actions[track.name].setEffectiveWeight(1 - fade);
  a.actions[track.name].time = Math.min(track.time, track.duration);
  const idle = track === reactions.keeper ? 'keeper_idle' : 'idle';
  a.actions[idle].setEffectiveWeight(fade);
  a.actions[idle].time = 0;
  a.mixer.update(0);
  const blend = Math.max(0, 1 - track.time / .3);
  a.model.position.copy(track.position).multiplyScalar(blend);
  a.model.quaternion.identity().slerp(track.quaternion, blend);
  if (blend > 0) for (let i = 0; i < track.bones.length; i++) track.bones[i].quaternion.slerp(track.poses[i], blend);
}

function frameCelebration() {
  const root = squad.striker.root;
  const side = celebration.targetX >= celebration.startX ? 1 : -1;
  // Begin at the run-in camera angle, then orbit gently during the performance.
  const angle = Math.atan2(side * 5, 1.5) + side * celebration.time * .18;
  const radius = Math.hypot(5, 1.5);
  _camHome.set(root.position.x + Math.sin(angle) * radius, 2.6,
    root.position.z + Math.cos(angle) * radius);
  _camTargetWant.set(root.position.x, 1.15, root.position.z);
}

function animateCaptain(dt) {
  if (!captain) return;
  if (reactions.shooter?.name) { sampleReaction(reactions.shooter, dt); return; }
  if (celebration.name) {
    if (celebration.phase === 'run') {
      const root = squad.striker.root;
      const previousX = root.position.x;
      celebration.runTime = Math.min(celebration.runDuration, celebration.runTime + dt);
      // Give the scorer time to turn toward the crowd before the run starts.
      const t = Math.max(0, (celebration.runTime - .3) / (celebration.runDuration - .3));
      root.position.x = lerp(celebration.startX, celebration.targetX, t * t * (3 - 2 * t));
      setHeading(root, celebration.targetX >= celebration.startX ? Math.PI / 2 : -Math.PI / 2, dt);
      captainSpeed = dt > 0 ? Math.abs(root.position.x - previousX) / dt : 0;
      sampleLocomotion(captain, captainSpeed, dt);
      captain.mixer.update(0);
      frameCelebration();
      if (t >= 1) {
        celebration.phase = 'perform';
        captainSpeed = 0;
        for (let i = 0; i < captain.moveBones.length; i++) captain.movePose[i].copy(captain.moveBones[i].quaternion);
      }
      return;
    }
    frameCelebration();
    celebration.time += dt;
    for (const name of ANIMATIONS) captain.actions[name].setEffectiveWeight(0);
    const endBlend = THREE.MathUtils.smoothstep(celebration.time, celebration.duration, celebration.duration + .3);
    captain.actions[celebration.name].setEffectiveWeight(1 - endBlend);
    captain.actions[celebration.name].time = Math.min(celebration.time, celebration.duration);
    captain.actions.idle.setEffectiveWeight(endBlend);
    captain.actions.idle.time = 0;
    captain.mixer.update(0);
    if (celebration.time < .2) for (let i = 0; i < captain.moveBones.length; i++) {
      captain.moveBones[i].quaternion.slerp(captain.movePose[i], 1 - celebration.time / .2);
    }
    return;
  }
  if (captainSpeed > .00001 && kickTime < 0 && captain.passTime < 0
    && captain.actions.kick.getEffectiveWeight() > .01) {
    captain.moveBlend = .35;
    for (let i = 0; i < captain.moveBones.length; i++) captain.movePose[i].copy(captain.moveBones[i].quaternion);
  }
  if (captain.passTime >= 0) sampleKick(captain, passClipTime(captain, matchFrameDt ? 0 : dt));
  else if (kickTime >= 0) sampleKick(captain, kickTime);
  else sampleLocomotion(captain, captainSpeed, dt);
  captain.mixer.update(dt);
  if (captain.moveBlend > 0) {
    captain.moveBlend = Math.max(0, captain.moveBlend - dt);
    for (let i = 0; i < captain.moveBones.length; i++) {
      captain.moveBones[i].quaternion.slerp(captain.movePose[i], captain.moveBlend / .35);
    }
  }
}

function captureLaunch() {
  if (!launchPending) return;
  launchPending = false;
  if (captain) {
    striker.bone('foot_R').getWorldPosition(_instep);
    striker.bone('toe_R').getWorldPosition(_toe);
    _instep.add(_toe).multiplyScalar(0.5);
  } else {
    squad.striker.legs[1].ankleMarker.getWorldPosition(_instep);
  }
  _instep.toArray(lastLaunch.instep);
  objects.ball.position.toArray(lastLaunch.ball);
}

function buildSquad() {
  const looks = dealLooks(23);   // two full elevens and the referee
  let n = 0;

  // The keeper's height is pinned: his capsules are the save volume, and the
  // shot balance is tuned against it.
  squad.keeper = buildHumanoid({ ...KIT_KEEP, number: 1 }, { ...looks[n++], height: 1.02 });
  squad.keeper.root.position.set(0, 0, GOAL.PLANE_Z + 0.75);
  scene.add(squad.keeper.root);

  squad.striker = buildHumanoid({ ...KIT_HOME, number: 9 }, looks[n++]);
  scene.add(squad.striker.root);
  striker.root = squad.striker.root;

  for (let i = 0; i < 9; i++) {
    const m = buildHumanoid({ ...KIT_HOME, number: [7, 11, 8, 6, 10, 2, 4, 5, 3][i], lite: true }, looks[n++]);
    squad.mates.push(m);
    scene.add(m.root);
  }
  for (let i = 0; i < 10; i++) {
    const f = buildHumanoid({ ...KIT_AWAY, number: [4, 5, 3, 2, 8, 6, 10, 11, 9, 7][i], lite: i > 1 }, looks[n++]);
    squad.foes.push(f);
    scene.add(f.root);
  }
  squad.homeKeeper = buildHumanoid({ ...KIT_KEEP, kit: 0x429d64, number: 1, lite: true }, looks[n++]);
  squad.homeKeeper.root.position.set(0, 0, GOAL.PLANE_Z + PITCH.LENGTH - 1.2);
  setHeading(squad.homeKeeper.root, Math.PI);
  scene.add(squad.homeKeeper.root);
  squad.ref = buildHumanoid({ ...KIT_REF, lite: true }, looks[n++]);
  scene.add(squad.ref.root);
}

// ---------------------------------------------------------------------------
// Collision capsules, read from the live rigs
// ---------------------------------------------------------------------------
function makeCapsuleSet(rig, useHands = true) {
  const caps = [];
  const src = [];
  const s = rig.scale || 1;
  const add = (from, to, r) => {
    caps.push({ a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, r: r * s });
    src.push([from, to]);
  };
  if (rig.avatar) {
    const model = rig.avatar.model;
    add(bipedBone(model, 'hips'), bipedBone(model, 'neck'), 0.23);
    for (const side of ['L', 'R']) {
      if (useHands) {
        add(bipedBone(model, 'upperarm_' + side), bipedBone(model, 'forearm_' + side), 0.10);
        add(bipedBone(model, 'forearm_' + side), bipedBone(model, 'hand_' + side), 0.10);
        add(bipedBone(model, 'thigh_' + side), bipedBone(model, 'foot_' + side), 0.13);
      } else {
        add(bipedBone(model, 'thigh_' + side), bipedBone(model, 'shin_' + side), 0.13);
        add(bipedBone(model, 'shin_' + side), bipedBone(model, 'foot_' + side), 0.10);
        add(bipedBone(model, 'foot_' + side), bipedBone(model, 'toe_' + side), 0.09);
      }
    }
    return { rig, caps, src };
  }
  add(rig.hipMarker, rig.neckMarker, 0.23);          // torso
  if (useHands) for (const arm of rig.arms) {
    add(arm.shoulder, arm.elbow, 0.10);              // upper arm
    add(arm.elbow, arm.handMarker, 0.10);            // forearm + hand
  }
  for (const leg of rig.legs) {
    if (useHands) add(leg.hip, leg.ankleMarker, 0.13);
    else {
      add(leg.hip, leg.knee, 0.13);
      add(leg.knee, leg.ankleMarker, 0.10);
    }
  }
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
const turfMaps = [];
let turfMaterial;
export const PITCH_SURFACES = ['Emerald stripes', 'Summer checkerboard', 'Worn diagonal'];

function turfTexture(variant) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1536;
  const g = c.getContext('2d');
  let seed = 7351 + variant * 919;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const colors = [[48, 100, 43], [76, 111, 46], [65, 98, 46]];
  const base = colors[variant];
  const pixels = g.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++) {
    const z = (y / c.height - .5) * 145;
    for (let x = 0; x < c.width; x++) {
      const px = (x / c.width - .5) * 120;
      const inPitch = Math.abs(px) < PITCH.WIDTH / 2 && Math.abs(z) < PITCH.LENGTH / 2;
      const band = variant === 0 ? Math.floor((z + 52.5) / 8.08)
        : variant === 1 ? Math.floor((px + 34) / 8.5) + Math.floor((z + 52.5) / 8.08)
        : Math.floor((px + z + 100) / 8);
      const mowing = inPitch ? (band % 2 ? 6 : -5) : -9;
      const mottling = Math.sin(px * .53 + Math.sin(z * .31)) * 2.5
        + Math.sin(z * 1.7 + px * .77) * 1.5;
      const grain = (random() - .5) * 16;
      const i = (y * c.width + x) * 4;
      pixels.data[i] = base[0] + mowing + mottling + grain;
      pixels.data[i + 1] = base[1] + mowing + mottling + grain;
      pixels.data[i + 2] = base[2] + mowing * .6 + mottling + grain * .6;
      pixels.data[i + 3] = 255;
    }
  }
  g.putImageData(pixels, 0, 0);
  // Soft wear around both goal mouths and midfield, never baked-in markings.
  for (let i = 0; i < (variant === 2 ? 180 : 55); i++) {
    const end = i % 3;
    const x = c.width * .5 + (random() - .5) * (end === 2 ? 160 : 90);
    const y = c.height * (.5 + (end === 2 ? 0 : end === 0 ? -49 / 145 : 49 / 145))
      + (random() - .5) * 75;
    const radius = 4 + random() * 21;
    const patch = g.createRadialGradient(x, y, 0, x, y, radius);
    patch.addColorStop(0, variant === 2 ? 'rgba(151,124,68,.13)' : 'rgba(131,125,65,.06)');
    patch.addColorStop(1, 'rgba(131,125,65,0)');
    g.fillStyle = patch; g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.name = PITCH_SURFACES[variant];
  return t;
}

function turfDetail() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18000; i++) {
    const tone = 60 + (Math.random() * 135) | 0;
    g.fillStyle = `rgb(${tone},${tone},${tone})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, .7, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(80, 97);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

export function setPitchSurface(index) {
  if (!turfMaterial || !Number.isInteger(index) || index < 0 || index >= turfMaps.length) return;
  turfMaterial.map = turfMaps[index];
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
  for (let i = 0; i < PITCH_SURFACES.length; i++) turfMaps.push(turfTexture(i));
  turfMaterial = new THREE.MeshStandardMaterial({ map: turfMaps[0], roughness: .96,
    bumpMap: turfDetail(), bumpScale: .018 });
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 145),
    turfMaterial
  );
  field.rotation.x = -Math.PI / 2;
  field.position.z = GOAL.PLANE_Z + PITCH.LENGTH / 2;
  field.name = 'pitch-turf';
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
  const far = GOAL.PLANE_Z + PITCH.LENGTH;
  const half = GOAL.PLANE_Z + PITCH.LENGTH / 2;
  strip([[-34, half], [34, half]]);
  strip([[-34, GOAL.PLANE_Z], [-34, far], [34, far], [34, GOAL.PLANE_Z]]);
  strip([[-9.16, far], [-9.16, far - 5.5], [9.16, far - 5.5], [9.16, far]]);
  strip([[-20.16, far], [-20.16, far - 16.5], [20.16, far - 16.5], [20.16, far]]);

  const arc = [];
  for (let i = 0; i <= 28; i++) {
    const end = Math.asin(5.5 / 9.15);
    const a = end + (Math.PI - 2 * end) * i / 28;
    arc.push([Math.cos(a) * 9.15, GOAL.PLANE_Z + 11 + Math.sin(a) * 9.15]);
  }
  strip(arc);
  strip(arc.map(p => [p[0], GOAL.PLANE_Z * 2 + PITCH.LENGTH - p[1]]));

  const circle = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    circle.push([Math.cos(a) * 9.15, half + Math.sin(a) * 9.15]);
  }
  strip(circle);
  for (const z of [GOAL.PLANE_Z + 11, half, far - 11]) {
    const spot = new THREE.Mesh(new THREE.CircleGeometry(.06, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(0, .022, z);
    scene.add(spot);
  }
}

function buildGoal() {
  const goalMeshes = [];
  const frame = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(GOAL.POST_R, GOAL.POST_R, GOAL.BAR_Y, 20);
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, frame);
    p.position.set(sx * GOAL.POST_X, GOAL.BAR_Y / 2, GOAL.PLANE_Z);
    p.name = 'goal-post';
    p.castShadow = true;
    scene.add(p);
    goalMeshes.push(p);
  }
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(GOAL.POST_R, GOAL.POST_R, GOAL.POST_X * 2 + GOAL.POST_R * 2, 12), frame);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL.BAR_Y, GOAL.PLANE_Z);
  bar.name = 'goal-crossbar';
  bar.castShadow = true;
  scene.add(bar);
  goalMeshes.push(bar);

  const net = new THREE.LineBasicMaterial({
    color: 0xe5e9df, transparent: true, opacity: 0.64, depthWrite: false,
  });
  const depth = NET.DEPTH;
  const grid = (width, height, cols, rows) => {
    const geometry = new THREE.PlaneGeometry(width, height, cols, rows);
    const indices = [];
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
      const i = y * (cols + 1) + x;
      if (x < cols) indices.push(i, i + 1);
      if (y < rows) indices.push(i, i + cols + 1);
    }
    geometry.setIndex(indices);
    const lines = new THREE.LineSegments(geometry, net);
    lines.name = 'goal-net';
    lines.frustumCulled = false; // pockets extend outside the rest bounds
    return lines;
  };
  const support = (ax, ay, az, bx, by, bz) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const direction = b.clone().sub(a);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, direction.length(), 8), frame);
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    rail.position.copy(a).add(b).multiplyScalar(.5);
    rail.name = 'goal-support';
    scene.add(rail); goalMeshes.push(rail);
  };
  for (const side of [-1, 1]) {
    const x = side * GOAL.POST_X;
    support(x, .025, GOAL.PLANE_Z, x, .025, GOAL.PLANE_Z - depth);
    support(x, .025, GOAL.PLANE_Z - depth, x, GOAL.BAR_Y, GOAL.PLANE_Z - depth);
    support(x, GOAL.BAR_Y, GOAL.PLANE_Z, x, GOAL.BAR_Y, GOAL.PLANE_Z - depth);
  }
  support(-GOAL.POST_X, .025, GOAL.PLANE_Z - depth, GOAL.POST_X, .025, GOAL.PLANE_Z - depth);
  support(-GOAL.POST_X, GOAL.BAR_Y, GOAL.PLANE_Z - depth, GOAL.POST_X, GOAL.BAR_Y, GOAL.PLANE_Z - depth);

  // Panel order must match physics.NET_PANELS: back, left, right, roof.
  const back = grid(GOAL.HALF_W * 2, GOAL.HEIGHT, 42, 14);
  back.position.set(0, GOAL.HEIGHT / 2, GOAL.PLANE_Z - depth);
  scene.add(back);
  goalMeshes.push(back);
  registerNetPanel(back, 0, 0, -1);

  let idx = 1;
  for (const sx of [-1, 1]) {
    const side = grid(depth, GOAL.HEIGHT, 12, 14);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * GOAL.HALF_W, GOAL.HEIGHT / 2, GOAL.PLANE_Z - depth / 2);
    scene.add(side);
    goalMeshes.push(side);
    registerNetPanel(side, idx++, sx, 0);
  }

  const top = grid(GOAL.HALF_W * 2, depth, 42, 12);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, GOAL.HEIGHT, GOAL.PLANE_Z - depth / 2);
  scene.add(top);
  registerNetPanel(top, 3, 0, 0, 1);
  goalMeshes.push(top);
  // The opposite goal is scenery, built once with separate net geometry.
  for (const mesh of goalMeshes) {
    const far = mesh.clone();
    far.geometry = mesh.geometry.clone();
    far.position.z = GOAL.PLANE_Z * 2 + PITCH.LENGTH - mesh.position.z;
    far.rotation.y = -mesh.rotation.y;
    far.name = 'far-' + (mesh.name || 'goal-net');
    scene.add(far);
  }
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
let netAccumulator = 0;

const NET_TENSION = 620;     // pull toward the neighbours - the "connected" feel
const NET_ANCHOR = 26;       // weak pull back to flat; the pinned rim does the rest
const NET_DAMP = 5.5;
const NET_DRIVE = 2400;      // how hard the ball's pocket drags the mesh
const NET_STEP = 1 / 240;

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
    contact: new Float32Array(count),
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
    panel.contact.fill(0);

    if (pocket.touched && Math.abs(pocket.depth) > 0.001) {
      live = true;
      _local.set(pocket.x, pocket.y, pocket.z);
      panel.mesh.worldToLocal(_local);

      // A deeper punch drags a wider area of mesh in with it.
      const radius = 0.55 + Math.abs(pocket.depth) * 1.5;
      const r2 = radius * radius;
      for (let v = 0; v < panel.drive.length; v++) {
        if (panel.pinned[v]) continue;
        const dx = panel.localX[v] - _local.x;
        const dy = panel.localY[v] - _local.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < BALL_R * BALL_R) {
          panel.contact[v] = Math.max(0, Math.abs(pocket.depth) - BALL_R + Math.sqrt(BALL_R * BALL_R - d2)) * pocket.side;
        }
        if (d2 > r2) continue;
        const f = 1 - Math.sqrt(d2) / radius;
        panel.drive[v] = pocket.depth * f * f * panel.sign;
      }
    }
  }

  if (!live && netEnergy <= 0) return;
  netEnergy = live ? 0.9 : netEnergy - dt;

  netAccumulator += dt;
  const h = NET_STEP;
  while (netAccumulator + 1e-10 >= h) {
    netAccumulator -= h;
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
    const { attr, baseZ, disp, vel, contact, sign } = panel;
    for (let v = 0; v < disp.length; v++) {
      // Keep the cords around the ball's surface while the surrounding mesh
      // catches up, rather than letting the ball visibly pass through it.
      const side = Math.sign(contact[v]);
      if (side && disp[v] * sign * side < Math.abs(contact[v])) {
        disp[v] = contact[v] * sign;
        if (vel[v] * sign * side < 0) vel[v] = 0;
      }
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
  } else if (stillMoving) {
    netEnergy = Math.max(netEnergy, .1);
  }
}

const crowdTime = { value: 0 };
const crowdCheer = { value: 0 };
let supporterFlagMap;
export const crowd = { count: 0, batches: [], get time() { return crowdTime.value; },
  get excitement() { return crowdCheer.value; } };
export function cheerCrowd(goal) { crowdCheer.value = goal ? 1 : 0.35; }

// All spectators share a handful of meshes. Their motion happens on the GPU;
// only two uniforms change per frame, with no per-person JS work or uploads.
function crowdMaterial() {
  const material = new THREE.MeshLambertMaterial({ emissive: 0x101318 });
  material.onBeforeCompile = shader => {
    shader.uniforms.crowdTime = crowdTime;
    shader.uniforms.crowdCheer = crowdCheer;
    shader.vertexShader = 'uniform float crowdTime;\nuniform float crowdCheer;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = dot(instanceMatrix[3].xz, vec2(3.17, 5.71));
      float wave = sin(crowdTime * (2.0 + 0.4 * sin(phase)) + phase);
      float upper = smoothstep(0.5, 1.9, position.y);
      transformed.x += wave * (0.035 + crowdCheer * 0.07) * upper;
      transformed.y += max(0.0, sin(crowdTime * 4.2 + phase)) * (0.025 + crowdCheer * 0.16);
      transformed.z += sin(crowdTime * 2.7 + phase) * upper * 0.025;
    `);
  };
  material.customProgramCacheKey = () => 'stadium-supporter-v1';
  return material;
}

/** Boot-only geometry assembly for the three supporter poses. */
function joinCrowdParts(parts) {
  const positions = [], normals = [];
  for (const part of parts) {
    const geo = part.index ? part.toNonIndexed() : part;
    positions.push(...geo.attributes.position.array);
    normals.push(...geo.attributes.normal.array);
    if (geo !== part) geo.dispose();
    part.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return result;
}

function supporterParts(pose) {
  const box = (w, h, d, x, y, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const oval = (rx, ry, rz, x, y, z = 0) => new THREE.SphereGeometry(1, 8, 6)
    .scale(rx, ry, rz).translate(x, y, z);
  const limb = (start, end, bottom, top) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    return new THREE.CylinderGeometry(top, bottom, direction.length(), 8)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()))
      .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  const arms = [], hands = [], sleeves = [], trousers = [], shoes = [];
  for (const side of [-1, 1]) {
    const up = pose === 2 || (pose === 1 && side === 1);
    const shoulder = [side * .19, 1.31, 0];
    const elbow = [side * (up ? .39 : .29), up ? 1.61 : 1.04, .025];
    const hand = [side * (up ? .48 : .27), up ? 1.96 : .81, .055];
    const cuff = shoulder.map((v, i) => v + (elbow[i] - v) * .48);
    sleeves.push(oval(.095, .10, .105, ...shoulder), limb(shoulder, cuff, .085, .072));
    arms.push(limb(cuff, elbow, .057, .045), oval(.045, .046, .045, ...elbow),
      limb(elbow, hand, .046, .032));
    hands.push(oval(.043, .069, .032, ...hand));
    const hip = [side * .10, .79, 0];
    const knee = [side * .115, .43, pose === 1 ? .035 : .01];
    const ankle = [side * .125, .105, 0];
    trousers.push(limb(hip, knee, .098, .071), oval(.072, .082, .075, ...knee),
      limb(knee, ankle, .073, .051));
    shoes.push(oval(.066, .061, .125, side * .125, .061, .045));
  }
  // A smooth waist/chest/shoulder profile instead of a straight polygonal tube.
  const torso = new THREE.LatheGeometry([[.16, .78], [.175, .85], [.163, 1.0],
    [.205, 1.20], [.21, 1.29], [.165, 1.35], [.058, 1.39]]
    .map(([r, y]) => new THREE.Vector2(r, y)), 10).scale(1, 1, .64);
  return [joinCrowdParts([torso, ...sleeves]),
    joinCrowdParts([oval(.108, .148, .113, 0, 1.55),
      oval(.025, .038, .018, -.108, 1.55), oval(.025, .038, .018, .108, 1.55),
      oval(.022, .029, .034, 0, 1.55, .103),
      new THREE.CylinderGeometry(.048, .055, .12, 8).translate(0, 1.39, 0)]),
    new THREE.SphereGeometry(0.129, 10, 5, 0, Math.PI * 2, 0, Math.PI * .56)
      .scale(0.88, 1.16, 0.92).translate(0, 1.57, -0.008),
    joinCrowdParts([oval(.185, .115, .105, 0, .79), ...trousers]),
    joinCrowdParts(arms.concat(hands)),
    pose === 2 ? box(1.08, 0.14, 0.025, 0, 2.0, 0.04) : null,
    pose === 2 ? joinCrowdParts([-0.42, -0.14, 0.14, 0.42].map(x => box(.13, .145, .029, x, 2.0, .04))) : null,
    joinCrowdParts([...shoes, box(.015, .014, .012, -.035, 1.58, .105), box(.015, .014, .012, .035, 1.58, .105),
      new THREE.SphereGeometry(.025, 5, 4).scale(.7, pose === 0 ? .45 : 1.3, .35).translate(0, 1.51, .11)])];
}

function buildStands() {
  const wall = new THREE.MeshStandardMaterial({ color: 0x18212d, roughness: 1 });
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  const rows = 14;
  const stands = [
    { x: 0, z: GOAL.PLANE_Z - 9, angle: 0, width: 80, columns: 108 },
    { x: 0, z: GOAL.PLANE_Z + PITCH.LENGTH + 9, angle: Math.PI, width: 80, columns: 108 },
    { x: -39, z: GOAL.PLANE_Z + PITCH.LENGTH / 2, angle: Math.PI / 2, width: 114, columns: 152 },
    { x: 39, z: GOAL.PLANE_Z + PITCH.LENGTH / 2, angle: -Math.PI / 2, width: 114, columns: 152 },
  ];
  const supporters = [[], [], []];
  const tiers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wall, rows * stands.length);
  tiers.name = 'stadium-terraces';
  let tierIndex = 0;
  const shirts = [0x2458be, 0x3678e0, 0xb92f39, 0xe8b849, 0x23705d, 0xe6dfce, 0x2d3444];
  const skins = [0xe9bc96, 0xc78e61, 0x8d5739, 0x573927, 0xf0d0b0];
  for (const stand of stands) {
    const cos = Math.cos(stand.angle), sin = Math.sin(stand.angle);
    for (let row = 0; row < rows; row++) {
      const depth = row * 0.92, base = 1.4 + row * 0.56;
      transform.position.set(stand.x - sin * depth, base / 2, stand.z - cos * depth);
      transform.rotation.set(0, stand.angle, 0);
      transform.scale.set(stand.width, base, 0.94);
      transform.updateMatrix();
      tiers.setMatrixAt(tierIndex++, transform.matrix);
      for (let col = 0; col < stand.columns; col++) {
        if (col % 27 < 2 || (row > 9 && Math.random() < .06)) continue; // access aisles
        const across = (col - (stand.columns - 1) / 2) * .72 + (Math.random() - .5) * .12;
        const pose = (Math.random() * 3) | 0;
        supporters[pose].push({ x: stand.x + across * cos - sin * depth,
          y: base, z: stand.z - across * sin - cos * depth, angle: stand.angle,
          height: .91 + Math.random() * .15, build: .9 + Math.random() * .2,
          shirt: shirts[(Math.random() * shirts.length) | 0], skin: skins[(Math.random() * skins.length) | 0],
          hair: Math.random() < .25 ? 0x79502b : 0x241a15 });
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(stand.width + 3, .5, 5), wall);
    roof.position.set(stand.x - sin * 11, 12.1, stand.z - cos * 11);
    roof.rotation.y = stand.angle;
    scene.add(roof);
    const bounds = AD_BOARDS[stands.indexOf(stand)];
    const board = new THREE.Mesh(new THREE.BoxGeometry(stand.width, BOARD_HEIGHT, BOARD_THICKNESS),
      new THREE.MeshLambertMaterial({ color: stand.angle === 0 ? 0x1c4084 : 0x293d59 }));
    board.position.set((bounds.minX + bounds.maxX) / 2, BOARD_HEIGHT / 2, (bounds.minZ + bounds.maxZ) / 2);
    board.name = 'advertising-board';
    board.rotation.y = stand.angle;
    scene.add(board);
  }
  tiers.instanceMatrix.needsUpdate = true;
  scene.add(tiers);
  const material = crowdMaterial();
  for (let pose = 0; pose < 3; pose++) {
    const fans = supporters[pose];
    crowd.count += fans.length;
    const parts = supporterParts(pose);
    for (let part = 0; part < parts.length; part++) {
      if (!parts[part]) continue;
      const mesh = new THREE.InstancedMesh(parts[part], material, fans.length);
      mesh.name = 'crowd-' + pose + '-' + part;
      mesh.userData.part = part;
      mesh.userData.pose = pose;
      for (let i = 0; i < fans.length; i++) {
        const fan = fans[i];
        transform.position.set(fan.x, fan.y, fan.z);
        transform.rotation.set(0, fan.angle, 0);
        transform.scale.set(fan.build, fan.height, fan.build);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        tint.setHex(part === 0 ? fan.shirt : part === 1 || part === 4 ? fan.skin
          : part === 2 ? fan.hair : part === 3 ? 0x252b39 : part === 5 ? 0xcf333e
            : part === 6 ? 0xf0ca57 : 0x281713);
        mesh.setColorAt(i, tint);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += .4; // animated displacement
      scene.add(mesh);
      crowd.batches.push(mesh);
    }
  }
  buildSupporterFlags();
  const lamp = new THREE.MeshBasicMaterial({ color: 0xeaf2fb });
  for (const sx of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 0.4), lamp);
    pylon.position.set(sx * 20, 17.5, GOAL.PLANE_Z - 12);
    scene.add(pylon);
  }
}

function buildSupporterFlags() {
  const cloth = document.createElement('canvas');
  cloth.width = 128; cloth.height = 64;
  const paint = cloth.getContext('2d');
  for (let i = 0; i < 8; i++) {
    paint.fillStyle = i % 2 ? '#ebc558' : '#ba303b';
    paint.fillRect(i * 16, 0, 16, 64);
  }
  const flagMap = new THREE.CanvasTexture(cloth);
  supporterFlagMap = flagMap;
  flagMap.colorSpace = THREE.SRGBColorSpace;
  const flagMaterial = new THREE.MeshLambertMaterial({ map: flagMap, side: THREE.DoubleSide });
  flagMaterial.onBeforeCompile = shader => {
    shader.uniforms.crowdTime = crowdTime;
    shader.vertexShader = 'uniform float crowdTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      transformed.z += sin(position.x * 5.0 - crowdTime * 5.5 + modelMatrix[3].x) * uv.x * .18;
    `);
  };
  const flagGeo = new THREE.PlaneGeometry(1.7, 1, 10, 4).translate(.85, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(.018, .018, 3, 5);
  const poleMaterial = new THREE.MeshLambertMaterial({ color: 0xc9d1dc });
  for (let i = 0; i < 8; i++) {
    const row = i % 2 === 0 ? 3 : 9;
    const x = -32 + i * 9, y = 1.4 + row * .56;
    const z = GOAL.PLANE_Z - 9 - row * .92;
    const pole = new THREE.Mesh(poleGeo, poleMaterial);
    pole.position.set(x, y + 1.5, z);
    scene.add(pole);
    const flag = new THREE.Mesh(flagGeo, flagMaterial);
    flag.name = 'supporter-flag';
    flag.position.set(x, y + 2.5, z);
    scene.add(flag);
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

let ballLoad;
export function loadBall() {
  if (!ballLoad) ballLoad = loadBallModel();
  return ballLoad;
}

async function loadBallModel() {
  let timer;
  try {
    const gltf = await Promise.race([
      import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) =>
        new GLTFLoader().loadAsync('assets/ball.glb')),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Ball load timed out')), 10000); }),
    ]);
    gltf.scene.updateMatrixWorld(true);
    const mesh = gltf.scene.getObjectByProperty('isMesh', true);
    if (!mesh) throw new Error('Ball asset has no mesh');
    // Bake the asset transform and centre its geometry, keeping the existing
    // ball object and its physics-driven position/rotation stable.
    const geometry = mesh.geometry;
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere;
    if (!(radius > 0)) throw new Error('Ball asset has invalid bounds');
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(BALL_R / radius, BALL_R / radius, BALL_R / radius);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.metalness = 0;
      material.side = THREE.FrontSide;
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    objects.ball.geometry.dispose();
    objects.ball.material.map.dispose();
    objects.ball.material.dispose();
    objects.ball.geometry = geometry;
    objects.ball.material = mesh.material;
    objects.ball.name = 'soccer-ball';
    objects.ball.userData.asset = 'assets/ball.glb';
  } catch (error) {
    console.warn('Using procedural ball fallback:', error);
  } finally {
    clearTimeout(timer);
  }
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
  if (rig.avatar) {
    rig.avatar.procedural = false;
    rig.avatar.motionMode = 'locomotion';
    rig.avatar.speed = amp <= 0.17 ? 0 : amp * 4.5;
    rig.avatar.model.position.set(0, 0, 0);
    rig.avatar.model.quaternion.identity();
  }
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
let keeperShufflePhase = 0;
const _saveTarget = new THREE.Vector3();
const _saveJoint = new THREE.Vector3();
const _saveFrom = new THREE.Vector3();
const _saveTo = new THREE.Vector3();
const _saveInverse = new THREE.Quaternion();
const _saveTurn = new THREE.Quaternion();
export function keeperLineZ() { return squad.keeper.root.position.z; }

function reachKeeperHands(rig, target) {
  if (!rig.avatar) return;
  // A close low shot gets a foot block rather than passing through the wide
  // ready stance. Move the real boot and knee, preserving the supporting leg.
  if (target.y < .45) {
    let selected = rig.avatar.saveLegs[0], nearest = Infinity;
    for (const chain of rig.avatar.saveLegs) {
      chain[2].getWorldPosition(_saveJoint);
      const distance = Math.abs(_saveJoint.x - target.x);
      if (distance < nearest) { selected = chain; nearest = distance; }
    }
    _saveTarget.set(target.x, .13, target.z);
    reachKeeperChain(selected);
  }
  for (let arm = 0; arm < 2; arm++) {
    const chain = rig.avatar.saveArms[arm];
    _saveTarget.set(target.x + (arm === 0 ? -.09 : .09), target.y, target.z);
    reachKeeperChain(chain);
  }
}

function reachKeeperChain(chain) {
  for (let pass = 0; pass < 4; pass++) for (let j = 0; j < 2; j++) {
    const joint = chain[j];
    joint.getWorldPosition(_saveJoint);
    chain[2].getWorldPosition(_saveFrom);
    joint.getWorldQuaternion(_saveInverse).invert();
    _saveFrom.sub(_saveJoint).applyQuaternion(_saveInverse).normalize();
    _saveTo.copy(_saveTarget).sub(_saveJoint).applyQuaternion(_saveInverse).normalize();
    _saveTurn.setFromUnitVectors(_saveFrom, _saveTo);
    joint.quaternion.multiply(_saveTurn);
    joint.updateWorldMatrix(false, true);
  }
}

export function setKeeper(x, dive, side, high, airY, ground, target = null) {
  const r = squad.keeper;
  if (reactions.keeper?.name) return;
  if (r.avatar) {
    r.avatar.saveActive = !!target || dive > .05 || airY > .01;
    // A keeper moving across the line is shuffling while staying square to
    // play, not running forward in the direction of root displacement.
    r.avatar.motionMode = 'keeper-shuffle';
  }
  const h = high || 0;
  const lean = dive * (1.35 - h * 0.55);
  const dx = x - r.root.position.x;
  const ready = 1 - clamp(dive / .35, 0, 1);
  // Distance-driven side steps stay in sync with line movement at any FPS.
  // Large changes are chance placement, not a shuffle across the turf.
  if (Math.abs(dx) < .25) keeperShufflePhase += Math.abs(dx) * Math.PI / .32;
  else keeperShufflePhase = 0;
  const shuffle = Math.abs(dx) > .00001 && Math.abs(dx) < .25
    ? Math.sin(keeperShufflePhase) * Math.sign(dx) * ready : 0;
  r.root.position.x = x;
  // Mid-dive the pivot is the hips, so a horizontal body hangs at hip height.
  // Once he is down that is wrong - it leaves him lying flat in mid-air - so
  // drive the hip toward a lying height as he settles. Expressing it as a
  // target hip height rather than a fixed drop is what makes it work for both
  // a flat sprawl and a half-propped landing from a leap.
  const lay = (ground || 0) * Math.sin(lean) * dive;
  const hipY = RIG.HIP_Y - (RIG.HIP_Y - 0.25) * lay;
  r.body.position.y = hipY - RIG.HIP_Y * Math.cos(lean) + (airY || 0) - ready * .05;
  r.body.rotation.z = -side * lean;
  // +Z is forward: hinge the trunk forward while the hips sit back.
  // Compensate around hip height instead of tipping the whole rig off its feet.
  r.body.rotation.x = ready * .40;
  r.body.position.z = -RIG.HIP_Y * Math.sin(r.body.rotation.x);

  for (const arm of r.arms) {
    arm.shoulder.rotation.z = lerp(arm.sx * 0.38, arm.sx * Math.PI, dive);
    arm.shoulder.rotation.x = lerp(-0.22, 0, dive);
    arm.elbow.rotation.z = lerp(arm.sx * -0.25, 0, dive);
    arm.elbow.rotation.x = -ready * .20;
  }
  for (const leg of r.legs) {
    const lift = Math.max(0, shuffle * leg.sx) * .10;
    // The controller legs point down -Y. Negative hip X brings the knee
    // forward; positive knee X folds the shin back underneath it.
    leg.hip.rotation.x = lerp(-.80 - lift, 0.42, dive);
    leg.hip.rotation.z = lerp(leg.sx * (.34 + shuffle * .05), -side * 0.22, dive);
    leg.knee.rotation.x = lerp(.78 + lift, -0.3, dive);
  }
  poseCaptain(r, dive, side);
  if (target) reachKeeperHands(r, target);
}

/**
 * Defender block. Step across the shot line with a leading boot and a bent
 * supporting knee. Keep the torso upright and hands tucked against the body;
 * only the torso, legs and boots participate in a defender's block collision.
 */
export function blockerBallDistance(i) {
  const root = blockerSets[i].rig.root;
  return Math.hypot(root.position.x - objects.ball.position.x, root.position.z - objects.ball.position.z);
}

export function setBlocker(i, x, lunge, side, airY, slideTime = -1) {
  const r = blockerSets[i].rig;
  if (defenderReactions.active && r.avatar?.goalWalk) return r.root.position.x;
  if (r.avatar?.passTime >= 0) return r.root.position.x;
  const p = formation.pressers[0]?.rig === r ? formation.pressers[0]
    : formation.pressers[1]?.rig === r ? formation.pressers[1] : null;
  if (p?.chasing) {
    // The movement controller owns the approach; use the leg block only when
    // close enough to challenge, and never snap back to the old shot-line X.
    x = p.x;
    if (blockerBallDistance(i) > 3 && (slideTime < 0 || slideTime >= .95)) return r.root.position.x;
  }
  if (r.avatar && (slideTime >= 0 || lunge < .05)) {
    const a = r.avatar;
    a.procedural = true;
    a.motionMode = 'block';
    r.root.position.x = x;
    a.model.position.set(0, 0, 0);
    a.model.quaternion.identity();
    for (const name of ANIMATIONS) a.actions[name].setEffectiveWeight(0);
    const name = side < 0 ? 'slide_left' : 'slide_right';
    const duration = a.data.clips[name].duration;
    const t = Math.min(duration, Math.max(0, slideTime * 2));
    const weight = slideTime < 0 ? 0 : Math.min(1, t / .12, (duration - t) / .18);
    a.actions.alert.time = crowdTime.value % a.data.clips.alert.duration;
    a.actions.alert.setEffectiveWeight(1 - weight);
    a.actions[name].time = t;
    a.actions[name].setEffectiveWeight(weight);
    a.mixer.update(0);
    r.root.updateWorldMatrix(true, true);
    return x;
  }
  const lean = lunge * 0.12;
  if (r.avatar) r.avatar.motionMode = 'block';
  r.root.position.x = x;
  r.body.position.y = -lunge * 0.07 + (airY || 0);
  r.body.rotation.z = side * lean;
  r.body.rotation.x = lunge * 0.06;

  for (const arm of r.arms) {
    arm.shoulder.rotation.z = arm.sx * 0.06;
    arm.shoulder.rotation.x = 0.10;
    arm.elbow.rotation.z = -arm.sx * 0.12;
    arm.elbow.rotation.x = -0.35;
  }
  const lead = side > 0 ? r.legs[1] : r.legs[0];
  const trail = side > 0 ? r.legs[0] : r.legs[1];
  lead.hip.rotation.z = side * lunge * 0.52;
  lead.hip.rotation.x = lerp(0.1, -0.28, lunge);
  lead.knee.rotation.x = lerp(-0.15, -0.05, lunge);
  trail.hip.rotation.z = -side * lunge * 0.12;
  trail.hip.rotation.x = lerp(0.1, 0.28, lunge);
  trail.knee.rotation.x = lerp(-0.15, -0.50, lunge);
  poseCaptain(r);
  return r.root.position.x;
}

/**
 * Striker kick. `t` 0..1: backswing through the first 30%, then the strike.
 * Contact is at t ~= 0.55, which is when app.js releases the ball.
 */
export function setStrikerSwing(t) {
  if (captain) {
    if (t === 0) { kickTime = -1; captainSpeed = 0; captain.passTime = -1; captain.turnTime = -1; captain.turnRate = 0; }
    return;
  }
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
  { x: -20, z: -2 }, { x: 20, z: -2 },
  { x: -12, z: 17 }, { x: 0, z: 22 }, { x: 12, z: 17 },
  { x: -24, z: 39 }, { x: -8, z: 44 }, { x: 8, z: 44 }, { x: 24, z: 39 },
];
const FOE_SPOTS = [
  { x: -7, z: -12 }, { x: 7, z: -12 }, { x: -23, z: -8 }, { x: 23, z: -8 },
  { x: -13, z: 10 }, { x: 0, z: 14 }, { x: 13, z: 10 },
  { x: -21, z: 31 }, { x: 0, z: 36 }, { x: 21, z: 31 },
];

const ambient = {
  actors: [],
  ball: { x: 0, y: BALL_R, z: -6 },
  from: { x: 0, z: -6 },
  to: { x: 0, z: -6 },
  t: 1, dur: 1, holder: 0, wait: 0, passReceiver: -1, possessionTime: 0,
};
export const matchView = { mode: 'broadcast', speed: 1, simulatedSeconds: 0 };
let matchFrameDt = 0;
export const formation = { actors: ambient.actors, pressers: [null, null], attacker: null };

function selectPressers(bx, bz, team = 'away') {
  let first = null, second = null, firstD = Infinity, secondD = Infinity;
  for (const p of ambient.actors) {
    p.pressing = false;
    if (p.team !== team) continue;
    const d = (p.x - bx) ** 2 + (p.z - bz) ** 2;
    if (d < firstD) { second = first; secondD = firstD; first = p; firstD = d; }
    else if (d < secondD) { second = p; secondD = d; }
  }
  formation.pressers[0] = first;
  formation.pressers[1] = second;
  if (first) first.pressing = true;
  if (second) second.pressing = true;
}

// Each role keeps its own corridor. Ball-side compression is limited to four
// metres; a fullback on one wing cannot migrate to the opposite touchline.
function formationTarget(p, bx, bz) {
  if (p.team === 'ref') {
    let dx = p.x - bx, dz = p.z - bz;
    if (Math.hypot(dx, dz) < .01) { dx = bx > 0 ? -1 : 1; dz = 1; }
    if (p.x < -28 && dx < 0 || p.x > 28 && dx > 0) dx = -dx;
    if (p.z < GOAL.PLANE_Z + 7 && dz < 0 || p.z > GOAL.PLANE_Z + PITCH.LENGTH - 7 && dz > 0) dz = -dz;
    const length = Math.hypot(dx, dz);
    p.targetX = clamp(bx + dx / length * 8, -32, 32);
    p.targetZ = clamp(bz + dz / length * 8, GOAL.PLANE_Z + 2, GOAL.PLANE_Z + PITCH.LENGTH - 2);
    return;
  }
  p.targetX = clamp(p.home.x + clamp((bx - p.home.x) * .18, -4, 4),
    -PITCH.WIDTH / 2 + 2, PITCH.WIDTH / 2 - 2);
  p.targetZ = clamp(p.home.z + clamp((bz + 6) * .35, -12, 18),
    GOAL.PLANE_Z + 1.4, GOAL.PLANE_Z + PITCH.LENGTH - 2);
}

function initAmbient() {
  const add = (rig, home, team) => ambient.actors.push({
    rig, home, team, targetX: home.x, targetZ: home.z, chasing: false, pressing: false,
    x: home.x, z: home.z, previousX: home.x, previousZ: home.z,
    phase: Math.random() * 6.28, speed: 0, heading: 0, frameHeading: 0,
  });

  add(squad.striker, { x: 0, z: -9 }, 'home');
  squad.mates.forEach((m, i) => add(m, HOME_SPOTS[i], 'home'));
  squad.foes.forEach((f, i) => add(f, FOE_SPOTS[i], 'away'));
  add(squad.ref, { x: 9, z: -2 }, 'ref');
}

function pickReceiver() {
  const holder = ambient.actors[ambient.holder];
  let best = ambient.holder, bestScore = -Infinity;
  for (let i = 0; i < ambient.actors.length; i++) {
    const p = ambient.actors[i];
    if (p === holder || p.team !== holder.team) continue;
    const distance = Math.hypot(p.x - holder.x, p.z - holder.z);
    let space = 15;
    for (const opponent of ambient.actors) {
      if (opponent.team !== p.team && opponent.team !== 'ref') {
        space = Math.min(space, Math.hypot(opponent.x - p.x, opponent.z - p.z));
      }
    }
    const forward = (p.z - holder.z) * (holder.team === 'home' ? -1 : 1);
    const score = Math.random() * 12 + space + forward * .15 - distance * .25;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Walks every actor toward its target and plays the run cycle.
 * A `script` target (set during a build-up) overrides the loose shape-holding
 * and gets a higher top speed, because those players have somewhere to be.
 */
function moveActors(dt) {
  const a = ambient;
  selectPressers(a.ball.x, a.ball.z, matchFrameDt && a.actors[a.holder].team === 'away' ? 'home' : 'away');
  for (let i = 0; i < a.actors.length; i++) {
    const p = a.actors[i];
    const animation = p.rig === squad.striker ? captain : p.rig.avatar;
    if (animation?.passTime >= 0) {
      p.x = p.rig.root.position.x; p.z = p.rig.root.position.z; p.speed = 0;
      if (p.rig === squad.striker) captainSpeed = 0;
      continue;
    }
    p.heading = p.rig.root.rotation.y;
    const previousHeading = p.heading;
    let tx, tz, top;

    if (p.script) {
      tx = p.script.x; tz = p.script.z; top = p.script.top;
    } else if (p.pressing) {
      tx = clamp(a.ball.x, -32, 32); tz = clamp(a.ball.z, GOAL.PLANE_Z + 1.4, GOAL.PLANE_Z + PITCH.LENGTH - 1.4);
      top = Math.hypot(tx - p.x, tz - p.z) > 1.8 ? 5.4 : 0;
    } else if (p.team === 'ref') {
      formationTarget(p, a.ball.x, a.ball.z);
      tx = p.targetX; tz = p.targetZ; top = 3.4;
    } else if (i === a.holder && a.t >= 1) {
      tx = a.ball.x; tz = a.ball.z; top = 5.6;
    } else {
      formationTarget(p, a.ball.x, a.ball.z);
      tx = p.targetX; tz = p.targetZ;
      top = 1.45;
    }

    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    let v = d > 0.3 ? Math.min(top, d * 2.6) : 0;
    if (v > 0) v = moveActorForward(p, tx, tz, v * dt, dt) / Math.max(dt, .001);
    const response = captain && p.rig === squad.striker
      ? 1 - Math.exp(-STRIKER_SPEED_RESPONSE * dt) : Math.min(1, dt * 6);
    p.speed = p.rig === squad.striker ? lerp(p.speed, v, response) : v;
    if (p.speed >= MIN_GAIT_SPEED) p.phase += p.speed * dt * 2.1;

    p.rig.root.position.set(p.x, 0, p.z);
    setHeading(p.rig.root, p.heading);
    if (animation) animation.turnRate = Math.atan2(Math.sin(p.heading - previousHeading), Math.cos(p.heading - previousHeading)) / Math.max(dt, .001);
    if (captain && p.rig === squad.striker) { captainSpeed = p.speed; kickTime = -1; }
    else {
      poseRun(p.rig, p.phase, p.speed >= MIN_GAIT_SPEED ? clamp(p.speed / 4.5, 0, 1) : 0);
      if (p.rig.avatar) p.rig.avatar.speed = p.speed;
    }
  }
}

/** Wind up before a scheduled pass, aligning the same instep used for shots. */
function preparePassKick(actor, ballX, ballZ, targetX, targetZ) {
  const rig = actor.rig;
  const animation = rig === squad.striker ? captain : rig.avatar;
  if (!animation || Math.hypot(actor.x - ballX, actor.z - ballZ) > 1.5) return;
  const heading = Math.atan2(targetX - ballX, targetZ - ballZ);
  const foot = animation.data.kickFoot;
  const height = rig.root.scale.y, width = rig.avatar ? rig.avatar.model.scale.x : 1;
  const sin = Math.sin(heading), cos = Math.cos(heading);
  actor.heading = heading;
  setHeading(rig.root, heading);
  rig.root.position.set(ballX - (cos * foot.x * width + sin * foot.z) * height - sin * BALL_R,
    BALL_R - foot.y * height,
    ballZ - (-sin * foot.x * width + cos * foot.z) * height - cos * BALL_R);
  actor.x = rig.root.position.x; actor.z = rig.root.position.z;
  animation.passTime = 0;
  animation.turnTime = -1;
  animation.turnRate = 0;
  if (rig.avatar) {
    rig.avatar.procedural = false;
    rig.avatar.model.position.set(0, 0, 0);
    rig.avatar.model.quaternion.identity();
  }
}

/** Find an upright defender who can reach the loose ball with his boot. */
export function prepareClearance(position, velocity) {
  let nearest = null, best = 1.5;
  for (const p of ambient.actors) {
    const a = p.rig.avatar;
    if (p.team !== 'away' || !a || a.passTime >= 0
      || a.actions.slide_left.getEffectiveWeight() > .1 || a.actions.slide_right.getEffectiveWeight() > .1) continue;
    const d = Math.hypot(p.x - position.x, p.z - position.z);
    if (d < best) { nearest = p; best = d; }
  }
  if (!nearest) return null;
  const x = position.x + velocity.x * .28, z = position.z + velocity.z * .28;
  if (Math.hypot(nearest.x - x, nearest.z - z) > 1.5) return null;
  preparePassKick(nearest, x, z, x + (x >= 0 ? 12 : -12), z + 30);
  return nearest;
}

export function clearanceInReach(actor, position) {
  bipedBone(actor.rig.avatar.model, 'foot_R').getWorldPosition(_instep);
  bipedBone(actor.rig.avatar.model, 'toe_R').getWorldPosition(_toe);
  _instep.add(_toe).multiplyScalar(.5);
  return Math.hypot(_instep.x - position.x, _instep.y - position.y, _instep.z - position.z) < .6;
}

function updateAmbient(dt) {
  const a = ambient;
  a.possessionTime += dt;

  // --- ball: a chain of passes ---------------------------------------------
  if (a.t >= 1) {
    const holder = a.actors[a.holder];
    const atBall = Math.hypot(holder.x - a.ball.x, holder.z - a.ball.z) < 1.5;
    if (atBall) a.wait -= dt;
    if (a.wait <= .28 && a.passReceiver < 0) {
      a.passReceiver = pickReceiver();
      const receiver = a.actors[a.passReceiver];
      preparePassKick(a.actors[a.holder], a.ball.x, a.ball.z, receiver.x, receiver.z);
      a.wait = .28;
    }
    if (a.wait <= 0) {
      const next = a.passReceiver;
      const rx = a.actors[next];
      a.from.x = a.ball.x; a.from.z = a.ball.z;
      a.to.x = rx.x; a.to.z = rx.z;
      const dist = Math.hypot(a.to.x - a.from.x, a.to.z - a.from.z);
      a.dur = clamp(dist / 17, 0.25, 1.3);
      a.t = 0;
      a.holder = next;
      a.passReceiver = -1;
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
  // Close pressure can win possession during accelerated match play.
  if (matchFrameDt && a.possessionTime > 1.2 && a.ball.y < .6) {
    const team = a.actors[a.holder].team;
    for (let i = 0; i < a.actors.length; i++) {
      const p = a.actors[i];
      if (p.team === team || p.team === 'ref') continue;
      if (Math.hypot(p.x - a.ball.x, p.z - a.ball.z) < .8) {
        a.holder = i; a.passReceiver = -1; a.t = 1; a.wait = .65; a.possessionTime = 0;
        a.ball.y = BALL_R;
        break;
      }
    }
  }

  // Keeper shuffles his line, watching the ball.
  const kx = clamp(a.ball.x * 0.22, -3.2, 3.2);
  setKeeper(kx, 0, 1);
  setHeading(squad.keeper.root, 0, dt);
}

function positionHomeKeeper(dt) {
  const r = squad.homeKeeper;
  const bx = objects.ball.position.x, bz = objects.ball.position.z;
  const end = GOAL.PLANE_Z + PITCH.LENGTH;
  const response = 1 - Math.exp(-dt * 1.4);
  const previousX = r.root.position.x, previousZ = r.root.position.z;
  r.root.position.x = lerp(r.root.position.x, clamp(bx * .12, -2.5, 2.5), response);
  r.root.position.z = lerp(r.root.position.z, end - clamp((end - bz) * .08, 1.2, 6), response);
  const moveX = r.root.position.x - previousX, moveZ = r.root.position.z - previousZ;
  setHeading(r.root, Math.hypot(moveX, moveZ) > .00001
    ? Math.atan2(moveX, moveZ) : Math.atan2(bx - r.root.position.x, bz - r.root.position.z), dt);
  if (r.avatar) r.avatar.speed = Math.hypot(r.root.position.x - previousX,
    r.root.position.z - previousZ) / Math.max(dt, .001);
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
  camCut: false, passLeg: -1,
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
  if (matchView.mode === 'overhead') {
    matchView.mode = 'approach';
    matchView.speed = 1;
    aimCameraAt(origin);
    buildup.camCut = true;
  }
  buildup.passLeg = -1;
  a.passReceiver = -1;
  for (const actor of a.actors) {
    const animation = actor.rig === squad.striker ? captain : actor.rig.avatar;
    if (animation) animation.passTime = -1;
  }
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
    // Arrive before the ball, leaving time to decelerate and plant for a kick.
    const arrival = buildup.dur * (i + 1) / (Math.min(2, mates.length) + 1);
    seedRun(c, spots[i].x, spots[i].z, Math.max(.08, arrival - .78), 6.6);
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
    buildup.legT -= buildup.legDur;
    buildup.from.x = buildup.to.x; buildup.from.z = buildup.to.z;
    const next = buildup.carriers[buildup.leg];
    // The final leg always targets the shooting spot itself.
    buildup.to.x = next ? next.script.x : buildup.origin.x;
    buildup.to.z = next ? next.script.z : buildup.origin.z;
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

  if (buildup.leg < buildup.carriers.length && buildup.passLeg !== buildup.leg
    && buildup.legDur - buildup.legT <= .28) {
    const next = buildup.carriers[buildup.leg + 1];
    preparePassKick(buildup.carriers[buildup.leg], buildup.to.x, buildup.to.z,
      next ? next.script.x : buildup.origin.x, next ? next.script.z : buildup.origin.z);
    buildup.passLeg = buildup.leg;
  }

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

/** Turn before translating; forward gait displacement follows the new heading. */
export function moveActorForward(actor, targetX, targetZ, step, dt) {
  const dx = targetX - actor.x, dz = targetZ - actor.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .000001 || dt <= 0) return 0;
  const want = Math.atan2(dx, dz);
  actor.heading = tweenHeading(actor.heading, want, dt);
  const alignment = Math.cos(want - actor.heading);
  // A large change is a planted turn. Translation starts only after the
  // rotation tween reaches the instant-correction range.
  if (alignment < MOVE_ALIGNMENT) return 0;
  const travel = Math.min(step, distance) * alignment;
  actor.x += Math.sin(actor.heading) * travel;
  actor.z += Math.cos(actor.heading) * travel;
  return travel;
}

/** Small corrections snap into place. Larger turns rotate linearly, with a
 * complete half-turn taking no more than a quarter-second. */
function tweenHeading(current, wanted, dt) {
  const delta = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current));
  if (Math.abs(delta) <= INSTANT_TURN_ANGLE || dt <= 0) return wanted;
  const step = TURN_RATE * dt;
  return current + clamp(delta, -step, step);
}

/** Player roots are yaw-only. Assigning just Euler.y after a quaternion copy
 * can retain Three's equivalent X/Z = PI representation and reverse the
 * rendered body while the numeric heading still appears correct. */
function setHeading(root, heading, dt = 0) {
  root.rotation.set(0, tweenHeading(root.rotation.y, heading, dt), 0);
}

/**
 * Nearby players follow a loose rebound; everyone else walks with the team
 * shape. The launch itself does not send the whole formation after the ball.
 */
export function watchBall(dt, live, rebound = false, pursuit = null, strikerReady = false, freePlay = false) {
  const bx = objects.ball.position.x;
  const bz = objects.ball.position.z;
  // Active blockers also participate; their app-driven block pose must not
  // exclude the nearest defenders from closing down a loose ball.
  for (const p of ambient.actors) {
    p.x = p.rig.root.position.x;
    p.z = p.rig.root.position.z;
    p.previousX = p.x;
    p.previousZ = p.z;
    if (!live) p.chasing = false;
  }
  selectPressers(bx, bz);
  formation.attacker = null;
  let attackerDistance = pursuit?.attackerRange ?? 18;
  for (const p of ambient.actors) {
    if (p.team !== 'home' || (p.rig === squad.striker && (!strikerReady || reactions.shooter?.name || celebration.name))
      || p.rig.avatar?.passTime >= 0) continue;
    const distance = Math.hypot(bx - p.x, bz - p.z);
    if (distance < attackerDistance) { formation.attacker = p; attackerDistance = distance; }
  }

  for (const p of ambient.actors) {
    if (defenderReactions.active && p.rig.avatar?.goalWalk) continue;
    if (p.rig === squad.striker && (celebration.name || reactions.shooter?.name || !strikerReady || p !== formation.attacker)) { p.chasing = false; continue; }
    if (p.rig.avatar?.passTime >= 0) continue;
    let involved = false;
    for (let i = 0; i < chance.blockerCount; i++) {
      if (blockerSets[i].rig === p.rig) { involved = true; break; }
    }
    if (involved && !freePlay && !(live && p.pressing)) continue;

    p.heading = p.rig.root.rotation.y;
    p.frameHeading = p.heading;
    const previousHeading = p.heading;
    let turnedForMovement = false;
    let want = Math.atan2(bx - p.x, bz - p.z);
    formationTarget(p, bx, bz);
    const distance = Math.hypot(bx - p.x, bz - p.z);
    const inPlay = Math.abs(bx) < PITCH.WIDTH / 2 && bz > GOAL.PLANE_Z
      && bz < GOAL.PLANE_Z + PITCH.LENGTH;
    p.chasing = live && inPlay && (p.pressing || p === formation.attacker || (rebound && p.team !== 'ref'
      && distance < (p.chasing ? 10 : 7)
      && Math.hypot(bx - p.targetX, bz - p.targetZ) < 12));
    if (p.chasing) {
      p.targetX = bx;
      p.targetZ = Math.max(bz, GOAL.PLANE_Z + 1.4);
    }
    if (live || p.team === 'ref') {
      const dx = p.targetX - p.x, dz = p.targetZ - p.z;
      const d = Math.hypot(dx, dz);
      const urgent = p.chasing && (p === formation.pressers[0] || p === formation.attacker);
      const keepOff = p.chasing ? (urgent ? .65 : p.team === 'away' ? 1.0 : 1.8) : .35;
      if (d > keepOff) {
        const top = p.team === 'ref' && distance < 6 ? 3.4
          : urgent ? (pursuit?.sprintSpeed ?? 7.2) : p.chasing ? 5.4 : lerp(1.45, .65, clamp(distance / 45, 0, 1));
        const step = urgent ? Math.min(d - keepOff, top * dt)
          : Math.min(d - keepOff, top * dt, (d - keepOff) * (1 - Math.exp(-1.6 * dt)));
        p.speed = moveActorForward(p, p.targetX, p.targetZ, step, dt) / Math.max(dt, .001);
        turnedForMovement = true;
        want = Math.atan2(dx, dz);
      } else {
        p.speed = lerp(p.speed, 0, Math.min(1, dt * 7));
      }
    } else {
      p.speed = lerp(p.speed, 0, Math.min(1, dt * 4));
    }
    if (!turnedForMovement) p.heading = tweenHeading(p.heading, want, dt);
    if (p.rig.avatar) {
      p.rig.avatar.passTime = -1;
      p.rig.avatar.turnRate = Math.atan2(Math.sin(p.heading - previousHeading), Math.cos(p.heading - previousHeading)) / Math.max(dt, .001);
    }

    // A stationary player must hold an idle pose. Advancing a minimum gait
    // phase made the procedural fallback visibly walk on the spot.
    if (p.speed >= MIN_GAIT_SPEED) p.phase += p.speed * dt * 2.1;
  }

  separate(dt);

  for (const p of ambient.actors) {
    if (defenderReactions.active && p.rig.avatar?.goalWalk) continue;
    if (p.rig === squad.striker && (celebration.name || reactions.shooter?.name || !strikerReady || p !== formation.attacker)) continue;
    if (p.rig.avatar?.passTime >= 0) continue;
    let involved = false;
    for (let i = 0; i < chance.blockerCount; i++) {
      if (blockerSets[i].rig === p.rig) { involved = true; break; }
    }
    if (involved && !freePlay && !(live && p.pressing)) continue;
    // Spacing nudges also need forward-facing footsteps.
    p.speed = Math.hypot(p.x - p.previousX, p.z - p.previousZ) / Math.max(dt, .001);
    if (p.speed > .00001) {
      const motionHeading = Math.atan2(p.x - p.previousX, p.z - p.previousZ);
      p.heading = tweenHeading(p.frameHeading, motionHeading, dt);
    }
    p.rig.root.position.set(p.x, 0, p.z);
    setHeading(p.rig.root, p.heading);
    poseRun(p.rig, p.phase, p.speed >= MIN_GAIT_SPEED ? clamp(p.speed / 4.5, 0, 1) : 0);
    if (p.rig.avatar) p.rig.avatar.speed = p.speed;
    if (p.rig === squad.striker && captain) { captainSpeed = p.speed; kickTime = -1; }
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
  setHeading(k.root, want, dt);
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
  camera.up.set(0, 1, 0);
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
  matchView.mode = 'chance';
  matchView.speed = 1;
  releaseNetPockets();
  formation.pressers[0] = formation.pressers[1] = null;
  formation.attacker = null;
  for (const p of ambient.actors) { p.pressing = false; p.chasing = false; }
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

    for (const p of ambient.actors) {
      if (p.rig === squad.striker) continue;
      if (blockerSets.slice(0, chance.blockerCount).some((b) => b.rig === p.rig)) continue;
      formationTarget(p, origin.x, origin.z);
      p.x = p.targetX;
      p.z = p.targetZ;
      p.chasing = false;
      p.speed = 0;
      p.rig.root.position.set(p.x, 0, p.z);
      setHeading(p.rig.root, Math.atan2(origin.x - p.x, origin.z - p.z));
      poseRun(p.rig, 0, 0.12);
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
    setHeading(rig.root, Math.atan2(-chance.dirX, -chance.dirZ));
    chance.blockers.push({ z: rig.root.position.z, baseX: rig.root.position.x, side: 1 });
    setBlocker(i, rig.root.position.x, 0, 1);

    // Keep the ambient actor in step, or he snaps back when play resumes.
    const actor = ambient.actors.find((p) => p.rig === rig);
    if (actor) { actor.x = rig.root.position.x; actor.z = rig.root.position.z; actor.speed = 0; }
  }

  aimCameraAt(origin);
  // Chance placement is a scene reset, even when a rig moves less than 2m.
  for (const player of players) {
    player.motionX = player.root.position.x;
    player.motionZ = player.root.position.z;
  }
}

/** Restores the wide broadcast framing used while the match simulates. */
export function frameAmbient(topDown = false) {
  releaseNetPockets();
  matchView.mode = topDown ? 'overhead' : 'broadcast';
  matchView.speed = 1;
  camera.up.set(0, 1, 0);
  _camHome.set(0, 13.5, 11);
  _camTargetWant.set(0, 0, GOAL.PLANE_Z + 7);
  if (topDown) {
    // Rotate the overhead view so the long axis uses a landscape screen's
    // width. Fitting the 68 m pitch width vertically also lowers the camera.
    camera.up.set(1, 0, 0);
    const halfFov = Math.tan(camera.fov * Math.PI / 360);
    const height = Math.max((PITCH.WIDTH + 12) / (2 * halfFov),
      (PITCH.LENGTH + 12) / (2 * halfFov * camera.aspect));
    _camTargetWant.set(0, 0, GOAL.PLANE_Z + PITCH.LENGTH / 2);
    _camHome.set(0, height, _camTargetWant.z);
    camera.far = Math.max(300, height + 100);
    camera.updateProjectionMatrix();
    camera.position.copy(_camHome);
    _camTarget.copy(_camTargetWant);
    camera.lookAt(_camTarget);
    shakeAmp = 0;
    // Resume from the live positions left by the shot and its reactions.
    let nearest = 0, distance = Infinity;
    ambient.ball.x = clamp(objects.ball.position.x, -32, 32);
    ambient.ball.z = clamp(objects.ball.position.z, GOAL.PLANE_Z + 2, GOAL.PLANE_Z + PITCH.LENGTH - 2);
    ambient.ball.y = BALL_R;
    for (let i = 0; i < ambient.actors.length; i++) {
      const p = ambient.actors[i];
      p.x = p.rig.root.position.x; p.z = p.rig.root.position.z;
      p.heading = p.rig.root.rotation.y;
      p.script = null;
      const a = p.rig === squad.striker ? captain : p.rig.avatar;
      if (a) a.passTime = -1;
      const d = Math.hypot(p.x - ambient.ball.x, p.z - ambient.ball.z);
      if (p.team !== 'ref' && d < distance) { distance = d; nearest = i; }
    }
    ambient.holder = nearest; ambient.passReceiver = -1; ambient.t = 1; ambient.wait = .65;
  }
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
  cachePausePoses();
  buildBall();
  buildAimRig();

  keeperSet = makeCapsuleSet(squad.keeper);
  for (let i = 0; i < 2; i++) blockerSets.push(makeCapsuleSet(squad.foes[i], false));

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

let animationsPaused = false;
const pausePoses = [];
let pauseCaptured = false;
function cachePausePoses() {
  pausePoses.length = 0;
  for (const rig of [squad.keeper, squad.homeKeeper, squad.striker, ...squad.mates, ...squad.foes, squad.ref]) {
    rig.root.traverse(node => pausePoses.push({ node, root: node === rig.root, position: node.position.clone(),
      quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  }
  pauseCaptured = false;
}

// Chance placement can change root positions, but selection should retain the
// animation pose from the build-up, rather than sample a new idle or kick pose.
export function captureSelectionPoses() {
  pauseCaptured = false;
  holdPlayerPoses();
}

export function restoreSelectionPoses() {
  for (const pose of pausePoses) {
    if (pose.root) continue;
    pose.node.position.copy(pose.position);
    pose.node.quaternion.copy(pose.quaternion);
    pose.node.scale.copy(pose.scale);
  }
  pauseCaptured = false;
}

const _selectionLeft = new THREE.Vector3();
const _selectionRight = new THREE.Vector3();
const _selectionUp = new THREE.Vector3(0, 1, 0);
const _selectionTurn = new THREE.Quaternion();
const _selectionParent = new THREE.Quaternion();
export function faceStrikerForSelection() {
  // The frozen turn clip can contain torso yaw in addition to the root heading.
  // Align that actual torso before freezing, retaining its limb articulation.
  placeStrikerForKick(Math.atan2(chance.dirX, -chance.dirZ));
  if (!captain) return;
  const hips = bipedBone(captain.model, 'hips');
  const left = captain.model.getObjectByName('mixamorigLeftShoulder');
  const right = captain.model.getObjectByName('mixamorigRightShoulder');
  if (!hips || !left || !right) return;
  left.getWorldPosition(_selectionLeft);
  right.getWorldPosition(_selectionRight);
  _selectionLeft.sub(_selectionRight);
  const facing = Math.atan2(-_selectionLeft.z, _selectionLeft.x);
  const wanted = Math.atan2(chance.dirX, chance.dirZ);
  _selectionTurn.setFromAxisAngle(_selectionUp, wanted - facing);
  hips.parent.getWorldQuaternion(_selectionParent);
  _selectionTurn.multiply(_selectionParent);
  _selectionParent.invert().multiply(_selectionTurn);
  hips.quaternion.premultiply(_selectionParent);
  hips.updateWorldMatrix(false, true);
  pauseCaptured = false;
}

export function setAnimationsPaused(paused) {
  if (paused === animationsPaused) return;
  animationsPaused = paused;
  pauseCaptured = false;
  if (captain) captain.mixer.timeScale = paused ? 0 : 1;
  for (const player of players) if (player.rig.avatar) player.rig.avatar.mixer.timeScale = paused ? 0 : 1;
  if (paused) holdPlayerPoses();
}

function holdPlayerPoses() {
  for (const pose of pausePoses) {
    // Roots do not move during AIM/POWER. Re-copying a yaw quaternion rewrites
    // its Euler form near a half-turn to X/Z = PI; a later Y-only update then
    // makes a forward gait face backward.
    if (pose.root) continue;
    if (!pauseCaptured) {
      pose.position.copy(pose.node.position);
      pose.quaternion.copy(pose.node.quaternion);
      pose.scale.copy(pose.node.scale);
    } else {
      pose.node.position.copy(pose.position);
      pose.node.quaternion.copy(pose.quaternion);
      pose.node.scale.copy(pose.scale);
    }
  }
  pauseCaptured = true;
}

function tick() {
  // Single delta source: every consumer scales its displacement against this.
  const dt = Math.min(clock.getDelta(), 0.05);
  matchFrameDt = 0;
  if (frameCb) frameCb(dt);
  if (!animationsPaused) {
    crowdTime.value += dt;
    crowdCheer.value = Math.max(0, crowdCheer.value - dt * .18);
    const playerDt = matchFrameDt || dt;
    if (!matchFrameDt) positionHomeKeeper(dt);
    syncPlayerLocomotion(playerDt);
    animateCaptain(playerDt);
    animateSquad(playerDt);
    updateNets(dt);
  }
  if (animationsPaused) holdPlayerPoses();
  captureLaunch();

  _camWant.copy(_camHome);
  if (shakeAmp > 0.001) {
    shakeAmp = Math.max(0, shakeAmp - dt * 2.6);
    _camWant.x += (Math.random() - 0.5) * shakeAmp;
    _camWant.y += (Math.random() - 0.5) * shakeAmp;
  }
  camera.position.lerp(_camWant, Math.min(1, dt * 3.2));
  _camTarget.lerp(_camTargetWant, Math.min(1, dt * 3.2));
  camera.lookAt(_camTarget);

  // Keep the pitch visible above the normal low broadcast camera's fog range.
  const fogLift = Math.max(0, camera.position.y - 13.5);
  scene.fog.near = 60 + fogLift;
  scene.fog.far = 150 + fogLift;
  renderer.render(scene, camera);
}

export const onFrame = (cb) => { frameCb = cb; };
export const shake = (amp) => { shakeAmp = Math.max(shakeAmp, amp); };
export const runAmbient = (dt) => updateAmbient(dt);

/** Small movement steps at accelerated time; sample skeletons once per render. */
export function runMatchSimulation(dt, speed) {
  matchFrameDt = dt * speed;
  matchView.speed = speed;
  matchView.simulatedSeconds += matchFrameDt;
  let remaining = matchFrameDt;
  while (remaining > .000001) {
    const step = Math.min(1 / 60, remaining);
    for (const p of ambient.actors) {
      const a = p.rig === squad.striker ? captain : p.rig.avatar;
      if (a?.passTime >= 0) passClipTime(a, step);
    }
    updateAmbient(step);
    positionHomeKeeper(step);
    remaining -= step;
  }
}

/** Pan and orbit gently behind a rebound, using the same smoothed camera rig. */
export function followReboundCamera(dt) {
  const ball = objects.ball.position;
  const x = clamp(ball.x, -PITCH.WIDTH / 2, PITCH.WIDTH / 2);
  const z = clamp(ball.z, GOAL.PLANE_Z - 2, GOAL.PLANE_Z + PITCH.LENGTH);
  const side = clamp((x - chance.origin.x) / 18, -1, 1);
  const response = 1 - Math.exp(-dt * 2);
  _camHome.x = lerp(_camHome.x, x - side * 8, response);
  _camHome.y = lerp(_camHome.y, Math.max(6.5, ball.y + 4), response);
  _camHome.z = lerp(_camHome.z, z + 15, response);
  _camTargetWant.set(x, Math.max(1, ball.y), z);
}

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
  setHeading(s.root, face);
  if (captain) {
    placeStrikerContact(theta);
    return;
  }
  s.root.position.set(
    objects.ball.position.x - rx * FOOT_SIDE - fx * FOOT_FWD, 0,
    objects.ball.position.z - rz * FOOT_SIDE - fz * FOOT_FWD);
}

/** Align the instep behind the selected shot without changing his facing.
 * Called only once aiming is over, and again for a launch-angle modifier.
 */
export function placeStrikerContact(theta) {
  if (!captain) return;
  const root = squad.striker.root;
  const foot = captain.data.kickFoot;
  const sin = Math.sin(root.rotation.y), cos = Math.cos(root.rotation.y);
  root.position.set(
    objects.ball.position.x - cos * foot.x - sin * foot.z - Math.sin(theta) * BALL_R,
    objects.ball.position.y - foot.y,
    objects.ball.position.z + sin * foot.x - cos * foot.z + Math.cos(theta) * BALL_R);
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
  if (captain) setStrikerSwing(0);
  const all = [squad.keeper, squad.striker, ...squad.mates, ...squad.foes, squad.homeKeeper, squad.ref];
  const from = offset || 0;
  const n = count || all.length;
  const shown = all.slice(from, from + n);

  for (const rig of all) rig.root.position.set(0, -50, 0);
  shown.forEach((rig, i) => {
    const x = (i - (shown.length - 1) / 2) * (n > 6 ? 1.75 : 1.15);
    rig.root.position.set(x, 0, GOAL.PLANE_Z + 9);
    setHeading(rig.root, 0);           // rigs face +Z by default
    if (rig.avatar) { rig.avatar.passTime = -1; rig.avatar.turnTime = -1; rig.avatar.turnRate = 0; }
    poseRun(rig, 0, 0.1);
  });

  const back = n > 6 ? 26 : 6.8;
  _camHome.set(0, 1.6, GOAL.PLANE_Z + 9 + back);
  _camTargetWant.set(0, 1.55, GOAL.PLANE_Z + 9);
  camera.position.copy(_camHome);
  _camTarget.copy(_camTargetWant);
}

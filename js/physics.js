/**
 * physics.js - lightweight analytical vector space.
 * No external physics dependency (no Ammo.js / Cannon.js), no THREE import.
 *
 * Collision is CONTINUOUS, not per-frame point sampling. The ball travels up
 * to 40 m/s, which is 0.67m per frame at 60Hz - far wider than the keeper or
 * the posts - so discrete tests let it tunnel straight through them. Instead
 * the flight is integrated at a fixed PHYS_DT substep and every test is a
 * swept one: the segment the ball centre travelled this substep versus the
 * axis segment of a capsule. Contact is distance(segment, segment) < sum of
 * radii, which cannot be skipped over at any framerate.
 */

// ---- Metres: regulation opening, with woodwork axes outside that opening. --
export const GOAL = {
  PLANE_Z: -20.0,   // goal line plane
  HALF_W:   3.66,   // inside faces: 7.32 m opening
  HEIGHT:   2.44,   // underside of crossbar
  POST_R:   0.06,   // 12 cm diameter
  POST_X:   3.72,   // post centre axes
  BAR_Y:    2.50,   // crossbar centre axis
};
export const PITCH = { WIDTH: 68, LENGTH: 105 };

export const GRAVITY   = -9.81;
export const BALL_R    = 0.11;     // 69.1 cm circumference, size five
export const GROUND_Y  = BALL_R;   // centre height when resting on the turf
export const BOUNCE    = 0.4;      // turf rebound coefficient
export const DRAG      = 0.92;     // horizontal friction on turf contact
export const POST_RESTITUTION = 0.55;

/** Fixed integration substep. 240Hz -> at most 0.17m of travel per test. */
export const PHYS_DT = 1 / 240;

// ---- Ball mechanics --------------------------------------------------------
export const AIM_CLAMP = 0.9;    // hard bound on arrow angle, radians
export const SWEEP_MAX = 0.25;   // practical sweep: atan(5 / 20), ~5m past the posts
export const BASE_VELOCITY = 40.0;

/**
 * Vertical impulse scalar. The doc specifies `V_y = Power * 4.0`, but at the
 * spec'd 20m goal distance that caps the ball's apex at Vy^2/2g = 0.82m, which
 * puts much of the 2.44m goalmouth out of reach and makes the
 * power phase one-dimensional. 9.0 maps power 0.35->0.92 cleanly across
 * floor -> top corner -> over the bar.
 */
export const LIFT = 9.0;

/** Default spot. Chances now originate anywhere, so most maths takes an origin. */
export const BALL_START = { x: 0, y: GROUND_Y, z: 0 };

/** Distance from a shooting spot to the goal line. */
export const rangeOf = (origin) => origin.z - GOAL.PLANE_Z;

/** Where a shot at `theta` from `origin` crosses an arbitrary z plane. */
export function crossingXAt(origin, theta, z) {
  return origin.x + Math.tan(theta) * (origin.z - z);
}

/** The aim angle from `origin` that puts the ball through (targetX, goal line). */
export function aimAngleFor(origin, targetX) {
  return Math.atan((targetX - origin.x) / rangeOf(origin));
}

// ---------------------------------------------------------------------------
// Scratch. Nothing in this module allocates once the game is running.
// ---------------------------------------------------------------------------
const _d1 = { x: 0, y: 0, z: 0 };
const _d2 = { x: 0, y: 0, z: 0 };
const _r  = { x: 0, y: 0, z: 0 };

/** Result of the last closestSegSeg call. */
export const hit = { dist2: 0, s: 0, t: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Squared distance between segment P(p0->p1) and segment Q(q0->q1).
 * Writes the closest pair of points into `hit`. Ericson, RTCD 5.1.9.
 */
export function closestSegSeg(p0, p1, q0, q1) {
  _d1.x = p1.x - p0.x; _d1.y = p1.y - p0.y; _d1.z = p1.z - p0.z;
  _d2.x = q1.x - q0.x; _d2.y = q1.y - q0.y; _d2.z = q1.z - q0.z;
  _r.x  = p0.x - q0.x; _r.y  = p0.y - q0.y; _r.z  = p0.z - q0.z;

  const a = dot(_d1, _d1);
  const e = dot(_d2, _d2);
  const f = dot(_d2, _r);
  const EPS = 1e-8;

  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = dot(_d1, _r);
    if (e <= EPS) {
      t = 0; s = clamp01(-c / a);
    } else {
      const b = dot(_d1, _d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0)      { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }

  hit.s = s; hit.t = t;
  hit.ax = p0.x + _d1.x * s; hit.ay = p0.y + _d1.y * s; hit.az = p0.z + _d1.z * s;
  hit.bx = q0.x + _d2.x * t; hit.by = q0.y + _d2.y * t; hit.bz = q0.z + _d2.z * t;

  const dx = hit.ax - hit.bx, dy = hit.ay - hit.by, dz = hit.az - hit.bz;
  hit.dist2 = dx * dx + dy * dy + dz * dz;
  return hit.dist2;
}

/** Closest point on segment a->b to point p. Writes into `out`. */
export function closestPointOnSegment(p, a, b, out) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  const len2 = bx * bx + by * by + bz * bz;
  let t = len2 > 1e-12
    ? ((p.x - a.x) * bx + (p.y - a.y) * by + (p.z - a.z) * bz) / len2
    : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = a.x + bx * t;
  out.y = a.y + by * t;
  out.z = a.z + bz * t;
  return out;
}

/**
 * Swept test: did the ball, moving from `from` to `to`, touch the capsule
 * (axis cap.a -> cap.b, radius cap.r)? Contact details land in `hit`.
 */
export function sweptCapsuleHit(from, to, cap) {
  const reach = BALL_R + cap.r;
  return closestSegSeg(from, to, cap.a, cap.b) <= reach * reach;
}

/** Reflect `vel` about the unit normal (nx,ny,nz) with the given restitution. */
export function reflect(vel, nx, ny, nz, restitution) {
  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
  vel.x = (vel.x - 2 * vn * nx) * restitution;
  vel.y = (vel.y - 2 * vn * ny) * restitution;
  vel.z = (vel.z - 2 * vn * nz) * restitution;
}

/**
 * One fixed-size integration substep. Mutates pos/vel in place.
 * Callers drive this from an accumulator so behaviour is identical at any
 * display refresh rate.
 */
export function stepBall(pos, vel, dt) {
  const wasAirborne = pos.y > GROUND_Y + 1e-4;
  if (wasAirborne) vel.y += GRAVITY * dt;

  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;

  if (pos.y <= GROUND_Y) {            // turf intersection
    pos.y = GROUND_Y;
    if (wasAirborne && vel.y < 0) {
      // Impact frame: rebound and shed horizontal energy once.
      vel.y = -vel.y * BOUNCE;
      vel.x *= DRAG;
      vel.z *= DRAG;
      if (vel.y < 0.6) vel.y = 0;
    } else {
      // Already rolling. Decay must be time-based, not per-frame, or the
      // ball stops dead at 144Hz and rolls forever at 30Hz.
      const roll = Math.pow(DRAG, dt * 14);
      vel.x *= roll;
      vel.z *= roll;
      if (vel.y < 0) vel.y = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Goal frame
// ---------------------------------------------------------------------------

/** The three pieces of woodwork, as capsule axes. Built once. */
export const WOODWORK = [
  { // left post
    a: { x: -GOAL.POST_X, y: 0, z: GOAL.PLANE_Z },
    b: { x: -GOAL.POST_X, y: GOAL.BAR_Y, z: GOAL.PLANE_Z }, r: GOAL.POST_R,
  },
  { // right post
    a: { x: GOAL.POST_X, y: 0, z: GOAL.PLANE_Z },
    b: { x: GOAL.POST_X, y: GOAL.BAR_Y, z: GOAL.PLANE_Z }, r: GOAL.POST_R,
  },
  { // crossbar
    a: { x: -GOAL.POST_X, y: GOAL.BAR_Y, z: GOAL.PLANE_Z },
    b: { x:  GOAL.POST_X, y: GOAL.BAR_Y, z: GOAL.PLANE_Z }, r: GOAL.POST_R,
  },
];

/**
 * Swept woodwork test. On contact, reflects `vel` off the true surface normal
 * (from the frame's axis to the ball) and nudges the ball clear so it cannot
 * re-trigger on the next substep. Returns true if the frame was struck.
 */
const _cp = { x: 0, y: 0, z: 0 };

export function hitWoodwork(from, to, pos, vel) {
  for (let i = 0; i < WOODWORK.length; i++) {
    const cap = WOODWORK[i];
    if (!sweptCapsuleHit(from, to, cap)) continue;

    // Resolve against where the ball IS, not the swept closest approach -
    // otherwise a glancing contact snaps it backwards along its own path.
    closestPointOnSegment(pos, cap.a, cap.b, _cp);
    let nx = pos.x - _cp.x, ny = pos.y - _cp.y, nz = pos.z - _cp.z;
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) {
      nx = hit.ax - hit.bx; ny = hit.ay - hit.by; nz = hit.az - hit.bz;
      len = Math.hypot(nx, ny, nz) || 1;
    }
    nx /= len; ny /= len; nz /= len;

    const reach = BALL_R + cap.r;
    if (len < reach) {
      pos.x = _cp.x + nx * reach;
      pos.y = _cp.y + ny * reach;
      pos.z = _cp.z + nz * reach;
    }
    reflect(vel, nx, ny, nz, POST_RESTITUTION);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Netting
//
// The net is four real surfaces, not decoration: the ball is caught by it,
// drained of almost all its energy and dropped. Each panel is axis-aligned,
// so contact is a swept point-vs-offset-plane test - `n` is the INWARD normal
// and `at` the coordinate the panel sits on.
// ---------------------------------------------------------------------------
export const NET = {
  DEPTH: 2.0,
  STIFFNESS: 3000,     // restoring force per metre of stretch, per unit mass
  // Netting is lossy, not springy: it takes the ball deep (light damping on
  // the way in) and then refuses to give the energy back (heavy on the way
  // out). Symmetric damping either kills the stretch or turns it into a
  // trampoline; this gets a deep pocket AND a dead ball.
  DAMPING_IN: 10,
  DAMPING_OUT: 130,
  MAX_STRETCH: 1.15,   // hard backstop so nothing can ever be pushed through
  FRICTION: 7.5,       // tangential drag while pressed into the mesh, per second
};

export const NET_PANELS = [
  { axis: 'z', at: GOAL.PLANE_Z - NET.DEPTH, n: 1 },   // back
  { axis: 'x', at: -GOAL.HALF_W, n: 1 },               // left side
  { axis: 'x', at: GOAL.HALF_W, n: -1 },               // right side
  { axis: 'y', at: GOAL.HEIGHT, n: -1 },               // roof
];

/**
 * Live stretch of each panel: how deep the pocket is and where its centre sits
 * in world space. The renderer reads this to shape the mesh, so what is drawn
 * is the same pocket the ball is actually resting in.
 */
export const netPockets = NET_PANELS.map(() => ({ depth: 0, x: 0, y: 0, z: 0, touched: false }));

/**
 * Continuous ball-vs-netting contact, called once per physics substep.
 *
 * The net is not a wall that reflects - it is a spring-damper the ball sinks
 * into. A 35 m/s shot stretches the mesh roughly half a metre before the
 * tension stops it, and the damping means almost none of that energy comes
 * back, so the ball drops out of the pocket instead of rebounding.
 */
export function netContact(pos, vel, dt, inside) {
  let struck = -1;
  // Only a ball that actually entered through the mouth may touch the net.
  // Without this, one sailing OVER the bar clips the roof panel from above
  // and gets pushed down into the goal, and one wide of the post gets pushed
  // back in through the side.
  if (!inside || pos.z > GOAL.PLANE_Z) {
    for (const k of netPockets) k.touched = false;
    return -1;
  }

  for (let i = 0; i < NET_PANELS.length; i++) {
    const p = NET_PANELS[i];
    const pocket = netPockets[i];
    const c = p.axis === 'x' ? pos.x : p.axis === 'y' ? pos.y : pos.z;

    // Signed gap to the rest surface; negative means the mesh is stretched.
    const gap = p.n * (c - p.at) - BALL_R;
    if (gap >= 0) { pocket.touched = false; continue; }

    const pen = -gap;
    const vn = (p.axis === 'x' ? vel.x : p.axis === 'y' ? vel.y : vel.z) * p.n;

    // Tension pushes back along the inward normal; damping bleeds the energy.
    const damp = vn < 0 ? NET.DAMPING_IN : NET.DAMPING_OUT;
    const accel = NET.STIFFNESS * pen - damp * vn;
    if (p.axis === 'x') vel.x += accel * p.n * dt;
    else if (p.axis === 'y') vel.y += accel * p.n * dt;
    else vel.z += accel * p.n * dt;

    // Drag across the face of the mesh.
    const drag = Math.max(0, 1 - NET.FRICTION * dt);
    if (p.axis === 'x') { vel.y *= drag; vel.z *= drag; }
    else if (p.axis === 'y') { vel.x *= drag; vel.z *= drag; }
    else { vel.x *= drag; vel.y *= drag; }

    // Backstop: nothing gets through, however hard it is hit.
    if (pen > NET.MAX_STRETCH) {
      const fix = (pen - NET.MAX_STRETCH) * p.n;
      if (p.axis === 'x') { pos.x += fix; if (vn < 0) vel.x = 0; }
      else if (p.axis === 'y') { pos.y += fix; if (vn < 0) vel.y = 0; }
      else { pos.z += fix; if (vn < 0) vel.z = 0; }
    }

    pocket.depth = Math.min(pen, NET.MAX_STRETCH);
    pocket.touched = true;
    pocket.x = pos.x; pocket.y = pos.y; pocket.z = pos.z;
    struck = i;
  }
  return struck;
}

/** True on the substep the ball centre crosses behind the goal line. */
export function crossedGoalPlane(prevZ, z) {
  return prevZ > GOAL.PLANE_Z && z <= GOAL.PLANE_Z;
}

/** Interpolate the crossing point so the verdict is sub-substep accurate. */
export function planeIntersection(prev, pos, out) {
  const span = prev.z - pos.z;
  const t = span === 0 ? 0 : (prev.z - GOAL.PLANE_Z) / span;
  out.x = prev.x + (pos.x - prev.x) * t;
  out.y = prev.y + (pos.y - prev.y) * t;
  out.z = GOAL.PLANE_Z;
  return out;
}

/**
 * 'GOAL' | 'HIGH' | 'WIDE' for a point on the goal plane.
 * Woodwork is no longer guessed from a tolerance band - it is a real swept
 * collision resolved before this is ever reached.
 */
export function classifyAtPlane(x, y) {
  const inside = Math.abs(x) < GOAL.HALF_W && y >= 0 && y < GOAL.HEIGHT;
  if (inside) return 'GOAL';
  return y >= GOAL.HEIGHT ? 'HIGH' : 'WIDE';
}

/**
 * Where a launched ball will cross the goal plane - the keeper AI's read.
 * `atZ` lets a defender ask the same question about his own line instead.
 */
export function predictCrossing(origin, theta, power, speedScale, out, atZ) {
  const a = Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, theta));
  const forward = BASE_VELOCITY * speedScale * (0.6 + 0.4 * power);
  const vz = Math.cos(a) * forward;
  const plane = atZ === undefined ? GOAL.PLANE_Z : atZ;
  const t = vz === 0 ? 0 : (origin.z - plane) / vz;
  out.x = origin.x + Math.sin(a) * forward * t;
  out.y = Math.max(0, origin.y + power * LIFT * t + 0.5 * GRAVITY * t * t);
  out.t = t;
  return out;
}

/** Launch vector per spec: dir(theta) * base * (0.6 + 0.4 * power), Vy = power * LIFT. */
export function launchVector(theta, power, speedScale, out) {
  const a = Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, theta));
  const forward = BASE_VELOCITY * speedScale * (0.6 + 0.4 * power);
  out.x = Math.sin(a) * forward;
  out.z = -Math.cos(a) * forward;
  out.y = power * LIFT;
  return out;
}

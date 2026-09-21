import assert from 'node:assert/strict';
import { GOAL, BALL_R, PHYS_DT, stepBall, netContact, netPockets, releaseNetPockets } from '../js/physics.js';

const results = [];
for (const [name, start, velocity, panel, axis, sign, boundary] of [
  ['back', [0, 1, -23], [0, 0, 35], 0, 'z', -1, -22],
  ['left', [-5, 1, -21], [35, 0, 0], 1, 'x', -1, -3.66],
  ['right', [5, 1, -21], [-35, 0, 0], 2, 'x', 1, 3.66],
  ['roof', [0, 3.5, -21], [0, -20, 0], 3, 'y', 1, 2.44],
]) {
  const frames = [];
  for (const hz of [30, 60, 144]) {
    releaseNetPockets();
    const p = { x: start[0], y: start[1], z: start[2] };
    const v = { x: velocity[0], y: velocity[1], z: velocity[2] }, prev = { ...p };
    let acc = 0, hit = false, depth = 0;
    for (let frame = 0; frame < hz * 3; frame++) {
      acc += 1 / hz;
      while (acc + 1e-10 >= PHYS_DT) {
        acc -= PHYS_DT;
        Object.assign(prev, p);
        stepBall(p, v, PHYS_DT);
        netContact(p, v, PHYS_DT, false, prev);
        const pocket = netPockets[panel];
        if (pocket.touched) {
          hit = true;
          assert.equal(pocket.side, -1, `${name} changed collision side`);
          depth = Math.min(depth, pocket.depth);
        }
      }
    }
    assert(hit && depth < -.05, `${name} needs an inward pocket`);
    // Roof supports the ball's weight with a small static sag.
    assert((p[axis] - boundary) * sign > (panel === 3 ? -.03 : 0), `${name} passed through net`);
    frames.push({ hz, position: p, depth });
  }
  for (const f of frames) assert(Math.abs(f.position[axis] - frames[0].position[axis]) < 1e-7);
  results.push({ name, frames });
}
releaseNetPockets();
const far = { x: 6, y: 4, z: -24 }, speed = { x: 1, y: 0, z: -1 };
assert.equal(netContact(far, speed, PHYS_DT, false), -1, 'Miss beyond finite panels must stay free');
// Deliberately large sweep must be caught even when both endpoints clear the plane.
releaseNetPockets();
const fast = { x: 0, y: 1, z: -20.8 }, fastV = { x: 0, y: 0, z: 600 };
assert.equal(netContact(fast, fastV, PHYS_DT, false, { x: 0, y: 1, z: -23.3 }), 0);
assert(fast.z <= GOAL.PLANE_Z - 2 + .85 - BALL_R + 1e-6);
console.log(JSON.stringify(results, null, 2));

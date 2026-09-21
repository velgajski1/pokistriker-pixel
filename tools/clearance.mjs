import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  report.behavior = await session.page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const app = await import('../js/app.js');
    const d = window.__demo;
    d.renderer.setAnimationLoop(null);
    e.setupChance({ x: 0, y: .11, z: 0 }, 0, false);
    const ref = d.formation.actors.find(p => p.team === 'ref');
    d.ball.position.set(ref.x, .11, ref.z);
    for (let i = 0; i < 60; i++) e.watchBall(1 / 60, false);
    const refDistance = Math.hypot(ref.x - d.ball.position.x, ref.z - d.ball.position.z);
    const p = d.formation.actors.find(p => p.team === 'away');
    const pos = d.ballState.position, vel = d.ballState.velocity;
    pos.x = p.x; pos.y = .11; pos.z = p.z + .5;
    vel.x = 0; vel.y = 0; vel.z = .4;
    d.shot.flightTime = 1;
    d.shot.clearer = null; d.shot.clearanceCooldown = 0;
    app.updateClearance(1 / 240);
    const prepared = d.shot.clearer === p && p.rig.avatar.passTime === 0;
    const a = p.rig.avatar;
    pos.z += vel.z * .28;
    for (const action of Object.values(a.actions)) action.setEffectiveWeight(0);
    a.actions.kick.setEffectiveWeight(1);
    a.actions.kick.time = a.data.clips.kick.contact;
    a.mixer.update(0);
    p.rig.root.updateWorldMatrix(true, true);
    app.updateClearance(.28);
    const kicked = vel.z > 15 && vel.y === 4 && d.shot.touched === 'defender';
    a.passTime = -1;
    d.shot.clearanceCooldown = 0;
    vel.z = -20;
    app.updateClearance(1 / 240);
    const fastIgnored = d.shot.clearer === null;
    return { refDistance, prepared, kicked, fastIgnored, clearanceVelocity: vel.x };
  });
  const b = report.behavior;
  assert(b.refDistance > 3, 'Referee must retreat even while aiming');
  assert(b.prepared && b.kicked, 'Reachable slow ball must be cleared away from goal with the kick');
  assert(b.fastIgnored, 'Fast shots must not trigger a clearance windup');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/clearance.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

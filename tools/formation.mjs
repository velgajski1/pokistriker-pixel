import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  report.movement = await session.page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const d = window.__demo;
    d.renderer.setAnimationLoop(null);
    e.chance.blockerCount = 0;
    const actors = d.formation.actors;
    const left = actors.find(p => p.team === 'away' && p.home.x < -10);
    const reset = () => {
      for (const p of actors) {
        p.x = p.home.x; p.z = p.home.z; p.speed = 0; p.chasing = false;
        p.rig.root.position.set(p.x, 0, p.z);
      }
    };
    const run = (hz, seconds, rebound) => {
      for (let i = 0; i < hz * seconds; i++) e.watchBall(1 / hz, true, rebound);
    };
    const far = [];
    for (const hz of [30, 60, 144]) {
      reset();
      d.ball.position.set(25, .11, 20);
      run(hz, 5, true);
      far.push({ hz, x: left.x, z: left.z, speed: left.speed, chasing: left.chasing });
    }
    reset();
    d.ball.position.set(left.x + 5, .11, left.z + 1);
    e.watchBall(1 / 60, true, false);
    const beforeBounce = left.chasing;
    const pressure = actors.filter(p => p.pressing);
    const expected = actors.filter(p => p.team === 'away').sort((a, b) =>
      Math.hypot(a.x - d.ball.position.x, a.z - d.ball.position.z)
      - Math.hypot(b.x - d.ball.position.x, b.z - d.ball.position.z)).slice(0, 2);
    const closestPress = pressure.length === 2 && pressure.every(p => expected.includes(p) && p.chasing);
    reset();
    d.ball.position.set(0, .11, 76);
    e.watchBall(1 / 60, true, false);
    const distantPress = actors.filter(p => p.pressing).every(p => p.chasing && p.speed > 1.45);
    reset();
    d.ball.position.set(left.x + 5, .11, left.z + 1);
    const initial = Math.hypot(d.ball.position.x - left.x, d.ball.position.z - left.z);
    run(60, .5, true);
    const near = { chasing: left.chasing, speed: left.speed,
      closed: initial - Math.hypot(d.ball.position.x - left.x, d.ball.position.z - left.z) };
    d.ball.position.set(25, .11, 20);
    run(60, 1, true);
    const released = !left.chasing;
    reset();
    const mate = actors.find(p => p.team === 'home' && p.rig.root !== d.striker.root);
    d.ball.position.set(mate.x + 5, .11, mate.z);
    e.watchBall(1 / 60, true, true);
    const attacker = { selected: d.formation.attacker === mate, chasing: mate.chasing, speed: mate.speed };
    reset();
    const shooter = actors.find(p => p.rig.root === d.striker.root);
    d.ball.position.set(shooter.x + 4, .11, shooter.z);
    e.watchBall(1 / 60, true, true, null, false);
    const kickProtected = !shooter.chasing;
    e.watchBall(1 / 60, true, true, null, true);
    const shooterChase = shooter.chasing && shooter.speed > 7 && d.striker.speed > 7;
    d.ball.position.set(-12, .11, -22);
    e.watchBall(1 / 60, true, true);
    return { far, near, beforeBounce, closestPress, distantPress, released, attacker, kickProtected, shooterChase,
      outOfPlayChasers: actors.filter(p => p.chasing).length };
  });
  const m = report.movement;
  assert(m.far.every(p => p.x < -6 && p.z > -14 && p.speed <= 1.45 && !p.chasing), 'Far fullback must walk higher while retaining his wing');
  assert(m.far.every(p => Math.hypot(p.x - m.far[0].x, p.z - m.far[0].z) < .06), 'Formation movement differs across frame rates');
  assert(m.beforeBounce && m.closestPress && m.distantPress, 'The two closest defenders must close down before a bounce, regardless of distance');
  assert(m.near.chasing && m.near.closed > 1 && m.near.speed > 1.45, 'Nearby defenders must approach the ball');
  assert(m.near.speed > 7 && m.near.closed >= 3.59, 'Nearest defender must sprint without easing off early');
  assert(m.attacker.selected && m.attacker.chasing && m.attacker.speed > 7, 'Nearest available attacker must sprint to the ball');
  assert(m.kickProtected && m.shooterChase, 'Shooter must finish his kick before chasing with locomotion');
  assert(m.released && m.outOfPlayChasers === 0, 'Chasers must release distant or out-of-play balls');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/formation.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

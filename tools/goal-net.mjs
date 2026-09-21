import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
import { GOAL, NET, PHYS_DT, stepBall, netContact, netPockets } from '../js/physics.js';
const report = { errors: [], failures: [], shots: [] };
let browser;
try {
  for (const [name, x, y, vx, vy, vz] of [
    ['back', 0, 1.1, 0, 1, -32], ['left', -3.4, .8, -14, 0, -20],
    ['right', 3.4, .8, 14, 0, -20], ['roof', 0, 2.2, 1, 12, -24],
    ['corner', 3.3, 2.1, 12, 9, -35], ['hard', 0, .4, 0, 0, -60],
  ]) {
    for (const hz of [30, 60, 144]) {
      const p = { x, y, z: GOAL.PLANE_Z - .2 }, v = { x: vx, y: vy, z: vz };
      let accumulator = 0, stretch = 0, contact = false, returnSpeed = 0;
      for (let frame = 0; frame < hz * 3; frame++) {
        accumulator += 1 / hz;
        while (accumulator + 1e-10 >= PHYS_DT) {
          accumulator -= PHYS_DT;
          stepBall(p, v, PHYS_DT);
          if (netContact(p, v, PHYS_DT, true) >= 0) contact = true;
          for (const pocket of netPockets) if (pocket.touched) stretch = Math.max(stretch, pocket.depth);
          returnSpeed = Math.max(returnSpeed, v.z);
        }
      }
      report.shots.push({ name, hz, stretch, contact, returnSpeed, position: p, speed: Math.hypot(v.x, v.y, v.z) });
      assert(contact && stretch <= NET.MAX_STRETCH + 1e-6, 'Shot escaped net stretch limit');
      assert(p.z < GOAL.PLANE_Z && p.y < .3, 'Scored ball should settle inside the goal');
      assert(returnSpeed < 8, 'Net returned too much energy');
    }
    const group = report.shots.slice(-3);
    assert(group.every(s => Math.abs(s.position.z - group[0].position.z) < 1e-7), 'Net physics differs across FPS');
  }
  const p = { x: 4, y: 3, z: -21 }, v = { x: -4, y: -3, z: -20 };
  netContact(p, v, PHYS_DT, false);
  assert(v.x === -4 && v.y === -3 && v.z === -20, 'Missed shots must not be sucked into net');
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const physics = await import('../js/physics.js');
    e.parade(0, 1);
    __demo.players[0].root.position.y = -50;
    document.getElementById('overlay').style.display = 'none';
    const p = { x: 1.2, y: 1.2, z: -20.2 }, v = { x: 0, y: 1, z: -32 };
    let acc = 0;
    e.onFrame(dt => {
      acc += dt;
      while (acc >= physics.PHYS_DT) {
        acc -= physics.PHYS_DT;
        physics.stepBall(p, v, physics.PHYS_DT);
        physics.netContact(p, v, physics.PHYS_DT, true);
      }
      e.setBall(p);
    });
  });
  await page.waitForTimeout(170);
  report.peakVisualStretch = await page.evaluate(() => Math.max(...__demo.scene.children
    .filter(n => n.name === 'goal-net').map(n => {
      const p = n.geometry.attributes.position;
      let peak = 0;
      for (let i = 0; i < p.count; i++) peak = Math.max(peak, Math.abs(p.getZ(i)));
      return peak;
    })));
  assert(report.peakVisualStretch > .04, 'Impact must visibly deform the net');
  await page.screenshot({ path: `${CAPTURES}/net-impact.png` });
  await page.waitForTimeout(2200);
  report.settledVisualStretch = await page.evaluate(() => Math.max(...__demo.scene.children
    .filter(n => n.name === 'goal-net').map(n => {
      const p = n.geometry.attributes.position;
      let peak = 0;
      for (let i = 0; i < p.count; i++) peak = Math.max(peak, Math.abs(p.getZ(i)));
      return peak;
    })));
  assert(report.settledVisualStretch < report.peakVisualStretch * .2, 'Net must settle rather than freeze deformed');
  await page.screenshot({ path: `${CAPTURES}/net-settled.png` });
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/goal-net.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

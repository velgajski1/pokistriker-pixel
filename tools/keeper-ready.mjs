import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  report.stance = await session.page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const THREE = await import('three');
    const d = window.__demo, keeper = d.players[0];
    d.renderer.setAnimationLoop(null);
    e.setKeeper(0, 0, 1, 0, 0, 0);
    const bone = name => keeper.model.getObjectByName('mixamorig' + name);
    const point = name => bone(name).getWorldPosition(new THREE.Vector3());
    const left = point('LeftFoot'), right = point('RightFoot');
    const hips = point('Hips');
    const samples = [];
    for (const hz of [30, 60, 144]) {
      e.setKeeper(-2, 0, 1, 0, 0, 0);
      e.setKeeper(0, 0, 1, 0, 0, 0);
      for (let i = 1; i <= hz; i++) e.setKeeper(i * .8 / hz, 0, 1, 0, 0, 0);
      samples.push({ hz, foot: point('LeftFoot').toArray(), hip: point('Hips').toArray() });
    }
    let maxJump = 0;
    e.setKeeper(.8, 0, 1, 0, 0, 0);
    let previous = bone('LeftUpLeg').quaternion.clone();
    for (let i = 1; i <= 50; i++) {
      e.setKeeper(.8, i / 100, 1, 0, 0, 0);
      const q = bone('LeftUpLeg').quaternion;
      maxJump = Math.max(maxJump, previous.angleTo(q));
      previous.copy(q);
    }
    return { width: left.distanceTo(right), hipHeight: hips.y,
      feet: [left.y, right.y], samples, maxJumpDegrees: maxJump * 180 / Math.PI };
  });
  const s = report.stance;
  assert(s.width > .55 && s.hipHeight < 1, 'Keeper needs a wide crouched stance');
  assert(s.feet.every(y => y > -.05 && y < .2), 'Ready feet must stay near the turf');
  assert(s.samples.every(p => Math.hypot(...p.foot.map((v, i) => v - s.samples[0].foot[i])) < .005), 'Shuffle differs across frame rates');
  assert(s.maxJumpDegrees < 12, 'Crouch-to-dive pose snaps');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/keeper-ready.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

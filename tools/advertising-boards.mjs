import { mkdirSync, writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
import { AD_BOARDS, BOARD_HEIGHT, PHYS_DT, hitAdvertisingBoards } from '../js/physics.js';

const report = { errors: [], failures: [], cases: [] };
let browser;
try {
  for (const [name, start, velocity, axis, direction, expected] of [
    ['right', [36, .5, 10], [60, 0, 4], 'x', -1, true],
    ['left', [-36, .5, 10], [-60, 0, 4], 'x', 1, true],
    ['near end', [10, .5, -26], [4, 0, -60], 'z', 1, true],
    ['far end', [10, .5, 91], [4, 0, 60], 'z', -1, true],
    ['outside face', [40, .5, 10], [-60, 0, 0], 'x', 1, true],
    ['top', [37.9, 3, 10], [0, -60, 0], 'y', 1, true],
    ['overhead', [36, 1.5, 10], [60, 0, 0], 'x', 1, false],
    ['end cap', [37.9, .5, -26], [0, 0, 60], 'z', -1, true],
  ]) {
    const results = [];
    for (const hz of [30, 60, 144]) {
      const p = { x: start[0], y: start[1], z: start[2] };
      const v = { x: velocity[0], y: velocity[1], z: velocity[2] };
      const previous = { ...p };
      let acc = 0, contacts = 0, steps = 0;
      for (let frame = 0; frame < hz; frame++) {
        acc += 1 / hz;
        while (acc + 1e-10 >= PHYS_DT && steps < 24) {
          acc -= PHYS_DT;
          steps++;
          Object.assign(previous, p);
          p.x += v.x * PHYS_DT; p.y += v.y * PHYS_DT; p.z += v.z * PHYS_DT;
          if (hitAdvertisingBoards(previous, p, v, PHYS_DT)) contacts++;
        }
      }
      assert((contacts > 0) === expected, `${name}: unexpected collision count ${contacts}`);
      assert(v[axis] * direction > 0, `${name}: incorrect rebound direction`);
      if (expected) assert(Math.hypot(v.x, v.y, v.z) < Math.hypot(...velocity), `${name}: gained energy`);
      results.push({ hz, position: p, velocity: v, contacts });
    }
    assert(results.every(r => Math.abs(r.position[axis] - results[0].position[axis]) < 1e-7), `${name}: frame-rate dependence`);
    report.cases.push({ name, results });
  }
  const previous = { x: 35, y: .5, z: 10 }, p = { x: 45, y: .5, z: 10 }, v = { x: 300, y: 0, z: 0 };
  assert(hitAdvertisingBoards(previous, p, v, 1 / 30) && p.x < 37.665 && v.x < 0, 'Fast sweep tunneled through board');
  const session = await open(report.errors);
  browser = session.browser;
  report.models = await session.page.evaluate(async () => {
    const THREE = await import('three');
    return __demo.scene.children.filter(n => n.name === 'advertising-board').map(n => {
      const box = new THREE.Box3().setFromObject(n);
      return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, height: box.max.y };
    });
  });
  assert(report.models.length === 4, 'Expected four advertising boards');
  report.models.forEach((model, i) => {
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) assert(Math.abs(model[key] - AD_BOARDS[i][key]) < 1e-5, `Board ${i} ${key} differs from collision`);
    assert(Math.abs(model.height - BOARD_HEIGHT) < 1e-5, 'Board height differs from collision');
  });
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  mkdirSync(CAPTURES, { recursive: true });
  writeFileSync(`${CAPTURES}/advertising-boards.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: report.cases.length, models: report.models, errors: report.errors, failures: report.failures }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

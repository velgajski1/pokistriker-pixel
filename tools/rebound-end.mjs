import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  report.cases = await session.page.evaluate(async () => {
    const { reboundIsOver } = await import('../js/app.js');
    const { stepBall, PHYS_DT, GOAL } = await import('../js/physics.js');
    const cases = [];
    for (const hz of [30, 60, 144]) {
      const p = { x: 0, y: 1, z: GOAL.PLANE_Z + 2 }, v = { x: 0, y: 1, z: 15 };
      let acc = 0, elapsed = 0, away = 0, done = false;
      while (!done && elapsed < 4) {
        acc += 1 / hz;
        while (acc >= PHYS_DT && !done) {
          acc -= PHYS_DT;
          stepBall(p, v, PHYS_DT);
          elapsed += PHYS_DT;
          away = p.z > GOAL.PLANE_Z + 6 && v.z > .8 ? away + PHYS_DT : 0;
          done = reboundIsOver(p, v, elapsed, away);
        }
      }
      cases.push({ hz, elapsed, speed: Math.hypot(v.x, v.y, v.z), done });
    }
    return { clearances: cases,
      goalboundKept: !reboundIsOver({ z: -12 }, { z: -5 }, 1, 1),
      nearGoalKept: !reboundIsOver({ z: -19 }, { z: 3 }, 1, 1),
      briefReversalKept: !reboundIsOver({ z: -10 }, { z: 4 }, .7, .1),
      deadline: reboundIsOver({ z: -18 }, { z: -.1 }, 3, 0) };
  });
  const c = report.cases;
  assert(c.clearances.every(r => r.done && r.elapsed < 1.2 && r.speed > 1), 'Clearance should end while still moving');
  assert(c.clearances.every(r => Math.abs(r.elapsed - c.clearances[0].elapsed) < .001), 'Rebound resolution differs across FPS');
  assert(c.goalboundKept && c.nearGoalKept && c.briefReversalKept && c.deadline, 'Rebound grace period or deadline incorrect');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/rebound-end.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

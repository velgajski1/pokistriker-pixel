import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
const report = { errors: [], failures: [], cases: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    e.setupChance({ x: 0, y: .11, z: 0 }, 1, false);
    const p = __demo.players.find(p => p.team === 'away' && p.role === 'outfield');
    window.__glide = { rig: p.rig, speed: 0, x: p.root.position.x };
    e.onFrame(dt => {
      __glide.x += __glide.speed * dt;
      // Reproduce the old ordering: translate, then apply a stationary Alert.
      e.setBlocker(0, __glide.x, 0, 1);
    });
  });
  for (const speed of [.04, .8, 0]) {
    await page.evaluate(speed => { __glide.speed = speed; }, speed);
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const a = __glide.rig.avatar;
      return { speed: __glide.speed, measured: a.speed,
        walk: a.actions.walk.getEffectiveWeight(), alert: a.actions.alert.getEffectiveWeight() };
    });
    report.cases.push(result);
    assert(speed ? result.walk > .99 && Math.abs(result.measured - speed) < .001 : result.alert > .99,
      'Moving Alert pose must walk and stopped defender must settle');
  }
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/glide.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

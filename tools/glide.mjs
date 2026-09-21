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
  for (const kind of ['striker-recovery', 'keeper-ready', 'ref-idle', 'slow-turn']) {
    await page.evaluate(async kind => {
      const e = await import('../js/gameEngine.js');
      const p = kind === 'striker-recovery' ? __demo.players.find(p => p.role === 'striker')
        : kind === 'keeper-ready' ? __demo.players[0]
        : __demo.players.find(p => p.team === 'ref');
      __glide.player = p;
      __glide.kind = kind;
      e.onFrame(dt => {
        p.root.position.x += .08 * dt;
        if (kind === 'striker-recovery') e.setStrikerKick(1, 5);
        else if (kind === 'keeper-ready') e.setKeeper(p.root.position.x, 0, 1, 0, 0, 0);
        else {
          const a = p.rig.avatar;
          for (const action of Object.values(a.actions)) action.setEffectiveWeight(0);
          a.actions.idle.setEffectiveWeight(1);
          a.procedural = kind === 'ref-idle';
          a.turnRate = kind === 'slow-turn' ? 2 : 0;
          a.speed = 0;
        }
      });
    }, kind);
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const p = __glide.player;
      const w = p.role === 'striker' ? __demo.striker.weights()
        : Object.fromEntries(Object.entries(p.rig.avatar.actions).map(([n, a]) => [n, a.getEffectiveWeight()]));
      return { kind: __glide.kind, moving: w.walk + w.quick_walk + w.run + w.run_alt + w.turn_walk_left + w.turn_walk_right,
        idle: w.idle + w.alert + w.keeper_idle + w.turn_idle_left + w.turn_idle_right };
    });
    report.cases.push(result);
    assert(result.moving > .99 && result.idle < .001, `${kind} moved with an idle pose`);
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

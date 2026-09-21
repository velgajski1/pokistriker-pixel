import { writeFileSync } from 'node:fs';
import { CAPTURES, assert, open, frameStats, sampleFrames, gpuString } from './lib.mjs';

const name = process.argv[2] || 'check';
assert(/^[a-zA-Z0-9_-]+$/.test(name), 'Capture name must contain only letters, digits, underscores or hyphens');
const report = { errors: [], failures: [], warnings: [], outcome: null, powersPressed: [], frameStats: null, gpu: null };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  assert(await page.evaluate(() => window.__demo.striker.model === 'captain'), 'Captain did not load');
  page.setDefaultTimeout(15000);
  report.gpu = await gpuString(page);
  const phase = wanted => page.waitForFunction(value => window.__demo.state.phase === value, wanted);
  const shoot = async () => {
    await page.keyboard.press('Space');
    await phase('POWER');
    await page.waitForFunction(() => {
      const d = window.__demo;
      return d.state.phase === 'POWER' && d.shot.power >= 0.55 && d.shot.power <= 0.65;
    });
    await page.keyboard.press('Space');
    const locked = await page.evaluate(() => ({ phase: window.__demo.state.phase, power: window.__demo.shot.power }));
    report.powersPressed.push(locked.power);
    assert(locked.phase === 'WINDUP', `Expected WINDUP, got ${locked.phase}`);
    assert(locked.power >= 0.55 && locked.power <= 0.7, `Power outside target range: ${locked.power}`);
  };

  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await phase('AIM');
  await page.screenshot({ path: `${CAPTURES}/${name}-aim.png` });
  await shoot();
  await phase('FLIGHT');
  await page.waitForFunction(() => window.__demo.state.phase === 'FLIGHT' && window.__demo.shot.flightTime >= 0.1);
  await page.screenshot({ path: `${CAPTURES}/${name}-flight.png` });
  await page.waitForFunction(() => window.__demo.shot.resolved !== null);
  report.outcome = await page.evaluate(() => window.__demo.shot.resolved);
  await phase('SIM');
  const clock = await page.evaluate(() => window.__demo.state.run.clock);
  await page.waitForFunction(before => window.__demo.state.phase === 'SIM' && window.__demo.state.run.clock > before, clock);
  report.clockAdvanced = true;

  await sampleFrames(page, 300);
  const deadline = Date.now() + 120000;
  while (true) {
    assert(Date.now() < deadline, 'Timed out collecting 300 SIM frames');
    await page.waitForFunction(() => window.__smokeFrames.done || window.__demo.state.phase === 'AIM' || window.__demo.state.screen !== 'MATCH');
    const status = await page.evaluate(() => ({ done: window.__smokeFrames.done, screen: window.__demo.state.screen }));
    if (status.done) break;
    if (status.screen === 'TRAINING') {
      await page.getByRole('button', { name: 'Proceed To Next Match >', exact: true }).click();
    } else {
      assert(status.screen === 'MATCH', `Unexpected screen: ${status.screen}`);
      await shoot();
    }
  }
  report.frameStats = frameStats(await page.evaluate(() => window.__smokeFrames.samples));
  if (report.frameStats.p95 >= 25) {
    const message = `SIM frame p95 ${report.frameStats.p95.toFixed(2)} ms exceeds budget`;
    if (/SwiftShader|llvmpipe/i.test(report.gpu)) report.warnings.push(message);
    else report.failures.push(message);
  }
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Runtime errors occurred');
  const json = JSON.stringify(report, null, 2);
  writeFileSync(`${CAPTURES}/${name}.json`, `${json}\n`);
  console.log(json);
  process.exitCode = report.failures.length ? 1 : 0;
}

import { open, assert, startShot } from './lib.mjs';
const baseline = process.argv.includes('--baseline');
const { browser, page, errors } = await open();
try {
  const results = [];
  for (const [name, x, vx, expected] of [
    ['right post inward', 3.54, 4, 'goal'],
    ['left post inward', -3.54, -4, 'goal'],
    ['outside edge of right post', 3.82, -4, 'woodwork'],
    ['outside edge of left post', -3.82, 4, 'woodwork'],
    ['outside right', 4.1, -4, 'wide'],
  ]) {
    await startShot(page);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.state.phase === 'POWER');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
    await page.evaluate(async ({x, vx}) => {
      const e = await import('/js/gameEngine.js');
      const d = __demo;
      Object.assign(d.ballState.position, { x, y: 1, z: -19.96 });
      Object.assign(d.ballState.velocity, { x: vx, y: 0, z: -20 });
      Object.assign(d.shot, { acc: 0, flightTime: 0, entered: false, touched: null, contactCool: 0,
        reboundStart: -1, restTimer: 0, resolved: null, clearanceCooldown: 100,
        keeperDelay: 100, keeperX: 0, keeperSetX: 0, keeperTarget: 0 });
      e.setKeeper(0, 0, 1);
    }, {x, vx});
    await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 12000 });
    const result = await page.evaluate(() => ({ outcome: __demo.shot.resolved,
      entered: __demo.shot.entered, touched: __demo.shot.touched, position: {...__demo.ballState.position} }));
    results.push({name, ...result});
    if (!baseline) assert(result.outcome === expected, `${name}: expected ${expected}, got ${result.outcome}`);
  }
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

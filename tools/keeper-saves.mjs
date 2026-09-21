import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  const results = await page.evaluate(async () => {
    const app = await import('/js/app.js'), e = await import('/js/gameEngine.js');
    const p = await import('/js/physics.js');
    const d = __demo;
    d.renderer.setAnimationLoop(null);
    const results = [];
    for (const range of [6, 20, 30]) for (const x of (range === 6 ? [-.5, 0, .5] : [-2.5, 0, 2.5])) for (const height of [.2, .8, 1.5]) {
      p.releaseNetPockets();
      Object.assign(d.shot, { keeperSetX: 0, keeperX: 0, keeperTarget: x, keeperDelay: .1,
        keeperAbility: app.keeperAbility(range, 0, 1),
        keeperHigh: 0, keeperSide: Math.sign(x) || 1, diveDepth: 0, keeperDive: 0,
        keeperAirY: 0, keeperAirV: 0, keeperDown: 0, keeperLaunched: false,
        keeperJumpAt: .1, keeperGround: 0, keeperSpent: false, flightTime: 0,
        keeperReadX: 0, keeperReadY: 0,
        resolved: null, entered: false, touched: null, contactCool: 0,
        restTimer: 0, reboundStart: -1, bounced: false, awayTimer: 0,
        clearer: null, clearanceCooldown: 1 });
      const z = e.keeperLineZ() + range;
      const t = (range - .25) / 22;
      Object.assign(d.ballState.position, { x, y: height - .5 * p.GRAVITY * t * t, z });
      Object.assign(d.ballState.velocity, { x: 0, y: 0, z: -22 });
      e.setKeeper(0, 0, 1, 0, 0, 0);
      let saved = false, waited = range === 6;
      for (let i = 0; i < 720 && !d.shot.resolved; i++) {
        app.substep(p.PHYS_DT);
        if (i === 119 && range > 6) waited = !d.shot.keeperLaunched && d.shot.keeperDive === 0 && d.shot.keeperGround === 0;
        if (d.shot.touched === 'keeper') saved = true;
      }
      results.push({ range, x, height, saved, waited, outcome: d.shot.resolved });
    }
    return results;
  });
  console.log(JSON.stringify({ results, errors }, null, 2));
  assert(results.every(r => r.saved && r.outcome !== 'goal'), 'Keeper missed a reachable shot');
  assert(results.every(r => r.waited), 'Keeper committed early on a long shot');
  assert(!errors.length, errors.join('\n'));
} finally { await browser.close(); }

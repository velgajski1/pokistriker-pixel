import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    e.parade(1, 1);
    window.__celebration = e.celebration;
    document.getElementById('overlay').style.display = 'none';
  });
  const names = await page.evaluate(async () => (await import('/js/gameEngine.js')).CELEBRATIONS);
  const results = [];
  for (const name of names) {
    const duration = await page.evaluate(async name => (await import('/js/gameEngine.js')).startCelebration(name), name);
    const startX = await page.evaluate(() => __demo.striker.root.position.x);
    await page.waitForTimeout(650);
    assert(await page.evaluate(async () => {
      const e = await import('/js/gameEngine.js');
      const weights = __demo.striker.weights();
      return e.celebration.phase === 'run' && weights.run + weights.run_alt + weights.quick_walk + weights.walk > .99
        && weights[e.celebration.name] === 0;
    }), 'Scorer must run before performing the celebration');
    await page.waitForFunction(() => __celebration.phase === 'perform');
    const endX = await page.evaluate(() => __demo.striker.root.position.x);
    assert(Math.abs(endX - startX) > 4 && Math.abs(endX) > Math.abs(startX), `Run must move toward the sideline crowd: ${startX} -> ${endX}`);
    await page.waitForTimeout(300);
    const cameraBefore = await page.evaluate(() => __demo.camera.position.toArray());
    await page.waitForTimeout(650);
    const cameraAfter = await page.evaluate(() => __demo.camera.position.toArray());
    assert(Math.hypot(cameraAfter[0] - cameraBefore[0], cameraAfter[2] - cameraBefore[2]) > .15,
      'Celebration camera must keep orbiting after the run');
    let inverted = false;
    for (const fraction of [.15, .3, .5, .7, .9]) {
      await page.evaluate(async fraction => {
        const e = await import('/js/gameEngine.js');
        e.celebration.time = e.celebration.duration * fraction;
      }, fraction);
      await page.waitForTimeout(60);
      const sample = await page.evaluate(name => {
        const d = __demo;
        const h = d.striker.bone('head'), foot = d.striker.bone('foot_R');
        const headY = h.getWorldPosition(h.position.clone()).y;
        const footY = foot.getWorldPosition(foot.position.clone()).y;
        return { weight: d.striker.weights()[name], inverted: headY < footY };
      }, name);
      assert(sample.weight > .99, `${name} was overwritten by locomotion`);
      inverted ||= sample.inverted;
      if (fraction === .5) await page.screenshot({ path: `.captures/${name}.png` });
    }
    if (name.includes('backflip')) assert(inverted, `${name} did not rotate through its flip`);
    results.push({ name, duration, inverted, runDistance: Math.abs(endX - startX) });
    await page.evaluate(async () => (await import('/js/gameEngine.js')).stopCelebration());
  }
  await page.reload();
  await page.waitForFunction(() => __demo?.ready);
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  await page.evaluate(() => {
    __demo.shot.entered = true;
    __demo.shot.resolved = null;
    __demo.shot.contactCool = 1;
    Object.assign(__demo.ballState.position, { x: 0, y: .5, z: -20.3 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 0 });
  });
  await page.waitForFunction(() => __demo.shot.resolved === 'goal');
  assert(await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    return e.CELEBRATIONS.includes(e.celebration.name) && e.REACTIONS.includes(e.reactions.keeper.name)
      && !e.reactions.shooter.name && __demo.shot.holdTimer > 2;
  }), 'Goal did not trigger a complete celebration');
  await page.waitForFunction(() => __demo.state.phase !== 'FLIGHT', null, { timeout: 15000 });
  assert(await page.evaluate(async () => !(await import('/js/gameEngine.js')).celebration.name), 'Celebration did not clear after goal replay');
  assert(await page.evaluate(async () => !(await import('/js/gameEngine.js')).reactions.keeper.name), 'Keeper reaction did not clear after goal replay');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

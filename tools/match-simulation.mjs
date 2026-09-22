import { open, assert, sampleFrames, frameStats } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.evaluate(() => localStorage.setItem('benched.career.v1', JSON.stringify({ tutorialComplete: true })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo.ready);
  await page.getByRole('button', { name: 'Career Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Barry Benchwarmer', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const before = await page.evaluate(() => ({ clock: __demo.state.run.clock, time: __demo.state.elapsed,
    sim: __demo.matchView.simulatedSeconds, x: __demo.ball.position.x, z: __demo.ball.position.z }));
  await sampleFrames(page, 120);
  await page.waitForFunction(() => __smokeFrames.done);
  const after = await page.evaluate(() => ({ clock: __demo.state.run.clock, time: __demo.state.elapsed,
    sim: __demo.matchView.simulatedSeconds, x: __demo.ball.position.x, z: __demo.ball.position.z,
    height: __demo.camera.position.y, mode: __demo.matchView.mode, speed: __demo.matchView.speed,
    up: __demo.camera.up.toArray(), players: __demo.players.length }));
  const elapsed = after.time - before.time;
  assert(Math.abs((after.clock - before.clock) / elapsed - 200 / 60) < .001,
    'Match clock must advance exactly 200x');
  assert(Math.abs((after.sim - before.sim) / elapsed - 2) < .01, 'Player simulation must advance exactly 2x');
  assert(after.mode === 'overhead' && after.height > 100 && after.height < 130 && after.speed === 2
    && after.up[0] === 1, 'Missing lower landscape overhead simulation');
  const overheadHud = await page.evaluate(() => {
    const bottom = document.querySelector('.hud-bottom');
    const minute = document.getElementById('match-minute');
    const ticker = document.getElementById('ticker');
    return { display: getComputedStyle(bottom).display, minute: minute.textContent,
      minuteSize: parseFloat(getComputedStyle(minute).fontSize),
      tickerSize: parseFloat(getComputedStyle(ticker).fontSize) };
  });
  assert(overheadHud.display === 'grid' && overheadHud.minute === `${Math.floor(after.clock)}'`,
    'Overhead minute must be visible and update every simulated minute');
  assert(overheadHud.minuteSize >= 38 && overheadHud.tickerSize >= 14,
    'Overhead minute and commentary are not prominent enough');
  assert(after.players === 23 && Math.hypot(after.x - before.x, after.z - before.z) > .2, 'Match did not play on pitch');
  assert(await page.evaluate(() => {
    const d = __demo;
    d.renderer.render(d.scene, d.camera);
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 72;
    const ctx = canvas.getContext('2d'); ctx.drawImage(d.renderer.domElement, 0, 0, 128, 72);
    const pixels = ctx.getImageData(0, 0, 128, 72).data;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > pixels[i] * 1.2 && pixels[i + 1] > pixels[i + 2] * 1.1) green++;
    return green > 500;
  }), 'Overhead pitch is obscured by fog or outside the camera frame');
  await page.screenshot({ path: '.captures/match-overhead.png' });
  await page.evaluate(() => { __demo.state.run.schedule[0] = __demo.state.run.clock + .8; });
  await page.waitForFunction(() => __demo.matchView.mode === 'approach');
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('.hud-bottom')).display === 'none'),
    'Bottom commentary must be hidden when the action camera begins');
  const high = await page.evaluate(() => __demo.camera.position.y);
  await page.waitForTimeout(700);
  const lower = await page.evaluate(() => __demo.camera.position.y);
  assert(lower < high - 10 && lower > 2, 'Camera must pan/zoom into the chance');
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  assert(await page.locator('#phase-prompt').textContent() === '', 'Aim prompt text should be removed');
  await page.screenshot({ path: '.captures/match-approach.png' });
  await page.keyboard.press('Space'); await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  await page.evaluate(() => {
    __demo.shot.entered = true; __demo.shot.contactCool = 1;
    Object.assign(__demo.ballState.position, { x: 0, y: .5, z: -20.3 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 0 });
  });
  await page.waitForFunction(() => __demo.shot.resolved === 'goal');
  await page.waitForFunction(() => __demo.state.phase === 'SIM');
  assert(await page.evaluate(() => __demo.matchView.mode === 'overhead'
    && __demo.camera.position.y > 100 && __demo.camera.position.y < 130 && __demo.camera.up.x === 1),
    'End of celebration must cut immediately overhead');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify({ clockRate: (after.clock - before.clock) / elapsed,
    simulationRate: (after.sim - before.sim) / elapsed, camera: [high, lower],
    frames: frameStats(await page.evaluate(() => __smokeFrames.samples)) }, null, 2));
} finally { await browser.close(); }

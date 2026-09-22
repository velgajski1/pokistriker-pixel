import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.evaluate(() => localStorage.setItem('benched.career.v1', JSON.stringify({ tutorialComplete: true })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.keyboard.press('Digit1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  let lastCheckpoint;
  for (let match = 1; match <= 10; match++) {
    assert(await page.evaluate(n => __demo.state.screen === 'PREMATCH'
      && __demo.state.run.match === n && __demo.state.run.opponentColors === n - 1, match), `Wrong opponent in match ${match}`);
    await page.getByRole('button', { name: 'Kick Off', exact: true }).click();
    if (match === 10) lastCheckpoint = await page.evaluate(() => localStorage.getItem('benched.career.v1'));
    await page.evaluate(n => {
      const run = __demo.state.run;
      run.clock = 90; run.simTime = 100; run.schedule = []; run.building = false;
      run.confidence = 40; run.goals = n; run.matchGoals = 1; run.enemyGoals = 0;
    }, match);
    await page.waitForFunction(() => __demo.state.screen !== 'MATCH');
    assert(await page.evaluate(() => __demo.state.screen === 'RESULTS' && __demo.state.run.confidence === 45), 'Missing full-time win bonus');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (match < 10) {
      assert(await page.evaluate(() => __demo.state.screen === 'TRAINING'), 'Ended career too early');
      await page.getByRole('button', { name: 'Next Match >', exact: true }).click();
    }
  }
  assert(await page.evaluate(() => __demo.state.screen === 'GAMEOVER' && __demo.state.career.gameOver.won
    && __demo.state.career.legacy === 200 && !__demo.state.career.activeRun), 'Victory or LP payout incorrect');
  assert(await page.getByRole('heading', { name: /YOU BEAT THE GAME!/ }).isVisible(), 'Victory heading missing');
  await page.setViewportSize({ width: 640, height: 360 });
  await page.screenshot({ path: '.captures/career-victory-small.png' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  assert(await page.evaluate(() => __demo.state.career.gameOver.won && __demo.state.career.legacy === 200), 'Victory reload double-paid');
  await page.getByRole('button', { name: 'Next >', exact: true }).click();
  assert(await page.evaluate(() => !__demo.state.career.gameOver && __demo.state.career.legacy === 200), 'Next failed to acknowledge victory');
  // Zero confidence at the final whistle must still lose, not award victory.
  await page.evaluate(raw => localStorage.setItem('benched.career.v1', raw), lastCheckpoint);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.keyboard.press('Digit1');
  await page.evaluate(() => {
    const run = __demo.state.run;
    run.clock = 90; run.simTime = 100; run.schedule = []; run.building = false; run.confidence = 0;
    run.matchGoals = 0; run.enemyGoals = 0;
  });
  await page.waitForFunction(() => __demo.state.screen === 'RESULTS');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForFunction(() => __demo.state.screen === 'BENCHED');
  assert(await page.evaluate(() => __demo.state.career.gameOver.won === false), 'Zero-confidence finale incorrectly won');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: ten ordered opponents, training between matches, final victory, 20 LP/goal, reload without double payout, Next acknowledgement, and zero-confidence defeat.');
} finally { await browser.close(); }

import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  for (const [goals, enemyGoals, before, after] of [[2, 1, 50, 55], [1, 1, 50, 50], [0, 2, 50, 45], [0, 1, 3, 0], [1, 0, 0, 5], [1, 0, 99, 100]]) {
    await page.evaluate(() => {
      __demo.state.screen = 'MENU'; // Keep pagehide from overwriting the next isolated fixture.
      localStorage.setItem('benched.career.v1', JSON.stringify({ tutorialComplete: true }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready);
    await page.keyboard.press('Digit1');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Kick Off', exact: true }).click();
    await page.evaluate(({goals, enemyGoals, before}) => {
      Object.assign(__demo.state.run, { clock: 90, simTime: 100, schedule: [], building: false,
        goals, matchGoals: goals, enemyGoals, confidence: before });
    }, {goals, enemyGoals, before});
    await page.waitForFunction(() => __demo.state.screen === 'RESULTS');
    assert(await page.evaluate(value => __demo.state.run.confidence === value, after), 'Incorrect confidence');
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => __demo.state.screen === 'RESULTS'), 'Escape bypassed results');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready);
    assert(await page.evaluate(value => __demo.state.screen === 'RESULTS' && __demo.state.run.confidence === value, after), 'Reload repeated or skipped result');
    await page.setViewportSize({ width: 640, height: 360 });
    if (before === 50) await page.screenshot({ path: `.captures/match-result-${goals}-${enemyGoals}.png` });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert(await page.evaluate(value => __demo.state.screen === (value === 0 ? 'BENCHED' : 'TRAINING'), after), 'Wrong post-result route');
    console.log(`${goals}:${enemyGoals} confidence ${before} -> ${after}: passed, including reload.`);
  }
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: results, bonus/penalty, confidence limits, zero-confidence recovery, Next and persistence.');
} finally { await browser.close(); }

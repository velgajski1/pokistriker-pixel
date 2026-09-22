import { open, assert } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  await page.evaluate(() => localStorage.setItem('benched.career.v1', JSON.stringify({ tutorialComplete: true })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo.ready);
  await page.getByRole('button', { name: 'Career Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Barry Benchwarmer', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(async () => {
    const app = await import('/js/app.js');
    app.completeMatchForTest({ playerGoals: 2, enemyGoals: 2, confidence: 0 });
  });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER', null, { timeout: 10000 });
  assert(await page.evaluate(() => __demo.state.career.legacy === 40
    && __demo.state.career.gameOver.won === false), 'Benched season did not award 20 LP per goal');
  await page.getByRole('button', { name: 'Next >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.career.summerBreak === true);
  await page.locator('.upgrade-card button').first().click();
  assert(await page.evaluate(() => __demo.state.career.meta.star === 1
    && __demo.state.career.legacy === 0), 'Summer upgrade purchase failed');
  await page.getByRole('button', { name: 'Next Season', exact: true }).click();
  await page.waitForFunction(() => __demo.state.screen === 'PREMATCH' && __demo.state.run.match === 1);
  assert(await page.evaluate(() => __demo.state.run.characterId === 'barry'
    && Object.values(__demo.state.run.training).every(level => level === 0)),
  'Next season did not retain player and reset regular upgrades');

  let boughtRegular = false;
  for (let match = 1; match <= 16; match++) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.evaluate(async () => {
      const app = await import('/js/app.js');
      app.completeMatchForTest({ confidence: 70 });
    });
    assert(await page.evaluate(expected => __demo.state.screen === 'RESULTS'
      && __demo.state.run.match === expected && __demo.state.run.matchResult.salary === 50, match),
    `Match ${match} did not reach paid results`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (match < 16) {
      await page.waitForFunction(() => __demo.state.screen === 'TRAINING');
      const firstUpgrade = page.locator('.upgrade-card button').first();
      if (!boughtRegular && await firstUpgrade.isEnabled()) {
        await firstUpgrade.click();
        boughtRegular = true;
      }
      await page.getByRole('button', { name: 'Next Match >', exact: true }).click();
      await page.waitForFunction(expected => __demo.state.screen === 'PREMATCH'
        && __demo.state.run.match === expected, match + 1);
    }
  }
  await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER');
  assert(boughtRegular, 'No regular upgrade became affordable');
  assert(await page.evaluate(() => __demo.state.career.gameOver.won === true
    && __demo.state.career.meta.star === 1), 'Season victory or permanent meta progress failed');
  await page.getByRole('button', { name: 'Another Season', exact: true }).click();
  await page.waitForFunction(() => __demo.state.screen === 'PREMATCH' && __demo.state.run.match === 1);
  assert(await page.evaluate(() => __demo.state.career.meta.star === 1
    && __demo.state.run.characterId === 'barry'
    && Object.values(__demo.state.run.training).every(level => level === 0)),
  'Another Season did not preserve meta progress and reset regular progress');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  const stat = key => page.locator(`[data-stat="${key}"] strong`).textContent();
  assert(await stat('career-seasons') === '2', 'Continuing career did not count completed seasons');
  assert(await stat('career-goals') === '2' && await stat('career-matches') === '17',
    'Continuing career totals are incorrect');
  assert(await stat('career-record') === '0–17–0', 'Career W-D-L record is incorrect');
  assert(await stat('career-titles') === '1' && await stat('career-benchings') === '1',
    'Career title or benching total is incorrect');
  assert(await stat('career-best-training') === '1/20', 'Best normal-upgrade progress was not recorded');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: benching, LP payout, summer meta purchase, regular purchase, 16-match victory, persistence, season reset and career statistics.');
} finally {
  await browser.close();
}

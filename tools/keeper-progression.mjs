import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  const results = await page.evaluate(async () => {
    const { keeperAbility } = await import('/js/app.js');
    const stronger = (a, b) => b.skill > a.skill && b.reaction < a.reaction
      && b.readError < a.readError && b.heightError < a.heightError && b.setSpread < a.setSpread
      && b.setSpeed > a.setSpeed && b.diveSpeed > a.diveSpeed && b.diveTime < a.diveTime
      && b.catchSpeed > a.catchSpeed && b.parryBias > a.parryBias;
    let monotonic = true;
    for (const distance of [10, 20, 30]) for (const goals of [0, 1, 3]) for (const match of [1, 2, 10]) {
      const a = keeperAbility(distance, goals, match);
      monotonic &&= stronger(a, keeperAbility(distance + .1, goals, match))
        && stronger(a, keeperAbility(distance, goals + 1, match))
        && stronger(a, keeperAbility(distance, goals, match + 1));
    }
    return { monotonic, base: keeperAbility(10), long: keeperAbility(30),
      conceded: keeperAbility(30, 1), later: keeperAbility(30, 1, 5), elite: keeperAbility(100, 100, 100) };
  });
  assert(results.monotonic, 'Keeper progression is not continuous and monotonic');
  assert(results.elite.reaction >= .065 - 1e-9 && results.elite.setSpeed <= 5.5
    && results.elite.readError >= .06 - 1e-9, 'Progression exceeded physical limits');
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  assert(await page.evaluate(() => __demo.shot.keeperAbility.match === __demo.state.run.match
    && __demo.shot.keeperAbility.goals === __demo.state.run.matchGoals), 'Chance did not capture match progression');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

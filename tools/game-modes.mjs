import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.evaluate(async () => {
    const save = await import('/js/saveSystem.js');
    const career = save.load();
    career.legacy = 321;
    save.save(career);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo.ready);
  const saved = await page.evaluate(() => localStorage.getItem('benched.career.v1'));
  await page.screenshot({ path: '.captures/main-menu.png' });
  await page.getByRole('button', { name: /Training Mode/ }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  for (let i = 0; i < 2; i++) {
    await page.locator('button:focus').evaluateAll(buttons => buttons.forEach(button => button.blur()));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.state.phase === 'POWER');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
    await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 30000 });
  }
  assert(await page.evaluate(() => __demo.state.mode === 'practice' && __demo.state.run.cash === 0), 'Practice must repeat without cash rewards');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Single Match/ }).click();
  await page.evaluate(() => {
    __demo.state.run.schedule = [];
    __demo.state.run.clock = 90;
    __demo.state.run.simTime = 4;
  });
  await page.getByRole('heading', { name: 'FULL TIME' }).waitFor();
  assert(saved === await page.evaluate(() => localStorage.getItem('benched.career.v1')), 'Non-career modes changed saved progress');
  await page.getByRole('button', { name: 'Main Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(saved === await page.evaluate(() => localStorage.getItem('benched.career.v1')), 'Cancel reset changed progress');
  await page.getByRole('button', { name: /Career Mode/ }).click();
  assert(await page.evaluate(() => __demo.state.screen === 'MATCH' && __demo.state.mode === 'career'), 'Career must start in first match');
  await page.keyboard.press('Alt+1');
  await page.getByRole('heading', { name: 'META UPGRADES' }).waitFor();
  await page.keyboard.press('Alt+2');
  await page.getByRole('heading', { name: 'MATCH UPGRADES' }).waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.captures/main-menu-mobile.png' });
  assert(await page.evaluate(() => document.querySelector('.main-menu').getBoundingClientRect().right <= innerWidth), 'Mobile menu overflows');
  await page.getByRole('button', { name: 'Reset Progress', exact: true }).click();
  await page.getByRole('button', { name: 'Reset Progress', exact: true }).click();
  assert(await page.evaluate(() => localStorage.getItem('benched.career.v1') === null && __demo.state.career.legacy === 0), 'Confirmed reset failed');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: practice repeats, single-match results, save isolation, career entry, shortcuts, reset/cancel, mobile layout');
} finally {
  await browser.close();
}

import { open, assert } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  for (const power of [0, .5, 1]) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready);
    assert(await page.evaluate(() => __demo.shot.tutorial && __demo.state.run.freeMiss), 'Opening shot is protected tutorial');
    await page.waitForTimeout(1200);
    assert(await page.evaluate(() => Math.abs(__demo.shot.aimX - __demo.target.x) <= __demo.target.ring * .6 + 1e-8
      && Math.abs(__demo.shot.aimX - __demo.target.x) > __demo.target.bull * .5
      && __demo.shot.sweepBoost === 1), 'Tutorial visibly moves across a wider safe range without accelerating');
    await page.keyboard.press('Space');
    assert((await page.textContent('#phase-prompt')).includes('STEP 2 OF 2'), 'Second tutorial instruction');
    await page.evaluate(power => { __demo.shot.power = power; }, power);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.shot.resolved !== null);
    assert(await page.evaluate(() => __demo.shot.resolved === 'goal' && ['bullseye', 'target'].includes(__demo.shot.precision)),
      `Tutorial power ${power} hits the target`);
    await page.waitForFunction(() => __demo.state.phase === 'AIM');
    assert(await page.evaluate(() => !__demo.shot.tutorial && !__demo.state.run.freeMiss && __demo.shot.timingFactor === 1),
      'Shot 2 restores normal controls and heart rules');
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready);
    const prompt = await page.locator('#phase-prompt').boundingBox();
    assert(prompt.x >= 0 && prompt.x + prompt.width <= viewport.width
      && prompt.y >= 0 && prompt.y + prompt.height <= viewport.height, 'Tutorial panel fits viewport');
    assert(await page.locator('#phase-prompt').evaluate(el => getComputedStyle(el).fontFamily.includes('Rubik')
      && getComputedStyle(el).animationName === 'none'), 'Tutorial has readable steady text');
    await page.screenshot({ path: `.captures/tutorial-${viewport.width}.png` });
  }
  assert(errors.length === 0, errors.join('\n'));
  console.log('PASS: tutorial bounds, low/mid/high shots, prompts and return to normal play');
} finally { await browser.close(); }

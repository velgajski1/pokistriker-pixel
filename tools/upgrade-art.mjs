import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.evaluate(() => { __demo.state.career.legacy = 1000; });
  await page.keyboard.press('Alt+1');
  async function checkImages(count) {
    await page.waitForFunction(n => {
      const images = [...document.querySelectorAll('.upgrade-screen img')];
      return images.length === n && images.every(img => img.complete && img.naturalWidth > 0);
    }, count);
    assert(await page.evaluate(() => [...document.querySelectorAll('.upgrade-screen img')].every(img => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data[3] === 0;
    })), 'PNG backgrounds must retain transparency');
  }
  await checkImages(6);
  assert(await page.evaluate(() => !document.querySelector('.clean-upgrades .bank')
    && document.querySelector('.upgrade-status').getBoundingClientRect().bottom
      < document.querySelector('.clean-upgrades').getBoundingClientRect().top), 'Balance must sit outside panel');
  await page.screenshot({ path: '.captures/upgrade-art-meta.png' });
  await page.locator('.upgrade-card button').first().click();
  assert(await page.locator('.upgrade-status').innerText() === 'LEGACY POINTS: 960', 'Meta balance did not update');
  await page.keyboard.press('Alt+2');
  await page.evaluate(() => { __demo.state.run.cash = 500; __demo.state.run.confidence = 60; });
  await page.keyboard.press('Alt+2');
  await checkImages(5);
  assert(await page.locator('.upgrade-status .conf').count() === 1, 'Confidence must be outside panel');
  await page.screenshot({ path: '.captures/upgrade-art-training.png' });
  await page.locator('.upgrade-card button').first().click();
  assert(await page.evaluate(() => __demo.state.run.cash === 400), 'Match upgrade purchase failed');
  await page.locator('.charm-card button').click();
  assert(await page.evaluate(() => __demo.state.run.cash === 300 && __demo.state.run.confidence === 70), 'Charm purchase failed');
  await page.locator('.upgrade-help summary').first().hover();
  assert(await page.locator('.upgrade-tip').first().isVisible(), 'Hover help failed');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(0, 0);
  assert(await page.evaluate(() => document.querySelector('.upgrade-screen').getBoundingClientRect().right <= innerWidth), 'Mobile overflow');
  await page.screenshot({ path: '.captures/upgrade-art-mobile.png' });
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: 11 PNGs loaded with transparency, external status bar, purchases, confidence, hover help, mobile layout');
} finally {
  await browser.close();
}

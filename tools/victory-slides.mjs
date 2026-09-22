import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  for (const [width, height] of [[1920, 1080], [640, 360]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => __demo.previewVictory());
    const slides = await page.locator('.match-result-panel').evaluate(p => {
      const score = p.querySelector('.result-score');
      const a = score.getAnimations()[0];
      a.pause(); a.currentTime = 650;
      const moving = getComputedStyle(score).transform !== 'matrix(1, 0, 0, 1, 0, 0)';
      a.play();
      return { moving, count: p.getAnimations({ subtree: true }).length,
        disabled: p.querySelector('button').disabled, background: getComputedStyle(p).backgroundImage };
    });
    assert(slides.moving && slides.count >= 6 && slides.disabled && slides.background === 'none', 'Staggered panel-free reveal');
    await page.waitForTimeout(3200);
    const layout = await page.locator('.match-result-panel').evaluate(p => {
      const b = p.querySelector('button'), r = b.getBoundingClientRect();
      const sound = document.querySelector('.audio-controls').getBoundingClientRect();
      return !b.disabled && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
        && (r.right <= sound.left || r.left >= sound.right || r.bottom <= sound.top || r.top >= sound.bottom);
    });
    assert(layout, 'Next must be visible, enabled and unobstructed');
    await page.screenshot({ path: `.captures/victory-slides-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => __demo.previewVictory());
  assert(await page.locator('.result-score').evaluate(el => {
    const animation = el.getAnimations()[0];
    const timing = animation.effect.getTiming();
    return timing.duration === 650 && timing.delay === 500
      && animation.effect.getKeyframes()[0].transform.includes('translateX');
  }), 'Reduced motion must not suppress the requested side-slide or stagger');
  await page.waitForTimeout(2150);
  assert(await page.locator('.prematch-confidence .confidence-fill').evaluate(el =>
    el.getAnimations().some(a => a.effect.getTiming().duration === 1600)),
  'Confidence must tween even with reduced motion enabled');
  await page.waitForTimeout(1000);
  assert(await page.getByRole('button', { name: 'Next', exact: true }).isEnabled(), 'Next enables after reveal');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  assert(await page.locator('.game-over-panel').count() === 1, 'Next reaches season victory');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: slides, no panel, 1920x1080 and 640x360, unobstructed Next, reduced motion and continuation.');
} finally { await browser.close(); }

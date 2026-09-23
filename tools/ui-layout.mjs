import { open, assert } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  for (const [width, height] of [[640,360],[836,470],[1031,580],[1280,720],[390,844],[320,568],[844,390]]) {
    await page.setViewportSize({ width, height });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready);
    const check = async (menu) => {
      const failures = await page.evaluate(menu => {
        const failures = [];
        const rect = el => el.getBoundingClientRect();
        const visible = el => el && rect(el).width && rect(el).height;
        const overlaps = (a, b) => {
          a = rect(a); b = rect(b);
          return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        };
        const sound = document.querySelector('.audio-toggle');
        const panel = document.querySelector('.panel');
        const targets = menu ? [panel] : [...document.querySelectorAll('.hud-score,.hud-level,.hud-controls,.phase-prompt.show')];
        for (const el of targets.filter(visible)) {
          const r = rect(el);
          if (r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) failures.push(el.className + ' outside frame');
          if (el.scrollWidth > el.clientWidth + 1) failures.push(el.className + ' horizontal overflow');
          if (overlaps(el, sound)) failures.push(el.className + ' overlaps sound');
        }
        for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
          if (visible(targets[i]) && visible(targets[j]) && overlaps(targets[i], targets[j])) failures.push('HUD overlap');
        }
        if (panel && getComputedStyle(panel).transform !== 'none') failures.push('Menu text scaled');
        return failures;
      }, menu);
      assert(!failures.length, width + 'x' + height + ': ' + failures.join(', '));
    };
    await check(false);
    await page.screenshot({ path: '.captures/ui-' + width + '-play.png' });
    await page.evaluate(async () => {
      const ui = await import('/js/uiManager.js');
      ui.toast('MISSION COMPLETE: SCORE 5 GOALS IN ONE RUN', '+100 XP');
      ui.showLevelUp('LEVEL 7', 'NEW RANK: PROFESSIONAL');
      ui.flashVerdict('ON TARGET', 'target', '+1,200', 'COMBO x4');
    });
    assert(await page.locator('.hud-notices > .show').count() === 1, 'Only one notification visible');
    const notice = await page.locator('.hud-notices > .show').boundingBox();
    const region = await page.locator('.hud-notices').boundingBox();
    assert(notice.y + notice.height <= region.y + region.height + 1, 'Shot verdict fits its region');
    await page.evaluate(async () => (await import('/js/uiManager.js')).clearVerdict());
    assert(await page.locator('#toast').evaluate(el => el.classList.contains('show')), 'Queued reward follows verdict');
    for (const key of [1,2,3,4,5]) {
      await page.keyboard.press('Alt+0');
      await page.keyboard.press('Alt+' + key);
      await page.evaluate(() => { const tag = document.querySelector('#dev-tag'); if (tag) tag.hidden = true; });
      await check(true);
      const panel = page.locator('.panel');
      await panel.evaluate(el => { el.scrollTop = 0; });
      if (key === 3 && width >= 600) {
        const primary = await panel.locator('.primary').boundingBox();
        const bounds = await panel.boundingBox();
        assert(primary.y >= bounds.y && primary.y + primary.height <= bounds.y + bounds.height,
          'Play Again visible without scrolling in desktop frames');
      }
      await page.screenshot({ path: '.captures/ui-' + width + '-menu-' + key + '.png' });
      if (await panel.evaluate(el => el.scrollHeight > el.clientHeight)) {
        await panel.hover();
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(200);
        assert(await panel.evaluate(el => el.scrollTop > 0), 'Menu wheel scrolls at ' + width);
      }
    }
    console.log('PASS UI: ' + width + 'x' + height);
  }
  assert(!errors.length, errors.join('\n'));
} finally { await browser.close(); }

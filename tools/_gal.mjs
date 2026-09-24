// Temp: every menu screen in each style, with a no-scroll check in landscape.
import { chromium } from 'playwright';
const sizes = (process.argv[2] || '836x470,640x360,390x844').split(',');
const styles = (process.argv[3] || '0,1,2,3,4').split(',').map(Number);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const problems = [];
for (const size of sizes) for (const v of styles) {
  const [w, h] = size.split('x').map(Number);
  const touch = w < 1000 || h < 500;
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  await context.addInitScript(v => { try {
    localStorage.setItem('pokisavedgame.blockstriker.progress.v1', JSON.stringify({ tutorialDone: true, xp: 1400 }));
    localStorage.setItem('pokisavedgame.blockstriker.devstyles.v2', JSON.stringify({ reward: v, results: v, pause: v, locker: v, select: v }));
  } catch {} }, v);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.waitForTimeout(1200);
  const shot = async name => {
    await page.evaluate(() => { const t = document.getElementById('dev-tag'); if (t) t.hidden = true; });
    await page.waitForTimeout(350);
    const fit = await page.evaluate(() => {
      const p = document.querySelector('.panel'); if (!p) return 'no panel';
      const r = p.getBoundingClientRect();
      const out = [];
      if (innerWidth > innerHeight && p.scrollHeight > p.clientHeight + 1) out.push(`scrolls ${p.scrollHeight}>${p.clientHeight}`);
      if (p.scrollWidth > p.clientWidth + 1) out.push('h-overflow');
      if (r.bottom > innerHeight + 1 || r.top < -1) out.push('off-screen');
      return out.join(' ');
    });
    if (fit) problems.push(`${size} s${v + 1} ${name}: ${fit}`);
    await page.screenshot({ path: `.captures/s${v + 1}-${size}-${name}.png` });
  };
  await page.keyboard.press('Alt+Digit3'); await page.waitForTimeout(700); await shot('reward');
  await page.locator('#reward-next').click({ force: true }); await page.waitForTimeout(500); await shot('results');
  if (w > h) { await page.locator('.detail-button').click({ force: true }); await page.waitForTimeout(300); await shot('detail'); }
  for (const [key, name] of [[0], [2, 'pause'], [5, 'locker'], [0], [1, 'select'], [0]]) {
    await page.keyboard.press(`Alt+Digit${key}`); await page.waitForTimeout(500); if (name) await shot(name);
  }
  if (errors.length) problems.push(`${size} s${v + 1} errors ${errors}`);
  await context.close();
}
console.log(problems.length ? problems.join('\n') : 'all fit');
await browser.close();

// UI gallery: every screen on desktop and a landscape phone, via the localhost
// Alt previews, into .captures/ui-<size>-<screen>.png for review.
// Usage: node tools/ui-gallery.mjs [WxH,WxH]   (server running)
import { chromium } from 'playwright';
const sizes = (process.argv[2] || '1280x720,844x390').split(',');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
for (const size of sizes) {
  const [w, h] = size.split('x').map(Number);
  const touch = w < 1000 || h < 500;
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:5174/?shot=timing', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.evaluate(() => { const p = __demo.progress(); p.xp = 1400; p.bestLevel = 8; });
  await page.waitForTimeout(1800);
  const shot = async name => { await page.screenshot({ path: `.captures/ui-${size}-${name}.png` }); };
  await shot('aim');
  // A shot and its verdict.
  await page.keyboard.press('Space'); await page.waitForTimeout(250); await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 10000 });
  await page.waitForTimeout(250);
  await shot('verdict');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  for (const [key, name, wait] of [[6, 'banner', 350], [7, 'toast', 500], [8, 'special', 900], [2, 'pause', 600],
    [3, 'gameover', 800], [4, 'daily', 800], [5, 'locker', 700], [1, 'select', 700]]) {
    await page.keyboard.press(`Alt+Digit${key}`);
    await page.waitForTimeout(wait);
    await shot(name);
    if (key === 1 || key === 5) await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(150);
  }
  console.log(size, errors.length ? errors : 'ok');
}
await browser.close();

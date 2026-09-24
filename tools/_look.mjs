// Temp: the tutorial gesture, a fire round, a free kick, and the TILES screens.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
for (const [w, h] of [[836, 470], [390, 844]]) {
  const touch = true;
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:5174/?tutorial=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.waitForTimeout(1500);   // mid-gesture
  await page.screenshot({ path: `.captures/look-${w}-tutorial.png` });
  await page.keyboard.press('Alt+Digit9'); await page.waitForTimeout(900);
  await page.screenshot({ path: `.captures/look-${w}-fire-aim.png` });
  // Fire: a tap shoots; catch it mid-flight and at the result.
  await page.mouse.click(w / 2, h / 2);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `.captures/look-${w}-fire-flight.png` });
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 8000 });
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => ({ out: __demo.shot.resolved, bowled: __demo.shot.bowled, hud: document.getElementById('hud-level').textContent,
    rank: document.getElementById('hud-rank').textContent, fire: __demo.fireState() }));
  console.log(w, JSON.stringify(r));
  await page.screenshot({ path: `.captures/look-${w}-fire-result.png` });
  console.log(w, errors.length ? errors : 'ok');
}
await browser.close();

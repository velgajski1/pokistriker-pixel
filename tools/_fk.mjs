// Temp: free-kick conversion with pulls aimed at the target (height and side).
import { chromium } from 'playwright';
const N = Number(process.argv[2] || 24);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => { try { localStorage.setItem('pokisavedgame.blockstriker.progress.v1', JSON.stringify({ tutorialDone: true })); } catch {} });
const page = await context.newPage();
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demo?.ready);
await page.waitForTimeout(1600);
async function pull(dx, dy) {
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 10000 });
  await page.mouse.move(640, 250); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(640 + dx * i / 6, 250 + dy * i / 6); await page.waitForTimeout(10); }
  await page.waitForTimeout(30); await page.mouse.up();
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 10000 });
  const r = await page.evaluate(() => __demo.shot.resolved);

  return r;
}
const tally = {};
for (let n = 0; n < N; n++) {
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 10000 });
  await page.evaluate(() => { const r = __demo.state.run; r.time = 999; r.level = 6; r.levelGoals = 0; __demo.forceSpecial('freekick'); });
  await pull(300, 40);   // throwaway: the next chance is the free kick
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 10000 }); const sp = await page.evaluate(() => [__demo.state.run.special, __demo.state.screen, __demo.state.run.fireLeft]); if (sp[0] !== 'freekick') { console.log('not a free kick', sp); continue; }
  const aim = await page.evaluate(() => ({ x: __demo.target.x, y: __demo.target.y }));
  // Pull length for the target's height (level-6 zones, roughly), sideways for its x.
  const top = 2.35, power = Math.min(.95, Math.max(.4, (aim.y - .12) / (top - .12)));
  const dy = (0.05 + power * .29) * 720, dx = -aim.x / 4.2 * dy;
  const r = await pull(dx, dy);
  tally[r] = (tally[r] || 0) + 1;
}
console.log(JSON.stringify(tally), 'goal rate', ((tally.goal || 0) / N * 100).toFixed(0) + '%');
await browser.close();

// Mobile performance profile: a landscape phone (844x390 at DPR 3, touch, low
// quality as a phone gets) in real Chrome with the CPU throttled to low-end
// phone speed. Reports fps, CPU ms per frame (update vs draw submission),
// draw calls and triangles over a stretch of play, aiming and in flight.
// Usage: node tools/perf-mobile.mjs [cpuSlowdown=4]
import { chromium } from 'playwright';

const slowdown = Number(process.argv[2]) || 4;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
  hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto('http://localhost:5174/?shot=timing', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demo?.ready);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
await page.waitForTimeout(3000);   // camera intro, shader warm-up

const sample = label => page.evaluate(label => new Promise(resolve => {
  const d = __demo, times = [];
  let last = performance.now(), calls = 0, tris = 0, n = 0;
  const step = now => {
    times.push(now - last); last = now;
    calls += d.renderer.info.render.calls; tris += d.renderer.info.render.triangles; n++;
    if (times.length < 150) requestAnimationFrame(step);
    else {
      times.sort((a, b) => a - b);
      resolve({ label, fps: Math.round(1000 / (times.reduce((a, b) => a + b, 0) / times.length)),
        p90ms: Math.round(times[Math.floor(times.length * .9)]), updateMs: +d.renderState.updateMs.toFixed(1),
        drawMs: +d.renderState.renderMs.toFixed(1), calls: Math.round(calls / n), trisK: Math.round(tris / n / 1000),
        pixelRatio: d.renderState.pixelRatio, quality: d.renderState.quality });
    }
  };
  requestAnimationFrame(step);
}), label);

const rows = [await sample('aiming')];
// A shot: Space twice, then sample the flight and result.
await page.keyboard.press('Space'); await page.waitForTimeout(300); await page.keyboard.press('Space');
rows.push(await sample('shot + result'));
await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 15000 });
rows.push(await sample('aiming again'));
console.log(`CPU slowdown ${slowdown}x`);
console.table(rows);
await browser.close();

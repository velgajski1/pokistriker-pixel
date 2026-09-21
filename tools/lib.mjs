import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const CAPTURES = '.captures';
export const assert = (condition, message) => { if (!condition) throw new Error(message); };

export async function open(errors = []) {
  mkdirSync(CAPTURES, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(process.env.DEMO_URL || 'http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__demo?.ready, null, { timeout: 45000 });
    return { browser, context, page, errors };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export const frameStats = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    over25ms: samples.filter(value => value >= 25).length,
  };
};

// Count only intervals whose endpoints are both in active match simulation.
// The caller can keep playing through intervening chances while sampling runs.
export const sampleFrames = (page, count = 300) => page.evaluate(n => {
  window.__smokeFrames = { samples: [], done: false };
  let last;
  const tick = time => {
    const active = window.__demo.state.screen === 'MATCH' && window.__demo.state.phase === 'SIM';
    if (active && last !== undefined) window.__smokeFrames.samples.push(time - last);
    last = active ? time : undefined;
    window.__smokeFrames.done = window.__smokeFrames.samples.length >= n;
    if (!window.__smokeFrames.done) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, count);

export const gpuString = page => page.evaluate(() => {
  const gl = window.__demo.renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
});

// The timed rush, played with the real mouse (pull shots): the clock runs and
// shows in the HUD, goals add time, misses cost no heart, shots come back to
// back, a shot struck at the buzzer still counts, and time up ends the rush.
// Usage: node tools/rush.mjs   (server running)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DEMO_URL || 'http://localhost:5174/';
const checks = [], errors = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: !!ok, detail });
mkdirSync('.captures', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
// A returning player: the tutorial is done, so the clock runs from the first shot.
await context.addInitScript(() => {
  try { localStorage.setItem('pokisavedgame.blockstriker.progress.v1', JSON.stringify({ tutorialDone: true })); } catch {}
});
const page = await context.newPage();
page.on('pageerror', e => errors.push(String(e)));
const run = () => page.evaluate(() => ({ ...__demo.state.run, random: null, tally: null }));
async function pullShot(dx, dy) {
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 10000 });
  await page.mouse.move(640, 280); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(640 + dx * i / 8, 280 + dy * i / 8); await page.waitForTimeout(12); }
  await page.waitForTimeout(40); await page.mouse.up();
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 10000 });
  return page.evaluate(() => __demo.shot.resolved);
}

try {
  await page.goto(`${BASE}?shot=pull`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  let r = await run();
  check('A rush starts with the clock, not hearts', r.rush && r.time >= 29.9 && !r.tutorial
    && await page.evaluate(() => !document.querySelector('.hud-clock').classList.contains('hidden')
      && document.getElementById('hud-hearts').classList.contains('hidden')), JSON.stringify({ time: r.time, tutorial: r.tutorial }));
  check('Targets from the first shot of a rush', await page.evaluate(() => __demo.scene.getObjectByName('arcade-target').visible));
  await page.waitForTimeout(1200);
  const t0 = (await run()).time;
  check('The clock waits for the first shot', t0 === 30, t0.toFixed(2));

  // A wide miss: no heart lost, no time added, the next ball comes quickly.
  const heartsBefore = (await run()).hearts;
  const miss = await pullShot(400, 120);
  const afterMiss = await run();
  check('A miss costs no heart in a rush', afterMiss.hearts === heartsBefore, `${miss}, hearts ${heartsBefore} -> ${afterMiss.hearts}`);
  await page.waitForTimeout(600);
  const t1 = (await run()).time;
  check('The first shot starts the clock', t1 < 30 && t1 > 25, t1.toFixed(2));
  const resolvedAt = Date.now();
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 5000 });
  check('The next ball is ready quickly', Date.now() - resolvedAt < 1400, `${Date.now() - resolvedAt} ms`);

  // Goals add time: aim at the target.
  let added = null;
  for (let i = 0; i < 12 && added === null; i++) {
    const before = await page.evaluate(() => ({ time: __demo.state.run.time, tx: __demo.target.x }));
    const outcome = await pullShot(-before.tx / 4.2 * 200, 200);
    const after = await page.evaluate(() => __demo.state.run.time);
    if (outcome === 'goal') added = after - before.time;
  }
  check('A goal adds time to the clock', added !== null && added > .2, String(added));
  await page.screenshot({ path: '.captures/rush-play.png' });

  // The last seconds: a hurry clock, then time up ends the rush.
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 5000 });
  await page.evaluate(() => { __demo.state.run.time = 3; });
  await page.waitForTimeout(400);
  check('The last seconds turn the clock red', await page.evaluate(() => document.querySelector('.hud-clock').classList.contains('hurry')));
  await page.screenshot({ path: '.captures/rush-hurry.png' });
  await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER', null, { timeout: 8000 });
  await page.waitForTimeout(900);
  const over = await page.textContent('#overlay');
  check('Time up opens the reward screen: score, unlock, +15 s offer', /TIME UP|NEW BEST/.test(over)
    && /YOUR REWARD/.test(over) && /\+15 seconds/i.test(over) && !/PLAY AGAIN/.test(over), over.slice(0, 160));
  check('On the reward screen NEXT is the larger button', await page.evaluate(() => {
    const next = document.getElementById('reward-next').getBoundingClientRect();
    const ad = document.getElementById('continue-button')?.getBoundingClientRect();
    return !ad || (next.height >= ad.height && next.width >= ad.width);
  }));
  await page.screenshot({ path: '.captures/rush-reward.png' });
  await page.locator('#reward-next').click();
  await page.waitForTimeout(600);
  const results = await page.textContent('#overlay');
  check('NEXT opens the full results', /PLAY AGAIN/.test(results) && /missions/i.test(results), results.slice(0, 120));
  await page.screenshot({ path: '.captures/rush-over.png' });

  // Buzzer beater: a shot struck before zero still counts.
  await page.getByRole('button', { name: 'PLAY AGAIN', exact: true }).click();
  await page.waitForFunction(() => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM', null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { __demo.state.run.time = .35; });
  await page.mouse.move(640, 280); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(640, 280 + 25 * i); await page.waitForTimeout(5); }
  await page.mouse.up();
  const buzzer = await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER' ? 'over'
    : __demo.shot.resolved !== null ? 'resolved' : false, null, { timeout: 8000 }).then(h => h.jsonValue());
  check('A shot struck before the buzzer is played out', buzzer === 'resolved', buzzer);
} catch (error) {
  checks.push({ label: String(error).split('\n')[0], ok: false });
}
await browser.close();
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : '  - ' + c.detail}`);
for (const e of errors) console.log('PAGE ERROR  ' + e);
process.exit(checks.some(c => !c.ok) || errors.length ? 1 : 0);

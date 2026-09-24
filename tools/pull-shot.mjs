// The pull (slingshot) shot, driven with the real mouse: where
// each pull sends the ball on the goal line, the dotted preview, a too-short
// pull, and that the keyboard does not shoot. Screenshots mid-pull.
// Usage: node tools/pull-shot.mjs   (server running)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DEMO_URL || 'http://localhost:5174/';
const checks = [], errors = [];
const check = (label, ok, detail = '') => checks.push({ label, ok: !!ok, detail });
mkdirSync('.captures', { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => errors.push(String(e)));

/** Where the launched ball crosses the goal line (x, y), read from its first moments of flight. */
const launched = () => page.waitForFunction(() => __demo.state.phase === 'FLIGHT' && __demo.shot.flightTime > 0)
  .then(() => page.evaluate(() => {
    const d = __demo, p = d.ballState.position, v = d.ballState.velocity;
    const t = (d.dimensions.goal.PLANE_Z - p.z) / v.z;
    return { x: +(p.x + v.x * t).toFixed(2), y: +(p.y + v.y * t - 4.905 * t * t).toFixed(2) };
  }));
const nextChance = async () => {
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 8000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 8000 });
  await page.evaluate(() => { __demo.state.run.hearts = 5; });
};
/** A pull from (x, y) by (dx, dy) pixels, in steps, then release. */
async function pullBy(x, y, dx, dy, { hold = 120, screenshot = null } = {}) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(x + dx * i / 8, y + dy * i / 8); await page.waitForTimeout(15); }
  await page.waitForTimeout(hold);
  if (screenshot) {
    check('The dotted preview shows while pulling', await page.evaluate(() => __demo.scene.getObjectByName('trajectory').visible));
    await page.screenshot({ path: screenshot });
  }
  await page.mouse.up();
}

try {
  await page.goto(`${BASE}?shot=pull&rush=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.evaluate(() => { __demo.state.run.hearts = 5; });
  await page.waitForTimeout(1700);
  check('Pull is the mode', await page.evaluate(() => __demo.shotMode === 'pull'));
  check('Level 1 shows no target', await page.evaluate(() => !__demo.scene.getObjectByName('arcade-target').visible));
  check('The coach shows how to pull', /hold/i.test(await page.textContent('#phase-prompt')));
  check('The HUD says TUTORIAL, not a level', await page.evaluate(() => document.getElementById('hud-level').textContent === 'TUTORIAL'));
  await page.screenshot({ path: '.captures/pull-coach.png' });

  // A session's first two (coached) shots: even sloppy pulls score.
  const warmups = [];
  for (const [dx, dy] of [[0, 60], [180, 120]]) {
    await pullBy(640, 300, dx, dy);
    await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 8000 });
    warmups.push(await page.evaluate(() => __demo.shot.resolved + (__demo.state.run.level === 1 ? '' : '@L' + __demo.state.run.level)));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 8000 });
    await page.evaluate(() => { __demo.state.run.hearts = 5; });
  }
  check('The first two shots are easy: sloppy pulls still score', warmups.every(o => o === 'goal'), warmups.join(','));
  const after = await page.evaluate(() => ({ level: __demo.state.run.level, tutorial: __demo.state.run.tutorial,
    hud: document.getElementById('hud-level').textContent, banner: document.getElementById('banner').textContent,
    target: __demo.scene.getObjectByName('arcade-target').visible, saved: __demo.progress().tutorialDone }));
  check('The tutorial ends into a real Level 1 (no target yet)', !after.tutorial && after.level === 1
    && after.hud === 'LEVEL 1' && /TUTORIAL COMPLETE/.test(after.banner) && !after.target && after.saved, JSON.stringify(after));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  check('The tutorial plays only once', await page.evaluate(() => !__demo.state.run.tutorial
    && document.getElementById('hud-level').textContent === 'LEVEL 1'));
  await page.evaluate(() => { __demo.state.run.hearts = 5; });
  await page.waitForTimeout(1600);

  await pullBy(640, 400, 0, 150, { screenshot: '.captures/pull-mid.png' });
  const straight = await launched();
  check('A straight pull goes through the middle', Math.abs(straight.x) < .4, JSON.stringify(straight));
  await nextChance();

  await pullBy(640, 400, -110, 150);
  const leftPull = await launched();
  check('Pulling down-left shoots right', leftPull.x > 2, JSON.stringify(leftPull));
  await nextChance();

  await pullBy(640, 400, 110, 150);
  const rightPull = await launched();
  check('Pulling down-right shoots left', rightPull.x < -2, JSON.stringify(rightPull));
  await nextChance();

  await pullBy(640, 350, 0, 80);
  const short = await launched();
  await nextChance();
  await pullBy(640, 300, 0, 230);
  const long = await launched();
  check('A longer pull shoots higher', long.y > short.y + .8, JSON.stringify({ short, long }));
  await nextChance();

  await pullBy(640, 400, 0, 12);
  await page.waitForTimeout(300);
  check('A tiny pull is no shot', await page.evaluate(() => __demo.state.phase === 'AIM'));

  // Holding still: the band bounces; releasing at the flash is a SNAP.
  await page.mouse.move(640, 250); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(640, 250 + 190 * i / 8); await page.waitForTimeout(15); }
  // Wait for the flash (the knob turns white), then let go.
  await page.waitForFunction(() => getComputedStyle(document.getElementById('swipe')).getPropertyValue('--pull').trim() === '#ffffff',
    null, { timeout: 3000, polling: 'raf' });
  await page.mouse.up();
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT' || __demo.state.phase === 'WINDUP');
  check('Holding still bounces the band, and a release at the flash is a SNAP', await page.evaluate(() => __demo.shot.snap));
  await nextChance();
  await pullBy(640, 400, 0, 150);
  await page.waitForFunction(() => __demo.state.phase !== 'POWER');
  check('A quick release is not a SNAP', await page.evaluate(() => !__demo.shot.snap));
  await nextChance();

  await page.keyboard.down('Space');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');
  check('The keyboard does not shoot (touch and mouse only)', await page.evaluate(() => __demo.state.phase === 'AIM'));
} catch (error) {
  checks.push({ label: String(error).split('\n')[0], ok: false });
}
await browser.close();
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : '  - ' + c.detail}`);
for (const e of errors) console.log('PAGE ERROR  ' + e);
process.exit(checks.some(c => !c.ok) || errors.length ? 1 : 0);

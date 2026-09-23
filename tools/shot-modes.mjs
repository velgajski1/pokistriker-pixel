// Shot modes: flick (swipe) and free aim (crosshair + hold), driven with the
// real mouse, plus the Alt+9 switch. Checks where each shot is headed at the
// moment it leaves the boot, and screenshots each mode mid-shot.
// Usage: node tools/shot-modes.mjs   (server running)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.DEMO_URL || 'http://localhost:5174/';
const report = { checks: [], errors: [] };
const check = (label, ok, detail = '') => report.checks.push({ label, ok: !!ok, detail });
mkdirSync('.captures', { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => report.errors.push(String(e)));

async function load(mode) {
  await page.goto(`${BASE}?shot=${mode}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await page.evaluate(() => { __demo.state.run.hearts = 5; });
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.waitForTimeout(1600);   // the camera intro
}

/** Where the launched ball is headed on the goal line, with its curve (read at launch). */
const launched = () => page.waitForFunction(() => __demo.state.phase === 'FLIGHT' && __demo.shot.flightTime > 0)
  .then(() => page.evaluate(() => {
    const d = __demo, v = d.ballState.velocity, curve = d.shot.curve;
    // Back out the launch from the first moments of flight.
    const t = (d.dimensions.goal.PLANE_Z - d.ballState.position.z) / v.z;
    return { x: d.ballState.position.x + v.x * t + .5 * curve * t * t, curve, preset: d.shot.preset };
  }));

/** A swipe from (x0, y0) to (x1, y1) in `steps`, bowing sideways by `bow` pixels at its middle. */
async function swipe(x0, y0, x1, y1, { steps = 10, bow = 0, ms = 160 } = {}) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const f = i / steps, b = Math.sin(f * Math.PI) * bow;
    await page.mouse.move(x0 + (x1 - x0) * f + b, y0 + (y1 - y0) * f);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}
const skipHold = async () => {
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, { timeout: 8000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'AIM' || __demo.state.screen !== 'MATCH', null, { timeout: 8000 });
  await page.evaluate(() => { __demo.state.run.hearts = 5; });
};

try {
  // ---- Flick ------------------------------------------------------------------
  await load('flick');
  check('Flick is the default-able mode', await page.evaluate(() => __demo.shotMode === 'flick'));
  check('Flick hides the sweeping arrow', await page.evaluate(() => __demo.state.phase === 'AIM'));
  // Straight up: through the middle, no curve.
  await page.mouse.move(640, 620); await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(640, 620 - i * 40); await page.waitForTimeout(20); }
  await page.screenshot({ path: '.captures/shot-flick-swipe.png' });
  for (let i = 6; i <= 8; i++) { await page.mouse.move(640, 620 - i * 40); await page.waitForTimeout(20); }
  await page.mouse.up();
  let r = await launched();
  check('Flick: a straight swipe goes through the middle', Math.abs(r.x) < 1 && r.curve === 0 && r.preset, JSON.stringify(r));
  await skipHold();
  // Up and to the right: the right side of the goal.
  await swipe(640, 620, 760, 330);
  r = await launched();
  check('Flick: a swipe to the right aims right', r.x > 1.2, JSON.stringify(r));
  await skipHold();
  // Bowed to the right: curls back left, still finishing near its aim.
  await swipe(640, 620, 640, 320, { bow: 90 });
  r = await launched();
  check('Flick: a bowed swipe curls the ball', r.curve < -2 && Math.abs(r.x) < 1.2, JSON.stringify(r));
  await page.waitForTimeout(250);
  await page.screenshot({ path: '.captures/shot-flick-curl.png' });
  await skipHold();
  // Downward: no shot.
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await swipe(640, 300, 640, 600);
  await page.waitForTimeout(300);
  check('Flick: a downward swipe is not a shot', await page.evaluate(() => __demo.state.phase === 'AIM'));

  // ---- Free aim --------------------------------------------------------------
  await load('aim');
  const goalLeft = await page.evaluate(async () => {
    const T = await import('three'), d = __demo;
    const p = new T.Vector3(-2, 1.2, d.dimensions.goal.PLANE_Z).project(d.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  });
  await page.mouse.move(goalLeft.x, goalLeft.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.screenshot({ path: '.captures/shot-aim-charge.png' });
  const charged = await page.evaluate(() => __demo.shot.power);
  await page.mouse.up();
  r = await launched();
  check('Aim: holding charges', charged > .3 && charged <= 1, charged.toFixed(2));
  check('Aim: the shot goes where the crosshair was (within the sway)', Math.abs(r.x + 2) < .9 && r.curve === 0, JSON.stringify(r));
  await skipHold();

  // ---- Alt+9 cycles the modes ----------------------------------------------------
  const modes = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Alt+Digit9');
    await page.waitForTimeout(150);
    modes.push(await page.evaluate(() => __demo.shotMode));
  }
  check('Alt+9 cycles aim -> timing -> flick -> aim', modes.join(',') === 'timing,flick,aim', modes.join(','));
} catch (error) {
  report.checks.push({ label: String(error).split('\n')[0], ok: false });
}
await browser.close();
writeFileSync('.captures/shot-modes.json', JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : '  - ' + (c.detail || '')}`);
for (const e of report.errors) console.log('PAGE ERROR  ' + e);
process.exit(report.checks.some(c => !c.ok) || report.errors.length ? 1 : 0);

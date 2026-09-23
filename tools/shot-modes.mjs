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
  const goalPoint = async () => page.evaluate(async () => {
    const T = await import('three'), d = __demo;
    const p = new T.Vector3(-2, 1.2, d.dimensions.goal.PLANE_Z).project(d.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
  });
  let goalLeft = await goalPoint();
  // A short hold remains close to the point that was pressed.
  await page.mouse.move(goalLeft.x, goalLeft.y);
  await page.mouse.down();
  await page.waitForTimeout(70);
  const quickCharge = await page.evaluate(() => __demo.shot.power);
  await page.mouse.up();
  r = await launched();
  check('Aim: a brief hold stays accurate', quickCharge > 0 && quickCharge < .2 && Math.abs(r.x + 2) < .3,
    JSON.stringify({ charge: quickCharge, shot: r }));
  await skipHold();

  // Near full charge the visible crosshair has drifted outside the goal.
  goalLeft = await goalPoint();
  await page.evaluate(() => { window.__shotModeRandom = __demo.state.run.random; __demo.state.run.random = () => 1; });
  await page.mouse.move(goalLeft.x, goalLeft.y);
  await page.mouse.down();
  await page.waitForFunction(() => __demo.shot.power >= .99);
  await page.screenshot({ path: '.captures/shot-aim-charge.png' });
  const overcharged = await page.evaluate(() => {
    const p = __demo.scene.getObjectByName('aim-crosshair').position;
    return { charge: __demo.shot.power, x: p.x, y: p.y,
      drift: Math.hypot(p.x + 2, p.y - 1.2), halfW: __demo.dimensions.goal.HALF_W, height: __demo.dimensions.goal.HEIGHT };
  });
  await page.mouse.up();
  r = await launched();
  check('Aim: holding charges', overcharged.charge >= .99 && overcharged.charge <= 1, overcharged.charge.toFixed(2));
  check('Aim: overcharging creates a large visible error', overcharged.drift > 3.5, JSON.stringify(overcharged));
  check('Aim: a full charge is outside the goal', Math.abs(overcharged.x) > overcharged.halfW
    || overcharged.y < 0 || overcharged.y > overcharged.height, JSON.stringify(overcharged));
  check('Aim: the shot follows the drifted crosshair', Math.abs(r.x - overcharged.x) < .6 && r.curve === 0,
    JSON.stringify({ crosshair: overcharged.x, shot: r }));
  await skipHold();

  // The opposite random branch mirrors the overcharge to the other side.
  goalLeft = await goalPoint();
  await page.evaluate(() => { __demo.state.run.random = () => 0; });
  await page.mouse.move(goalLeft.x, goalLeft.y);
  await page.mouse.down();
  await page.waitForFunction(() => __demo.shot.power >= .99);
  const opposite = await page.evaluate(() => {
    const p = __demo.scene.getObjectByName('aim-crosshair').position;
    return { x: p.x, y: p.y };
  });
  await page.mouse.up();
  await page.evaluate(() => { __demo.state.run.random = window.__shotModeRandom; });
  check('Aim: overcharge randomly escapes left or right', (overcharged.x + 2) * (opposite.x + 2) < 0,
    JSON.stringify({ first: overcharged, opposite }));
  await skipHold();

  // ---- Classic hold + drag ---------------------------------------------------
  await load('drag');
  const dragBefore = await page.evaluate(() => {
    const p = __demo.scene.getObjectByName('aim-crosshair').position;
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(430, 540);
  await page.mouse.down();
  await page.mouse.move(770, 300, { steps: 8 });
  await page.waitForFunction(() => __demo.shot.power >= .5);
  const dragged = await page.evaluate(() => {
    const p = __demo.scene.getObjectByName('aim-crosshair').position;
    return { x: p.x, y: p.y, charge: __demo.shot.power };
  });
  await page.screenshot({ path: '.captures/shot-drag-charge.png' });
  await page.mouse.up();
  r = await launched();
  check('Drag: holding fills the power bar', dragged.charge >= .5 && dragged.charge <= 1, dragged.charge.toFixed(2));
  check('Drag: the gesture moves aim right and up', dragged.x > dragBefore.x + .8 && dragged.y > dragBefore.y + .5,
    JSON.stringify({ before: dragBefore, after: dragged }));
  check('Drag: release shoots through the visible crosshair', Math.abs(r.x - dragged.x) < .6 && r.curve === 0,
    JSON.stringify({ crosshair: dragged.x, shot: r }));
  await skipHold();

  // ---- Alt+9 cycles the modes ----------------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  check('Timing remains the release default', await page.evaluate(() => __demo.shotMode === 'timing'));
  const modes = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Alt+Digit9');
    await page.waitForTimeout(150);
    modes.push(await page.evaluate(() => __demo.shotMode));
  }
  check('Alt+9 cycles timing -> drag -> flick -> aim -> timing', modes.join(',') === 'drag,flick,aim,timing', modes.join(','));
} catch (error) {
  report.checks.push({ label: String(error).split('\n')[0], ok: false });
}
await browser.close();
writeFileSync('.captures/shot-modes.json', JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : '  - ' + (c.detail || '')}`);
for (const e of report.errors) console.log('PAGE ERROR  ' + e);
process.exit(report.checks.some(c => !c.ok) || report.errors.length ? 1 : 0);

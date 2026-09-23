import { open, assert, startShot } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  await startShot(page);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: '.captures/shot-camera-before.png' });
  const before = await page.evaluate(() => __demo.camera.position.toArray());
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT', null, { polling: 'raf' });
  await page.waitForTimeout(250);
  const during = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const T = await import('three');
    const ball = e.objects.ball.position.clone().project(__demo.camera);
    return { camera: __demo.camera.position.toArray(), ball: ball.toArray(),
      goal: new T.Vector3(0, 1.2, -20).project(__demo.camera).toArray(),
      resolved: __demo.shot.resolved };
  });
  await page.screenshot({ path: '.captures/shot-camera-flight.png' });
  assert(during.camera[2] < before[2] - .1, 'Camera should advance during shot');
  assert(during.camera[2] > -13, 'Camera must stay outside goal');
  assert(Math.abs(during.ball[0]) < 1 && Math.abs(during.ball[1]) < 1, 'Ball visible');
  assert(Math.abs(during.goal[0]) < 1 && Math.abs(during.goal[1]) < 1, 'Goal visible');

  // Portrait uses its own wider composition: goal, ball and the whole striker
  // remain visible during selection and while the shot camera advances.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await startShot(page);
  await page.waitForTimeout(700);
  const portraitFrame = () => page.evaluate(async () => {
    const T = await import('three');
    const d = __demo, goal = d.dimensions.goal;
    const striker = d.players.find(player => player.role === 'striker').root.position;
    const project = (x, y, z) => new T.Vector3(x, y, z).project(d.camera).toArray();
    return {
      portrait: d.matchView.portrait,
      ball: project(d.ball.position.x, d.ball.position.y, d.ball.position.z),
      striker: [project(striker.x, 0, striker.z), project(striker.x, 2.1, striker.z)],
      goal: [project(-goal.POST_X, 0, goal.PLANE_Z), project(goal.POST_X, 0, goal.PLANE_Z),
        project(-goal.POST_X, goal.BAR_Y, goal.PLANE_Z), project(goal.POST_X, goal.BAR_Y, goal.PLANE_Z)],
    };
  });
  const visible = point => Math.abs(point[0]) < .95 && Math.abs(point[1]) < .95;
  const portraitAim = await portraitFrame();
  assert(portraitAim.portrait, 'Portrait camera was not detected');
  assert(visible(portraitAim.ball) && portraitAim.striker.every(visible) && portraitAim.goal.every(visible),
    'Portrait aim must show the ball, whole striker and whole goal');
  await page.screenshot({ path: '.captures/shot-camera-portrait-aim.png' });
  await page.keyboard.press('Space');
  await page.waitForTimeout(220);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT', null, { polling: 'raf' });
  await page.waitForTimeout(180);
  const portraitFlight = await portraitFrame();
  assert(visible(portraitFlight.ball) && portraitFlight.striker.every(visible) && portraitFlight.goal.every(visible),
    'Portrait flight must show the ball, whole striker and whole goal');
  await page.screenshot({ path: '.captures/shot-camera-portrait-flight.png' });

  const portraitExtremes = [];
  for (const origin of [{ x: 0, z: -11 }, { x: -12, z: 12 }, { x: 12, z: 12 }]) {
    await page.evaluate(async origin => {
      const e = await import('/js/gameEngine.js');
      __demo.state.phase = 'AIM';
      e.setupChance({ x: origin.x, y: __demo.dimensions.ballRadius, z: origin.z }, 2, false);
    }, origin);
    await page.waitForTimeout(750);
    const frame = await portraitFrame();
    portraitExtremes.push({ origin, frame });
    assert(visible(frame.ball) && frame.striker.every(visible) && frame.goal.every(visible),
      `Portrait camera clipped a close or wide chance at ${origin.x},${origin.z}`);
  }

  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    e.setupChance({ x: 0, y: __demo.dimensions.ballRadius, z: 0 }, 0, false);
    e.setBall({ x: 6, y: 1, z: -10 });
    e.onFrame(dt => e.followReboundCamera(dt));
  });
  await page.waitForTimeout(1200);
  const portraitRebound = await portraitFrame();
  assert(visible(portraitRebound.ball) && portraitRebound.striker.every(visible)
    && portraitRebound.goal.every(visible),
    'Portrait rebound must keep the ball, whole striker and whole goal composed');
  await page.screenshot({ path: '.captures/shot-camera-portrait-rebound.png' });
  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({ before, during, portraitAim, portraitFlight,
    portraitExtremes, portraitRebound, errors }, null, 2));
} finally { await browser.close(); }

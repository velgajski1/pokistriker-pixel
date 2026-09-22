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
  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({ before, during, errors }, null, 2));
} finally { await browser.close(); }

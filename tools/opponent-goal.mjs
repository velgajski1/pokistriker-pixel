import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.evaluate(() => {
    __demo.state.screen = 'MENU';
    localStorage.setItem('benched.career.v1', JSON.stringify({ tutorialComplete: true }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo?.ready);
  await page.keyboard.press('Digit1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Kick Off', exact: true }).click();
  await page.evaluate(() => {
    const d = __demo;
    d.state.run.enemyCredit = 1;
    d.state.run.building = false;
    d.state.run.schedule = [85];
  });
  await page.waitForFunction(() => __demo.state.phase === 'ENEMY_GOAL');
  const initial = await page.evaluate(() => ({ score: __demo.state.run.enemyGoals, clock: __demo.state.run.clock }));
  await page.waitForFunction(() => __demo.state.run.enemyPause < 2.2);
  await page.screenshot({ path: '.captures/opponent-goal-shot.png' });
  await page.waitForFunction(() => __demo.state.run.enemyPause < 1.5);
  const net = await page.evaluate(async () => {
    const { GOAL, PITCH } = await import('/js/physics.js');
    return { inside: __demo.ball.position.z > GOAL.PLANE_Z + PITCH.LENGTH,
      lowCamera: __demo.camera.position.y < 10, clock: __demo.state.run.clock };
  });
  assert(net.inside && net.lowCamera, 'Ball must enter home net in the action camera');
  assert(net.clock === initial.clock, 'Match clock must pause during presentation');
  await page.screenshot({ path: '.captures/opponent-goal-net.png' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo?.ready);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => __demo.state.phase === 'ENEMY_GOAL');
  await page.waitForFunction(() => __demo.state.phase === 'SIM');
  assert(await page.evaluate(score => __demo.state.run.enemyGoals === score
    && __demo.camera.position.y > 40, initial.score), 'Resume must return overhead without awarding another goal');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: opponent shot, home net entry, action camera, paused clock, reload and overhead return; score awarded once.');
} finally { await browser.close(); }

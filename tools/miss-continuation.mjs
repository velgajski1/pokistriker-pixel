import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.evaluate(() => { __demo.state.run.schedule[0] = __demo.state.run.clock + .8; });
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.keyboard.press('Space'); await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  await page.evaluate(() => {
    __demo.shot.flightTime = 7; __demo.shot.contactCool = 1;
    Object.assign(__demo.ballState.position, { x: 10, y: .11, z: 10 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 1 });
  });
  await page.waitForFunction(() => __demo.shot.resolved !== null);
  const before = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    __demo.shot.holdTimer = 6;
    e.startReaction('shooter', 'react_confused');
    return __demo.players.map(p => ({ x: p.root.position.x, z: p.root.position.z }));
  });
  await page.waitForTimeout(1200);
  const report = await page.evaluate(async before => {
    const e = await import('/js/gameEngine.js');
    const moving = __demo.players.filter((p, i) => p.role !== 'keeper' && p.role !== 'striker'
      && Math.hypot(p.root.position.x - before[i].x, p.root.position.z - before[i].z) > .2).length;
    return { moving, shooterStill: Math.hypot(__demo.striker.root.position.x - before[1].x,
      __demo.striker.root.position.z - before[1].z) < .001,
      reaction: e.reactions.shooter.name, chasing: e.formation.pressers.filter(p => p?.chasing).length,
      attacker: !!e.formation.attacker && e.formation.attacker.rig.root !== __demo.striker.root };
  }, before);
  assert(report.moving >= 10 && report.shooterStill && report.reaction === 'react_confused' && report.chasing === 2 && report.attacker,
    'In-bounds miss did not continue play around the reacting shooter: ' + JSON.stringify(report));
  const outside = await page.evaluate(async () => {
    Object.assign(__demo.ballState.position, { x: 40, y: .11, z: 10 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 0 });
    return (await import('/js/app.js')).missedBallInPlay();
  });
  assert(!outside, 'Outside ball must not continue live play');
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => !__demo.formation.pressers.some(p => p?.chasing)), 'Defenders chased outside ball');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }

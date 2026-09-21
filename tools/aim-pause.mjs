import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  const snapshot = () => page.evaluate(() => {
    const d = __demo, transforms = [];
    for (const p of d.players) p.root.traverse(n => {
      transforms.push(...n.position.toArray(), ...n.quaternion.toArray());
    });
    return { transforms, crowd: d.crowd.time, aim: d.shot.aimX, power: d.shot.power };
  });
  const before = await snapshot();
  assert(await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const model = __demo.players.find(p => p.role === 'striker').model;
    const left = model.getObjectByName('mixamorigLeftShoulder');
    const right = model.getObjectByName('mixamorigRightShoulder');
    const across = left.getWorldPosition(left.position.clone()).sub(right.getWorldPosition(right.position.clone()));
    const delta = Math.atan2(-across.z, across.x) - Math.atan2(e.chance.dirX, e.chance.dirZ);
    return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 1e-5;
  }), 'Frozen striker torso must face the goal');
  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    e.captureSelectionPoses();
    e.setKeeper(__demo.players[0].root.position.x, .8, 1, .5, .2, 0);
    e.restoreSelectionPoses();
  });
  const retained = await snapshot();
  assert(JSON.stringify(before.transforms) === JSON.stringify(retained.transforms),
    'Selection replaced the existing player pose');
  assert(await page.evaluate(() => __demo.striker.mixer.timeScale === 0
    && __demo.players.every(p => !p.rig.avatar || p.rig.avatar.mixer.timeScale === 0)),
  'Every player animation mixer must pause');
  // Even a late procedural update must not leak into the rendered frozen pose.
  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    e.setKeeper(__demo.players[0].root.position.x + .5, .3, 1, 0, 0, 0);
    __demo.players.find(p => p.team === 'away' && p.role === 'outfield').root.position.x += .25;
  });
  await page.waitForTimeout(700);
  const aim = await snapshot();
  assert(JSON.stringify(before.transforms) === JSON.stringify(aim.transforms), 'Players moved while aiming');
  assert(before.crowd === aim.crowd && before.aim !== aim.aim, 'Crowd must pause while aim controls continue');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'POWER');
  const powerBefore = await snapshot();
  await page.waitForTimeout(500);
  const powerAfter = await snapshot();
  assert(JSON.stringify(powerBefore.transforms) === JSON.stringify(powerAfter.transforms), 'Players moved while choosing power');
  assert(powerBefore.crowd === powerAfter.crowd && powerBefore.power !== powerAfter.power, 'Power controls must remain active');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  const resumed = await snapshot();
  assert(await page.evaluate(() => __demo.striker.mixer.timeScale === 1
    && __demo.players.every(p => !p.rig.avatar || p.rig.avatar.mixer.timeScale === 1)),
  'Every player animation mixer must resume');
  assert(resumed.crowd > powerAfter.crowd && JSON.stringify(resumed.transforms) !== JSON.stringify(powerAfter.transforms), 'Animations did not resume');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: all player poses and crowd freeze during AIM/POWER; controls stay active and animations resume for the shot.');
} finally { await browser.close(); }

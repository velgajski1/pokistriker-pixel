import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.evaluate(() => { __demo.state.run.schedule[0] = __demo.state.run.clock + .8; });
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.keyboard.press('Space'); await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  await page.evaluate(() => {
    __demo.shot.entered = true; __demo.shot.contactCool = 1;
    Object.assign(__demo.ballState.position, { x: 0, y: .5, z: -20.3 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 0 });
  });
  await page.waitForFunction(() => __demo.shot.resolved === 'goal');
  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    window.__defenders = e.defenderReactions;
    __demo.shot.holdTimer = 7;
    window.__startDefenders = __defenders.tracks.map(t => ({ x: t.rig.root.position.x, z: t.rig.root.position.z }));
  });
  for (const delay of [500, 4500]) {
    await page.waitForTimeout(delay);
    const report = await page.evaluate(() => __defenders.tracks.map((t, i) => {
      const a = t.rig.avatar, previous = __startDefenders[i];
      const result = { sad: t.sad, distance: Math.hypot(t.rig.root.position.x - previous.x, t.rig.root.position.z - previous.z),
        walking: a.actions.walk.getEffectiveWeight() + a.actions.react_walk_sad.getEffectiveWeight(),
        idle: a.actions.idle.getEffectiveWeight() + a.actions.alert.getEffectiveWeight(), time: t.time };
      previous.x = t.rig.root.position.x; previous.z = t.rig.root.position.z;
      return result;
    }));
    assert(report.length === 10 && report.filter(t => t.sad).length === 5, 'All ten defenders need varied walking reactions');
    assert(report.every(t => t.distance > .15 && t.walking > .999 && t.idle === 0), 'Defender stopped, idled or had reaction overwritten');
    console.log(JSON.stringify(report));
  }
  await page.waitForFunction(() => __demo.state.phase === 'SIM');
  assert(await page.evaluate(() => !__defenders.active), 'Walking reactions did not clear for resumed match');
  assert(!errors.length, errors.join('\n'));
} finally { await browser.close(); }

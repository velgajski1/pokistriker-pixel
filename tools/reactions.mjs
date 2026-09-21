import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    e.parade(0, 2);
    document.getElementById('overlay').style.display = 'none';
  });
  const results = [];
  for (const role of ['keeper', 'shooter']) for (const name of ['react_stomp', 'react_shout', 'react_confused', 'react_walk_sad']) {
    const duration = await page.evaluate(async ({ role, name }) => {
      const e = await import('/js/gameEngine.js');
      e.stopReactions();
      return e.startReaction(role, name);
    }, { role, name });
    await page.waitForTimeout(450);
    const result = await page.evaluate(async role => {
      const e = await import('/js/gameEngine.js');
      const track = e.reactions[role];
      // Normal controllers must not overwrite a reaction after the verdict.
      e.setKeeper(10, 1, 1, 1, 1, 1);
      e.setStrikerKick(1, 1);
      return { name: track.name, weight: track.avatar.actions[track.name].getEffectiveWeight(),
        time: track.time, x: track.rig.root.position.x };
    }, role);
    assert(result.name === name && result.weight > .99 && result.time > 0, `${role} reaction was overwritten`);
    assert(duration > 1 && duration <= 4.8, 'Reaction duration outside expected range');
    await page.screenshot({ path: `.captures/${role}-${name}.png` });
    results.push({ role, name, duration });
  }
  await page.reload();
  await page.waitForFunction(() => __demo?.ready);
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  await page.evaluate(() => {
    __demo.shot.contactCool = 1;
    Object.assign(__demo.ballState.position, { x: 35, y: .5, z: -10 });
    Object.assign(__demo.ballState.velocity, { x: 0, y: 0, z: 0 });
  });
  await page.waitForFunction(() => __demo.shot.resolved !== null);
  assert(await page.evaluate(async () => !!(await import('/js/gameEngine.js')).reactions.shooter.name), 'Miss did not trigger shooter reaction');
  await page.waitForFunction(() => __demo.state.phase !== 'FLIGHT');
  assert(await page.evaluate(async () => !(await import('/js/gameEngine.js')).reactions.shooter.name), 'Reaction did not clear');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

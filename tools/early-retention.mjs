import { open, assert } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  const checks = await page.evaluate(async () => {
    const app = await import('/js/app.js');
    const checks = [];
    const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
    const fresh = (level = 1, hearts = 3) => ({ ...__demo.state.run,
      level, hearts, levelGoals: 0, combo: 0, assistShots: 0, freeMiss: false,
      introPending: null, daily: false });
    for (const level of [1, 2, 3, 4]) {
      const r = fresh(level, 1);
      const needed = level <= 3 ? 2 : 3;
      for (let i = 1; i <= needed; i++) {
        const result = app.scoreShot(r, 'goal', 'target');
        check(`Level ${level}: goal ${i} advances only at ${needed}`, result.levelUp === (i === needed));
      }
      check(`Level ${level}: recovery only entering 2/3`, r.hearts === (level < 3 ? 2 : 1));
    }
    for (const hearts of [2, 3, 4, 5]) {
      const r = fresh(1, hearts); r.levelGoals = 1;
      app.scoreShot(r, 'goal', 'target');
      check(`Recovery preserves cap and bonus hearts (${hearts})`, r.hearts === Math.max(hearts, 3));
    }
    const r = fresh();
    app.scoreShot(r, 'wide', null);
    check('Miss arms two assisted shots', r.assistShots === 2 && r.hearts === 2);
    app.scoreShot(r, 'goal', 'target');
    check('First success leaves one assisted shot', r.assistShots === 1);
    app.scoreShot(r, 'wide', null);
    check('Another miss refreshes assistance', r.assistShots === 2);
    app.scoreShot(r, 'goal', 'target'); app.scoreShot(r, 'goal', 'target');
    check('Assistance expires after two successful shots', r.assistShots === 0);
    r.freeMiss = true; const hearts = r.hearts;
    app.scoreShot(r, 'save', null, false, 'golden');
    check('Protected special miss costs no heart and still assists', r.hearts === hearts && r.assistShots === 2);
    r.freeMiss = false;
    app.scoreShot(r, 'save', null, false, 'golden');
    check('Later special misses cost a heart', r.hearts === hearts - 1);
    check('Combo ramps gently and caps', app.timingFactor(0) === 1 && app.timingFactor(2) === 1.025
      && app.timingFactor(5) === 1.1 && app.timingFactor(50) === 1.1);
    check('Shot distance never accelerates aim', app.sweepSpeedAt(5, 9) === app.sweepSpeedAt(5, 32));
    check('Early difficulty stays intact and later growth slows', app.difficultyLevel(1) === 1
      && app.difficultyLevel(5) === 5 && Math.abs(app.difficultyLevel(7) - 5.7) < 1e-9 && Math.abs(app.difficultyLevel(15) - 8.5) < 1e-9);
    check('No defenders before level 7', app.defenceFor(6, 18, () => 0).blockers === 0);
    check('Level 7 brings a defender about a third of the time', app.defenceFor(7, 18, () => .29).blockers === 1
      && app.defenceFor(7, 18, () => .31).blockers === 0);
    check('Defenders gain strength gradually', Math.abs(app.defenceFor(7, 18).strength - .2 / 6) < 1e-9);
    check('Never two defenders in the fifteen levels', app.defenceFor(15, 30, () => 0).blockers === 1);
    check('Level 5 timing remains close to opening speed', app.sweepSpeedAt(5) / app.sweepSpeedAt(1) < 1.1
      && app.powerCycle(5) / app.powerCycle(1) < 1.1);
    check('Recovery overrides combo', app.timingFactor(5, true) === .85);
    const normal = app.keeperAbility(3, 12), assisted = app.keeperAbility(3, 12, null, false, true);
    check('Assisted keeper reacts later and reads less accurately', assisted.reaction > normal.reaction
      && assisted.readError > normal.readError && assisted.diveSpeed < normal.diveSpeed);
    const daily = fresh(); daily.daily = true;
    app.scoreShot(daily, 'wide', null);
    check('Daily does not gain assistance or lose hearts', daily.assistShots === 0 && daily.hearts === 3);
    return checks;
  });
  // Exercise real chance setup, HUD and level transition after a resolved shot.
  async function next(config) {
    await page.evaluate(async config => {
      const app = await import('/js/app.js');
      const d = __demo, r = d.state.run;
      Object.assign(r, config);
      if (config.levelGoal) r.levelUpPending = app.scoreShot(r, 'goal', 'target').levelUp;
      d.shot.resolved = 'goal'; d.shot.holdTimer = 0;
      d.state.phase = 'FLIGHT';
    }, config);
    await page.waitForFunction(() => __demo.state.phase === 'AIM');
    return page.evaluate(() => ({ special: __demo.state.run.special, free: __demo.state.run.freeMiss,
      assisted: __demo.shot.assisted, timing: __demo.shot.timingFactor,
      tag: document.getElementById('hud-special').textContent,
      banner: document.getElementById('banner').textContent }));
  }
  for (const level of [1, 2]) {
    const s = await next({ level, levelGoals: 1, hearts: 1, levelGoal: true });
    assert(s.special === (level === 1 ? 'golden' : 'moving') && s.free, 'Guaranteed protected special');
    assert(s.tag.includes('FREE MISS') && s.banner.includes('+1 HEART'), 'Recovery and protection visible');
    const after = await next({ levelGoal: false });
    assert(!after.free, 'Protection expires after introductory chance');
  }
  const assisted = await next({ assistShots: 2, combo: 5 });
  assert(assisted.assisted && assisted.timing === .85, 'Real chance uses recovery instead of combo');
  const combo = await next({ assistShots: 0, combo: 5 });
  assert(!combo.assisted && combo.timing === 1.1, 'Real chance uses combo boost');
  const boss = await next({ level: 3, levelGoals: 1, hearts: 3, levelGoal: true });
  assert(boss.special === 'boss' && boss.banner.includes('BOSS KEEPER'), `Level 4 opens with boss and announces it: ${JSON.stringify(boss)}`);
  assert(await page.evaluate(() => __demo.state.run.fireLeft === 0), 'Level 4 queues no fire round');
  await next({ levelGoal: false });
  const five = await next({ level: 4, levelGoals: 2, levelGoal: true });
  assert(five.special !== 'boss' && five.special !== 'fire', 'Level 5 does not repeat the first boss');
  const seven = await next({ level: 6, levelGoals: 2, levelGoal: true });
  assert(seven.special === 'fire', 'Finishing level 6 earns a fire bonus level');
  const last = await next({ level: 14, levelGoals: 2, fireLeft: 0, levelGoal: true });
  assert(last.special === 'boss', 'The final level (15) is the boss keeper');
  await next({ levelGoal: false });
  const daily = await next({ daily: true, assistShots: 2, combo: 5 });
  assert(!daily.assisted && daily.timing === 1, 'Daily chance ignores adaptive tuning');
  assert(errors.length === 0, errors.join('\n'));
  console.log(`PASS: ${checks.length} rule checks and live special/assistance/HUD transitions`);
} finally {
  await browser.close();
}

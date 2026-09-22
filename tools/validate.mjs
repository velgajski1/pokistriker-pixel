// Arcade smoke test: boots to the title, plays aimed shots through real input,
// checks scoring, the target/keeper rule, a level-up, the extra life, game over
// and the saved best, and samples frame timing while aiming.
// Usage: node tools/validate.mjs [captureName=check]
import { writeFileSync } from 'node:fs';
import { CAPTURES, assert, open, frameStats, gpuString } from './lib.mjs';

const name = process.argv[2] || 'check';
assert(/^[a-zA-Z0-9_-]+$/.test(name), 'Capture name must contain only letters, digits, underscores or hyphens');
const report = { errors: [], failures: [], warnings: [], shots: [], frameStats: null, gpu: null };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  page.setDefaultTimeout(30000);
  report.gpu = await gpuString(page);
  await page.evaluate(() => localStorage.removeItem('blockstriker.best.v1'));
  // Poki: straight into play, no menus; gameplay starts on the first input, not on load.
  assert(await page.evaluate(() => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM'),
    'Boot must go straight into the first chance');
  assert(await page.evaluate(() => !__demo.poki.playing()), 'gameplayStart must wait for the first input');

  /** waitForFunction that says what it was waiting for when it times out. */
  const until = (label, fn, arg) => page.waitForFunction(fn, arg, { polling: 'raf' })
    .catch(error => { throw new Error(`${label}: ${error.message.split(String.fromCharCode(10))[0]}`); });
  const phase = wanted => until(`phase ${wanted}`, value => __demo.state.phase === value, wanted);
  /** Aim at the target and set its height, through the real keyboard input. */
  const shoot = async ({ offTarget = false } = {}) => {
    await phase('AIM');
    const before = await page.evaluate(() => ({ ...__demo.state.run }));
    await until(offTarget ? 'arrow wide' : 'arrow on target', off => {
      const d = __demo, t = d.target;
      return d.state.phase === 'AIM' && (off ? Math.abs(d.shot.aimX) > 4.2 : Math.abs(d.shot.aimX - t.x) < .3);
    }, offTarget);
    await page.keyboard.press('Space');
    await phase('POWER');
    await until('height on target', () => {
      const d = __demo;
      return d.state.phase === 'POWER' && d.shot.powerDir > 0 && Math.abs(d.prediction.y - d.target.y) < .2;
    });
    await page.keyboard.press('Space');
    await until('shot resolved', () => __demo.shot.resolved !== null);
    const result = await page.evaluate(() => ({ outcome: __demo.shot.resolved, tier: __demo.shot.precision,
      points: __demo.shot.points, run: { ...__demo.state.run } }));
    report.shots.push({ outcome: result.outcome, tier: result.tier, points: result.points,
      level: result.run.level, hearts: result.run.hearts });
    if (result.outcome === 'goal') {
      assert(result.run.score === before.score + result.points && result.points > 0, 'Goal must add its points');
    } else {
      assert(result.run.hearts === before.hearts - 1, 'A non-goal must cost a heart');
    }
    return result;
  };

  await phase('AIM');
  // The target never hangs over the keeper.
  const clear = await page.evaluate(() => {
    const d = __demo;
    return Math.abs(d.target.x - d.shot.keeperSetX);
  });
  assert(clear >= 1.69, `Bullseye too close to the keeper (${clear.toFixed(2)} m)`);
  await page.screenshot({ path: `${CAPTURES}/${name}-aim.png` });

  // Frame timing while the arena plays on behind the aim arrow.
  const frames = await page.evaluate(() => new Promise(resolve => {
    const samples = [];
    let last;
    const tick = time => {
      if (last !== undefined) samples.push(time - last);
      last = time;
      if (samples.length < 240) requestAnimationFrame(tick); else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  report.frameStats = frameStats(frames);
  if (report.frameStats.p95 >= 25) {
    const message = `Frame p95 ${report.frameStats.p95.toFixed(2)} ms exceeds budget`;
    if (/SwiftShader|llvmpipe/i.test(report.gpu)) report.warnings.push(message);
    else report.failures.push(message);
  }

  // Pause and resume with Esc: play stops, the panel shows, play resumes.
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => __demo.state.paused && !__demo.poki.playing()), 'Esc must pause and stop gameplay');
  assert(await page.getByRole('button', { name: 'RESUME', exact: true }).isVisible(), 'Pause must offer RESUME');
  await page.screenshot({ path: `${CAPTURES}/${name}-pause.png` });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !__demo.state.paused);

  // Early levels: aimed shots should go in against the rookie keeper.
  let goals = 0;
  for (let i = 0; i < 3; i++) {
    const result = await shoot();
    if (result.outcome === 'goal') goals++;
    if (i === 0) {
      await page.screenshot({ path: `${CAPTURES}/${name}-verdict.png` });
      assert(await page.evaluate(() => __demo.poki.playing()), 'The first shot must have started gameplay');
    }
  }
  assert(goals >= 2, `Aimed early shots should mostly score (${goals}/3)`);

  // Extra life (early, weak keeper): force a heart into the target, then hit it.
  await phase('AIM');
  const livesBefore = await page.evaluate(() => __demo.state.run.extraLives);
  await page.evaluate(async () => {
    const d = __demo;
    d.state.run.hearts = 2;
    d.target.heart = true;
    const engine = await import('/js/gameEngine.js');
    engine.setTarget(d.target.x, d.target.y, d.target.ring, d.target.bull, true);
  });
  await page.screenshot({ path: `${CAPTURES}/${name}-heart.png` });
  const heartShot = await shoot();
  if (heartShot.outcome === 'goal' && heartShot.tier !== 'goal') {
    assert(heartShot.run.hearts === 3 && heartShot.run.extraLives === livesBefore + 1, 'Target hit must collect the extra life');
  } else report.warnings.push(`Extra-life shot was ${heartShot.outcome}/${heartShot.tier}; not asserted`);

  // Level-up on the last goal of a level.
  await page.evaluate(() => { __demo.state.run.levelGoals = __demo.arcade.GOALS_PER_LEVEL - 1; });
  let levelled = false;
  for (let i = 0; i < 4 && !levelled; i++) {
    await phase('AIM');
    // Test the level-up rule, not the keeper: shoot from level 1, one goal short of a new level.
    const before = await page.evaluate(() => {
      const run = __demo.state.run;
      run.hearts = __demo.arcade.MAX_HEARTS; run.level = 1; run.levelGoals = __demo.arcade.GOALS_PER_LEVEL - 1;
      return run.level;
    });
    const result = await shoot();
    levelled = result.outcome === 'goal' && result.run.level === before + 1;
  }
  assert(levelled, 'The last goal of a level must raise the level');
  await phase('AIM');
  await page.screenshot({ path: `${CAPTURES}/${name}-level.png` });

  // Game over: last heart, a shot far wide, then the saved best.
  await phase('AIM');
  await page.evaluate(() => { __demo.state.run.hearts = 1; });
  const wide = await shoot({ offTarget: true });
  assert(wide.outcome !== 'goal', 'A shot outside the posts must not score');
  await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER', null, { timeout: 8000 });
  assert(await page.evaluate(() => !__demo.poki.playing()), 'Game over must stop gameplay');
  await page.screenshot({ path: `${CAPTURES}/${name}-gameover.png` });
  const saved = await page.evaluate(() => ({ best: Number(localStorage.getItem('blockstriker.best.v1')),
    score: __demo.state.run.score }));
  assert(saved.best === saved.score && saved.best > 0, 'Game over must save the best score');
  assert(await page.getByRole('button', { name: 'PLAY AGAIN', exact: true }).isVisible(), 'Game over must offer PLAY AGAIN');
  await page.getByRole('button', { name: 'PLAY AGAIN', exact: true }).click();
  await phase('AIM');
  assert(await page.evaluate(() => __demo.state.run.score === 0 && __demo.state.run.hearts === __demo.arcade.HEARTS),
    'PLAY AGAIN must start a fresh run');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Runtime errors occurred');
  const json = JSON.stringify(report, null, 2);
  writeFileSync(`${CAPTURES}/${name}.json`, `${json}\n`);
  console.log(json);
  process.exitCode = report.failures.length ? 1 : 0;
}

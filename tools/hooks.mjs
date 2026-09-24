// Retention hooks: special chances, missions, XP and the locker, checkpoints,
// the daily challenge and persistence, driven through real input where it
// matters. Screenshots land in .captures/hooks-*.png.
// Usage: node tools/hooks.mjs   (server running)
import { writeFileSync } from 'node:fs';
import { CAPTURES, open, pastSelect } from './lib.mjs';

const report = { errors: [], failures: [], checks: [], shots: [] };
const check = (label, ok, detail = '') => {
  report.checks.push({ label, ok: !!ok, detail });
  if (!ok) report.failures.push(`${label}${detail ? ': ' + detail : ''}`);
};
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  page.setDefaultTimeout(30000);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  await pastSelect(page);

  const until = (label, fn, arg) => page.waitForFunction(fn, arg, { polling: 'raf', timeout: 30000 })
    .catch(error => { throw new Error(`${label}: ${error.message.split('\n')[0]}`); });
  const phase = wanted => until(`phase ${wanted}`, value => __demo.state.phase === value, wanted);
  const shot = page.evaluate.bind(page);

  /** Aim through the real keyboard; skips the result hold with a tap. */
  async function shoot({ offTarget = false, keepHold = false } = {}) {
    await phase('AIM');
    await until(offTarget ? 'arrow wide' : 'arrow on target', off => {
      const d = __demo;
      return d.state.phase === 'AIM' && (off ? Math.abs(d.shot.aimX) > 4.2 : Math.abs(d.shot.aimX - d.target.x) < .3);
    }, offTarget);
    await page.keyboard.press('Space');
    // A fire shot goes on the first press, straight at the target.
    if (await shot(() => __demo.shot.fire)) return fired(keepHold);
    await phase('POWER');
    await until('height on target', () => {
      const d = __demo;
      return d.state.phase === 'POWER' && d.shot.powerDir > 0 && Math.abs(d.prediction.y - d.target.y) < .2;
    });
    await page.keyboard.press('Space');
    await until('shot resolved', () => __demo.shot.resolved !== null);
    const result = await shot(() => ({ outcome: __demo.shot.resolved, tier: __demo.shot.precision,
      points: __demo.shot.points, hold: __demo.shot.holdTimer, run: { ...__demo.state.run, random: null, tally: null } }));
    report.shots.push({ outcome: result.outcome, tier: result.tier, points: result.points, special: result.run.special });
    if (!keepHold) { await page.waitForTimeout(250); await page.keyboard.press('Space'); }
    return result;
  }
  async function fired(keepHold) {
    await until('shot resolved', () => __demo.shot.resolved !== null);
    const result = await shot(() => ({ outcome: __demo.shot.resolved, tier: __demo.shot.precision,
      points: __demo.shot.points, hold: __demo.shot.holdTimer, run: { ...__demo.state.run, random: null, tally: null } }));
    report.shots.push({ outcome: result.outcome, tier: result.tier, points: result.points, special: result.run.special });
    if (!keepHold) { await page.waitForTimeout(250); await page.keyboard.press('Space'); }
    return result;
  }
  const topUpHearts = () => shot(() => { __demo.state.run.hearts = 5; });
  /** Last heart, shots wide, until the run ends (a bonus-round miss is free). */
  async function loseRun() {
    for (let i = 0; i < 6; i++) {
      await shot(() => { const run = __demo.state.run; run.hearts = 1; run.bonusLeft = 0; run.bossPending = false; });
      await shoot({ offTarget: true, keepHold: true });
      const over = await page.waitForFunction(() => __demo.state.screen === 'GAMEOVER' || __demo.state.phase === 'AIM',
        null, { timeout: 10000 }).then(() => shot(() => __demo.state.screen === 'GAMEOVER'));
      if (over) return;
    }
    throw new Error('the run would not end');
  }

  // ---- Pacing ---------------------------------------------------------------
  await phase('AIM');
  check('HUD shows the rank', (await page.textContent('#hud-rank')) === 'ROOKIE');
  let first;
  for (let i = 0; i < 6; i++) {
    await topUpHearts();
    first = await shoot({ keepHold: true });
    if (first.outcome === 'goal') break;
    await page.keyboard.press('Space');
  }
  check('A goal holds at least 2.5 s before the next chance', first.outcome === 'goal' && first.hold >= 2.4,
    `outcome ${first.outcome}, hold ${first.hold?.toFixed(2)}`);
  await page.keyboard.press('Space');

  // ---- Special chances ------------------------------------------------------
  const specials = {};
  for (const kind of ['golden', 'moving', 'freekick', 'boss', 'fire']) {
    await phase('AIM');
    await shot(k => __demo.forceSpecial(k), kind);
    await topUpHearts();
    await shoot();                       // the forced special is the NEXT chance
    await phase('AIM');
    const info = await shot(async () => {
      const d = __demo, T = await import('three');
      const keeper = d.players.find(p => p.role === 'keeper' && p.team === 'away');
      const ball = d.ball.material.color.getHex();
      const origin = d.ball.position;
      const walls = d.players.filter(p => p.team === 'away' && p.role === 'outfield')
        .map(p => Math.hypot(p.root.position.x - origin.x, p.root.position.z - origin.z));
      return { special: d.state.run.special, ball, keeperScale: keeper.root.scale.y, keeperX: d.shot.keeperSetX,
        targetX: d.target.x, tag: document.getElementById('hud-special').textContent,
        tagShown: document.getElementById('hud-special').classList.contains('show'),
        wallDistances: walls.sort((a, b) => a - b).slice(0, 2), hearts: d.state.run.hearts, T: !!T };
    });
    // The target's travel over a second (it slows at the ends of its swing).
    const moved = await shot(() => new Promise(resolve => {
      let lo = Infinity, hi = -Infinity;
      const start = performance.now();
      const sample = () => {
        lo = Math.min(lo, __demo.target.x); hi = Math.max(hi, __demo.target.x);
        if (performance.now() - start < 1000) requestAnimationFrame(sample); else resolve(hi - lo);
      };
      sample();
    }));
    await page.screenshot({ path: `${CAPTURES}/hooks-${kind}.png` });
    specials[kind] = info;
    check(`${kind}: planned and tagged in the HUD`, info.special === kind && info.tagShown, `${info.special} "${info.tag}"`);
    if (kind === 'golden') check('golden: gold ball', info.ball === 0xffd23f, info.ball.toString(16));
    if (kind === 'moving') check('moving: target slides', moved > .1, `travelled ${moved.toFixed(2)} m in 1 s`);
    if (kind === 'freekick') check('freekick: two-man wall at 9.15 m',
      info.wallDistances.length === 2 && info.wallDistances.every(d => Math.abs(d - 9.15) < .6), JSON.stringify(info.wallDistances));
    if (kind === 'boss') check('boss: a bigger keeper', info.keeperScale > 1.07, info.keeperScale.toFixed(3));
    if (kind === 'fire') check('fire: a flaming ball and a burning screen', info.ball === 0xffa23a
      && await shot(() => document.body.classList.contains('on-fire')), info.ball.toString(16));
    const heartsBefore = info.hearts;
    const result = kind === 'fire' ? await shoot({ offTarget: true }) : await shoot();
    if (kind === 'fire') check('fire: any press flies into the target', result.outcome === 'goal', result.outcome);
    if (kind === 'boss' && result.outcome === 'goal') check('boss: beating him pays a heart', result.run.hearts >= Math.min(5, heartsBefore));
    await phase('AIM');
    const after = await shot(() => ({ scale: __demo.players.find(p => p.role === 'keeper' && p.team === 'away').root.scale.y,
      ball: __demo.ball.material.color.getHex(), special: __demo.state.run.special }));
    if (kind === 'boss') check('boss: keeper back to size afterwards', after.scale < 1.09 || after.special === 'boss',
      `${after.scale.toFixed(3)} (${after.special})`);
    if (kind === 'golden') check('golden: ball tint restored afterwards', after.special === 'golden' || after.ball === 0xffffff,
      after.ball.toString(16));
  }

  // ---- Missions and XP --------------------------------------------------------
  const progressNow = await shot(() => JSON.parse(JSON.stringify(__demo.progress())));
  check('Three missions are active', progressNow.missions.length === 3);
  check('Shots count toward lifetime totals', progressNow.totals.goals > 0, `goals ${progressNow.totals.goals}`);
  check('Storage keys carry the pokisavedgame prefix', await shot(() => Object.keys(localStorage)
    .filter(k => k.includes('blockstriker')).every(k => k.startsWith('pokisavedgame.'))));

  // ---- Game over: the hooks screen -------------------------------------------
  const xpBefore = progressNow.xp;
  await loseRun();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${CAPTURES}/hooks-gameover.png` });
  const overText = await page.textContent('#overlay');
  check('Game over shows XP gained and the next unlock', /\+\d[\d,]* XP/.test(overText) && /Next: /i.test(overText));
  check('Game over lists missions', /missions/i.test(overText));
  check('Game over offers the daily challenge and the locker', /daily/i.test(overText) && /locker/i.test(overText));
  check('XP was paid out', (await shot(() => __demo.progress().xp)) > xpBefore);

  // ---- Locker -------------------------------------------------------------------
  await shot(() => { __demo.progress().xp = 13000; __demo.progress().bestLevel = 6; });
  await page.getByRole('button', { name: /^locker/i }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${CAPTURES}/hooks-locker.png` });
  const lockerText = await page.textContent('#overlay');
  check('Locker shows game progress and tab counts', /game progress/i.test(lockerText) && /KITS \d+\/\d+/i.test(lockerText));
  await page.locator('.locker-tabs .tab', { hasText: /^KITS/ }).click();
  await page.waitForTimeout(200);
  const sky = page.locator('.locker-item', { hasText: 'SKY BLUE' });
  // Landscape pages the grid: turn pages until the kit shows.
  for (let i = 0; i < 6 && !(await sky.isVisible()); i++) await page.getByRole('button', { name: 'Next page' }).click();
  await sky.click();
  const equipped = await shot(() => __demo.progress().equipped.kit);
  check('Locker equips an unlocked kit', equipped === 'sky', equipped);
  check('Locked items cannot be equipped', await page.locator('.locker-item.locked').first().isDisabled());
  await page.getByRole('button', { name: 'BACK', exact: true }).click();
  await page.waitForTimeout(300);

  // ---- Striker select -------------------------------------------------------------
  const strikerBefore = await shot(() => __demo.progress().striker);
  await page.getByRole('button', { name: /^striker$/i }).click();
  await page.waitForTimeout(400);
  check('Striker select shows all ten strikers', (await page.locator('.striker-card').count()) === 10);
  const locked = await page.locator('.striker-card.locked').count();
  check('Some strikers start locked and cannot be picked', locked > 0
    && await page.locator('.striker-card.locked').first().isDisabled(), `${locked} locked`);
  await page.keyboard.press('ArrowRight');
  const picked = await shot(() => __demo.progress().striker);
  check('Arrow keys pick another striker', picked && picked !== strikerBefore, `${strikerBefore} -> ${picked}`);
  const twins = await shot(() => {
    const s = __demo.players.find(p => p.role === 'striker');
    return __demo.players.filter(p => p !== s && p.look.skin === s.look.skin && p.look.hair === s.look.hair
      && p.look.style === s.look.style).length;
  });
  check("Nobody else on the pitch wears the striker's look", twins === 0, `${twins} twins`);
  await page.screenshot({ path: `${CAPTURES}/hooks-select.png` });
  await page.getByRole('button', { name: 'BACK', exact: true }).click();
  await page.waitForTimeout(300);

  // ---- Checkpoint ---------------------------------------------------------------
  const checkpointButton = page.getByRole('button', { name: /^start at level 4$/i });
  check('A checkpoint opens two levels past it', await checkpointButton.isVisible());
  await checkpointButton.click();
  await until('checkpoint run', () => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM');
  const cp = await shot(() => ({ level: __demo.state.run.level, mode: __demo.state.run.mode }));
  check('Checkpoint run starts at level 4', cp.level === 4 && cp.mode === 'checkpoint', JSON.stringify(cp));
  await page.screenshot({ path: `${CAPTURES}/hooks-checkpoint.png` });

  // ---- Daily challenge ----------------------------------------------------------
  await loseRun();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^daily/i }).click();
  await until('daily run', () => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM' && __demo.state.run.daily);
  const dailyStart = await shot(() => ({ x: __demo.ball.position.x, z: __demo.ball.position.z,
    hud: document.getElementById('hud-level').textContent, heartsHidden: document.getElementById('hud-hearts').classList.contains('hidden') }));
  check('Daily HUD counts shots and hides hearts', dailyStart.hud === 'DAILY 1/10' && dailyStart.heartsHidden, dailyStart.hud);
  await page.screenshot({ path: `${CAPTURES}/hooks-daily.png` });
  for (let i = 0; i < 10; i++) await shoot({ offTarget: i % 3 === 2 });
  await until('daily results', () => __demo.state.screen === 'GAMEOVER');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${CAPTURES}/hooks-daily-results.png` });
  const dailyText = await page.textContent('#overlay');
  check('Daily results show the streak', dailyText.includes('DAILY DONE') && /1-day streak/.test(dailyText));
  // The same day seeds the same chances.
  await page.getByRole('button', { name: /^daily/i }).click();
  await until('daily again', () => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM' && __demo.state.run.daily);
  const dailyAgain = await shot(() => ({ x: __demo.ball.position.x, z: __demo.ball.position.z }));
  check('The daily challenge is the same chance sequence', Math.abs(dailyAgain.x - dailyStart.x) < 1e-6
    && Math.abs(dailyAgain.z - dailyStart.z) < 1e-6, `${JSON.stringify(dailyStart)} vs ${JSON.stringify(dailyAgain)}`);

  // ---- Persistence ---------------------------------------------------------------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo?.ready);
  check('Boot goes straight into play with the saved striker', await shot(picked => __demo.state.screen === 'MATCH'
    && __demo.progress().striker === picked, picked));
  await pastSelect(page);
  const reloaded = await shot(() => ({ kit: __demo.progress().equipped.kit, xp: __demo.progress().xp,
    streak: __demo.progress().daily.streak }));
  check('Progress survives a reload', reloaded.kit === 'sky' && reloaded.xp >= 2000 && reloaded.streak === 1, JSON.stringify(reloaded));
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
}
writeFileSync(`${CAPTURES}/hooks.json`, JSON.stringify(report, null, 2));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail && !c.ok ? '  - ' + c.detail : ''}`);
for (const f of report.failures.filter(f => !report.checks.some(c => f.startsWith(c.label)))) console.log('FAIL  ' + f);
for (const e of report.errors) console.log('PAGE ERROR  ' + e);
process.exit(report.failures.length || report.errors.length ? 1 : 0);

// Poki ad-break probe. Copy into the game's tools/ and fill in GAME below.
// Serves the stub SDK in place of Poki's, then for every break the game can
// start: presses Enter/Space, clicks and re-clicks the button mid-ad, hides
// the tab mid-ad, fails a rewarded ad, and checks the game never plays behind
// an ad or resumes in a hidden tab. Prints a report; exits 1 on any failure.
//
// Usage: node tools/poki-ads.mjs   (dev server running; GAME_URL overrides the address)
//        CHROMIUM_PATH=... for real Chrome.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STUB = readFileSync(process.env.POKI_STUB
  || join(homedir(), '.claude/skills/poki-sdk/scripts/poki-stub.js'), 'utf8');
const URL = process.env.GAME_URL || 'http://localhost:5174/?shot=timing&rush=0';

// ---- GAME-SPECIFIC ----------------------------------------------------------
// Example filled in for Block Striker (window.__demo test hook). Replace per game.
const GAME = {
  /** Resolves once the game is interactive: past the striker select, in the first chance. */
  async ready(page) {
    await page.waitForFunction(() => window.__demo?.ready);
    // The game asks for a break before every third new run; test every one.
    await page.evaluate(() => __demo.setRunsPerBreak(1));
    if (await page.evaluate(() => __demo.state.screen === 'SELECT')) {
      await page.keyboard.press('Space');
      await page.waitForFunction(() => __demo.state.screen === 'MATCH');
    }
  },

  /** True while gameplay is live (not paused, not in a menu). */
  playing: page => page.evaluate(() => __demo.state.screen === 'MATCH' && !__demo.state.paused),

  /** Game over, by losing the last life. Used by triggers below. */
  async toGameOver(page) {
    for (let i = 0; i < 40; i++) {
      await page.waitForFunction(() => __demo.state.phase === 'AIM' || __demo.state.screen === 'GAMEOVER');
      if (await page.evaluate(() => __demo.state.screen === 'GAMEOVER')) return;
      await page.evaluate(() => { __demo.state.run.hearts = 1; });
      await page.keyboard.press('Space'); await page.waitForTimeout(150); await page.keyboard.press('Space');
      await page.waitForFunction(() => __demo.state.phase !== 'POWER');
      await page.waitForTimeout(300);
    }
    throw new Error('could not reach game over');
  },

  /**
   * Every way the game starts a break. `setup` leaves the page where `button`
   * starts it; `rewarded` breaks also say how to tell the reward was granted.
   */
  triggers: [
    { name: 'play again', kind: 'commercial',
      setup: page => GAME.toGameOver(page),
      button: page => page.getByRole('button', { name: 'PLAY AGAIN', exact: true }) },
    { name: 'resume from pause', kind: 'commercial',
      setup: async page => {
        await page.waitForFunction(() => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM');
        await page.keyboard.press('Escape');
      },
      button: page => page.getByRole('button', { name: 'RESUME', exact: true }) },
    { name: 'restart from pause', kind: 'commercial',
      setup: async page => {
        await page.waitForFunction(() => __demo.state.screen === 'MATCH' && __demo.state.phase === 'AIM');
        await page.keyboard.press('Escape');
      },
      button: page => page.getByRole('button', { name: 'RESTART', exact: true }) },
    { name: 'continue (rewarded)', kind: 'rewarded',
      setup: page => GAME.toGameOver(page),
      button: page => page.locator('#continue-button'),
      rewarded: page => page.evaluate(() => __demo.state.screen === 'MATCH' && __demo.state.run.hearts === 1) },
    { name: 'daily challenge', kind: 'commercial',
      setup: page => GAME.toGameOver(page),
      button: page => page.getByRole('button', { name: /^daily/i }) },
    { name: 'checkpoint start', kind: 'commercial',
      setup: async page => {
        await page.evaluate(() => { __demo.progress().bestLevel = 6; });
        await GAME.toGameOver(page);
      },
      button: page => page.getByRole('button', { name: /^start at level/i }) },
    // The boost is offered once the continue has been used: the locker's BACK redraws the results.
    { name: 'next-run boost (rewarded)', kind: 'rewarded',
      setup: async page => {
        await GAME.toGameOver(page);
        await page.evaluate(() => { __demo.state.run.continued = true; });
        await page.getByRole('button', { name: /^locker/i }).click();
        await page.getByRole('button', { name: 'BACK', exact: true }).click();
      },
      button: page => page.locator('#boost-button'),
      rewarded: page => page.evaluate(() => __demo.progress().boost === true) },
  ],

  /** Back to live gameplay between scenarios. */
  async reset(page) {
    await page.reload({ waitUntil: 'networkidle' });
    await GAME.ready(page);
  },
};
// -----------------------------------------------------------------------------

const results = [];
const check = (scenario, ok, detail = '') => results.push({ scenario, ok, detail });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.setDefaultTimeout(20000);
await page.route('**/poki-sdk.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
await page.goto(URL, { waitUntil: 'networkidle' });
await GAME.ready(page);

const stub = () => page.evaluate(() => window.__pokiStub);
const setAd = (ms, success = true) => page.evaluate(([m, s]) => {
  window.__pokiStub.adMs = m; window.__pokiStub.rewardSuccess = s;
}, [ms, success]);
const breakRunning = () => page.evaluate(() => window.__pokiStub.inBreak);
const setHidden = hidden => page.evaluate(h => {
  if (h) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  else delete document.hidden;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
// The stub's record lives in the page: collect it before every reload.
let current = '';
const seen = new Set();
async function harvest() {
  const s = await stub().catch(() => null);
  if (!s) return;
  for (const v of s.violations) check(`${current}: SDK rule`, false, v);
  for (const w of s.warnings) if (!seen.has(current + w)) {
    seen.add(current + w);
    results.push({ scenario: `${current}: warning`, ok: true, detail: w });
  }
}
const reset = async () => { await harvest(); await GAME.reset(page); };
const waitBreakEnd = () => page.waitForFunction(() => !window.__pokiStub.inBreak, null, { timeout: 15000 });

for (const trigger of GAME.triggers) {
  current = trigger.name;
  // 1. Input during the break never starts or resumes play behind the ad.
  try {
    await reset();
    await setAd(2500);
    await trigger.setup(page);
    const button = trigger.button(page);
    const box = await button.boundingBox();
    await button.click();
    await page.waitForTimeout(100);
    if (!await breakRunning()) { check(`${trigger.name}: break starts`, false, 'no break was requested'); continue; }
    await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    await page.keyboard.press('Space'); await page.waitForTimeout(100);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(640, 400);
    await page.waitForTimeout(150);
    const behind = await GAME.playing(page) && await breakRunning();
    check(`${trigger.name}: input during the ad`, !behind, behind ? 'gameplay is live behind the ad' : '');
    await waitBreakEnd();
    await page.waitForTimeout(300);
    if (trigger.kind === 'commercial') check(`${trigger.name}: play resumes after the ad`, await GAME.playing(page));
    else check(`${trigger.name}: reward granted on success`, await trigger.rewarded(page));
  } catch (error) { check(`${trigger.name}: input during the ad`, false, String(error).split('\n')[0]); }

  // 2. Tab hidden during the break (ad click-through): stay paused afterwards.
  try {
    await reset();
    await setAd(1500);
    await trigger.setup(page);
    await trigger.button(page).click();
    await page.waitForTimeout(100);
    await setHidden(true);
    await waitBreakEnd();
    await page.waitForTimeout(300);
    const live = await GAME.playing(page);
    check(`${trigger.name}: hidden tab after the ad`, !live, live ? 'gameplay resumed in a hidden tab' : '');
    await setHidden(false);
  } catch (error) { check(`${trigger.name}: hidden tab after the ad`, false, String(error).split('\n')[0]); }

  // 3. A failed rewarded ad grants nothing.
  if (trigger.kind === 'rewarded') {
    try {
      await reset();
      await setAd(800, false);
      await trigger.setup(page);
      await trigger.button(page).click();
      await waitBreakEnd();
      await page.waitForTimeout(300);
      check(`${trigger.name}: no reward on failure`, !await trigger.rewarded(page));
    } catch (error) { check(`${trigger.name}: no reward on failure`, false, String(error).split('\n')[0]); }
  }
}
await harvest();
await browser.close();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.scenario}${r.detail ? '  - ' + r.detail : ''}`);
for (const e of errors) console.log('PAGE ERROR  ' + e);
const failed = results.filter(r => !r.ok).length + errors.length;
console.log(failed ? `\n${failed} problem(s)` : '\nAll ad-break checks passed');
process.exit(failed ? 1 : 0);

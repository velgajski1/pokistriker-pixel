import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  assert(await page.evaluate(() => __demo.audio().state === 'locked'), 'Audio must wait for interaction');
  await page.locator('.audio-controls summary').click();
  await page.waitForFunction(() => __demo.audio().state === 'running');
  for (const [name, value] of [['Music volume', '17'], ['Sound effects volume', '42']]) {
    await page.getByRole('slider', { name }).fill(value);
  }
  assert(await page.evaluate(() => __demo.audio().settings.music === .17 && __demo.audio().settings.sfx === .42), 'Independent volume buses');
  await page.locator('.audio-controls summary').click();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'POWER');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.audio().played.kick > 0);
  await page.waitForFunction(() => __demo.audio().played.cheer > 0, null, { timeout: 20000 });
  assert(await page.evaluate(() => {
    const p = __demo.audio().played;
    return p.aim && p.power && p.kick && p.whoosh && p.net && p.reward;
  }), 'Shooting and goal cues must be wired');
  await page.evaluate(async () => {
    const audio = await import('/js/audio.js');
    for (const cue of ['post', 'bar', 'save', 'block', 'bounce', 'applause', 'fulltime',
      'kickoff', 'win', 'draw', 'loss', 'benched', 'victory', 'charm', 'purchase', 'warning']) audio.play(cue);
    __demo.showUpgradeScreen('meta');
  });
  await page.waitForFunction(() => __demo.audio().scene === 'upgrades');
  await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => __demo.audio().state === 'suspended');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => __demo.audio().state === 'running');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo?.ready);
  assert(await page.evaluate(() => __demo.audio().settings.music === .17 && __demo.audio().settings.sfx === .42
    && __demo.audio().state === 'locked'), 'Preferences persist; reload must relock autoplay');
  await page.locator('.audio-controls summary').click();
  await page.getByRole('slider', { name: 'Sound effects volume' }).fill('0');
  assert(await page.evaluate(async () => {
    const audio = await import('/js/audio.js');
    const before = JSON.stringify(audio.status().played); audio.play('kick');
    return before === JSON.stringify(audio.status().played);
  }), 'Muted effects must not schedule');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: gesture unlock, volumes, shot/goal cues, effect synthesis, upgrade music, visibility suspension, persistence and mute.');
} finally { await browser.close(); }

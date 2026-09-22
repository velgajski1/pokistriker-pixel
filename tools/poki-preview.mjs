// Records an animated thumbnail / hover preview from the live game: a real shot
// on a square canvas (arrow sweeps onto the target, locks, height set, strike,
// the ball into the target, celebration), silent, seamlessly looping.
//
// The game's clock is replaced by a virtual one that advances exactly 1/FPS per
// rendered frame, so the capture is frame-perfect however slow grabbing is.
// Usage: FFMPEG=path/to/ffmpeg node tools/poki-preview.mjs [size=720]
//   -> dist/poki/preview-<size>.mp4, preview-360.gif
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const SIZE = Number(process.argv[2]) || 720, FPS = 30, OUT = 'dist/poki', FRAMES = `${OUT}/frames`;
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })).newPage();
let saved = 0;
await page.exposeFunction('__saveFrame', (index, url) => {
  writeFileSync(`${FRAMES}/f${String(index).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  saved++;
});
// Virtual clock: performance.now only moves when a frame has been captured.
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  let virtual = null;
  window.__clock = { speed: 1, start() { virtual = real(); }, step(ms) { virtual += ms * this.speed; } };
  performance.now = () => virtual === null ? real() : virtual;
});
await page.goto(process.env.DEMO_URL || 'http://localhost:5174', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demo?.ready);
// Hide the HUD: the preview is the pitch only (no text).
await page.addStyleTag({ content: '#hud, .audio-toggle, #overlay { display: none !important; }' });

// Capture after every render; each capture advances the virtual clock one frame.
await page.evaluate(fps => {
  const d = __demo;
  let index = 0;
  d.__recording = true;
  const previous = d.scene.onAfterRender;
  d.scene.onAfterRender = function (...args) {
    previous.apply(this, args);
    if (!d.__recording) return;
    window.__saveFrame(index++, d.renderer.domElement.toDataURL('image/jpeg', .93));
    d.__frames = index;
    window.__clock.step(1000 / fps);
  };
  window.__clock.start();
  // No text anywhere in the preview: hide the advertising boards.
  d.scene.traverse(n => { if (n.name === 'advertising-board') n.visible = false; });
}, FPS);

const raf = { polling: 'raf', timeout: 60000 };
// Let the arrow sweep for ~1.5 s of footage, then lock it on the target.
await page.waitForFunction(() => __demo.state.phase === 'AIM', null, raf);
await page.evaluate(() => { __demo.state.run.level = 2; });
await page.waitForFunction(fps => __demo.__frames > fps * 1.5 && Math.abs(__demo.shot.aimX - __demo.target.x) < .2, FPS, raf);
await page.keyboard.press('Space');
await page.waitForFunction(() => __demo.state.phase === 'POWER' && __demo.shot.powerDir > 0
  && Math.abs(__demo.prediction.y - __demo.target.y) < .12, null, raf);
// Half-speed slow motion from the strike until just after the ball is in.
await page.evaluate(() => { window.__clock.speed = .5; });
await page.keyboard.press('Space');
await page.waitForFunction(() => __demo.shot.resolved !== null, null, raf);
const resolvedAt = await page.evaluate(() => __demo.__frames);
await page.waitForFunction(t => __demo.__frames > t + 12, resolvedAt, raf);
await page.evaluate(() => { window.__clock.speed = 1; });
await page.waitForFunction(t => __demo.__frames > t + 12 + 45, resolvedAt, raf);
await page.evaluate(() => { __demo.__recording = false; });
await page.waitForTimeout(500);
const outcome = await page.evaluate(() => __demo.shot.precision || __demo.shot.resolved);
await browser.close();
console.log(`captured ${saved} frames (${(saved / FPS).toFixed(1)} s), shot: ${outcome}`);

// Seamless loop: crossfade the last half second into the first.
const fade = .5, total = saved / FPS, headFrames = Math.round(fade * FPS);
const mp4 = `${OUT}/preview-${SIZE}.mp4`;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${FRAMES}/f%04d.jpg`,
  '-filter_complex',
  `[0]split[a][b];[a]trim=start_frame=${headFrames},setpts=PTS-STARTPTS[main];` +
  `[b]trim=end_frame=${headFrames},setpts=PTS-STARTPTS[head];` +
  `[main][head]xfade=transition=fade:duration=${fade}:offset=${(total - fade - fade).toFixed(3)},format=yuv420p[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-profile:v', 'high', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', '-an', mp4]);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', mp4, '-vf',
  'fps=15,scale=360:360:flags=neighbor,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=none',
  '-loop', '0', `${OUT}/preview-360.gif`]);
rmSync(FRAMES, { recursive: true, force: true });
console.log(`${mp4} and ${OUT}/preview-360.gif written`);

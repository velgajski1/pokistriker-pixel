import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  report.layout = await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const app = await import('../js/app.js');
    const d = window.__demo;
    e.onFrame(null);
    const counts = ['home', 'away'].map(team => ({ team,
      count: d.players.filter(p => p.team === team).length,
      keepers: d.players.filter(p => p.team === team && p.role === 'keeper').length }));
    let seed = 17, outside = 0, min = Infinity, max = 0;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const spot = {};
    for (let i = 0; i < 1000; i++) {
      app.chooseChanceOrigin(spot, random);
      const distance = spot.z + 20;
      if (distance > 16.5) outside++;
      min = Math.min(min, distance); max = Math.max(max, distance);
    }
    e.setupChance({ x: 0, y: .11, z: 4 }, 2, false);
    const onPitch = d.players.filter(p => p.team !== 'ref').every(p =>
      Math.abs(p.root.position.x) < 34 && p.root.position.z > -20 && p.root.position.z < 85);
    document.getElementById('overlay').style.display = 'none';
    d.renderer.setAnimationLoop(null);
    d.scene.fog = null; // Inspect all formation lines from above without distance fog.
    d.camera.position.set(0, 150, 65);
    d.camera.lookAt(0, 0, 32);
    d.renderer.render(d.scene, d.camera);
    return { counts, outside, min, max, onPitch };
  });
  await page.screenshot({ path: `${CAPTURES}/full-pitch.png` });
  assert(report.layout.counts.every(t => t.count === 11 && t.keepers === 1), 'Teams must each have eleven players and one keeper');
  assert(report.layout.onPitch, 'All footballers must be inside the pitch');
  assert(report.layout.outside > 280 && report.layout.outside < 420 && report.layout.max > 24 && report.layout.min >= 9, 'Missing varied long-range chances');
  await page.reload();
  await page.waitForFunction(() => window.__demo?.ready);
  await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    e.setupChance({ x: 0, y: .11, z: 4 }, 2, false);
    document.getElementById('overlay').style.display = 'none';
    e.setBall({ x: 17, y: .4, z: -10 });
    e.onFrame(dt => e.followReboundCamera(dt));
  });
  await page.waitForTimeout(2200);
  report.camera = await page.evaluate(async () => {
    const THREE = await import('three');
    const d = window.__demo;
    const screen = d.ball.position.clone().project(d.camera);
    return { screen: screen.toArray(), position: d.camera.position.toArray(),
      rotation: d.camera.getWorldDirection(new THREE.Vector3()).toArray() };
  });
  assert(Math.abs(report.camera.screen[0]) < .4 && Math.abs(report.camera.screen[1]) < .4,
    'Rebound camera must keep the ball in view');
  assert(Math.abs(report.camera.rotation[0]) > .1, 'Camera should turn with a wide rebound');
  await page.screenshot({ path: `${CAPTURES}/rebound-camera.png` });
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/full-pitch.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

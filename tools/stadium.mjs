import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';
import { GOAL, PITCH, BALL_R, GROUND_Y, PHYS_DT, WOODWORK, sweptCapsuleHit,
  launchVector, stepBall } from '../js/physics.js';

const report = { errors: [], failures: [] };
let browser;
try {
  assert(Math.abs(2 * (GOAL.POST_X - GOAL.POST_R) - 7.32) < 1e-9, 'Goal opening width');
  assert(Math.abs(GOAL.BAR_Y - GOAL.POST_R - 2.44) < 1e-9, 'Goal opening height');
  assert(PITCH.LENGTH === 105 && PITCH.WIDTH === 68, 'Pitch dimensions');
  assert(BALL_R * 2 * Math.PI >= .68 && BALL_R * 2 * Math.PI <= .70, 'Ball circumference');
  assert(GROUND_Y === BALL_R, 'Ball must rest on turf');
  for (const cap of WOODWORK) {
    const x = (cap.a.x + cap.b.x) / 2, y = (cap.a.y + cap.b.y) / 2;
    assert(sweptCapsuleHit({ x, y, z: GOAL.PLANE_Z + .3 }, { x, y, z: GOAL.PLANE_Z - .3 }, cap),
      'Swept collision must catch the narrower woodwork');
  }
  for (const cap of WOODWORK) assert(!sweptCapsuleHit(
    { x: 0, y: 1, z: GOAL.PLANE_Z + .3 }, { x: 0, y: 1, z: GOAL.PLANE_Z - .3 }, cap), 'Open goal blocked');
  const endpoints = [30, 60, 144].map(hz => {
    const pos = { x: 0, y: GROUND_Y, z: 0 }, vel = { x: 0, y: 0, z: 0 };
    launchVector(.12, .65, 1, vel);
    let accumulator = 0, steps = 0;
    for (let frame = 0; frame < hz; frame++) {
      accumulator += 1 / hz;
      while (accumulator + 1e-10 >= PHYS_DT) {
        stepBall(pos, vel, PHYS_DT);
        accumulator -= PHYS_DT;
        steps++;
      }
    }
    return { hz, steps, ...pos };
  });
  assert(endpoints.every(p => p.steps === 240 && Math.abs(p.z - endpoints[0].z) < 1e-9), 'Frame-rate-dependent flight');
  report.physics = { opening: [7.32, 2.44], pitch: [105, 68], ballDiameter: BALL_R * 2, endpoints };

  const session = await open(report.errors);
  browser = session.browser;
  // The arcade boots holding still for the first aim; let the arena play first.
  await session.page.evaluate(() => { __demo.state.phase = 'IDLE'; });
  await session.page.waitForTimeout(600);
  const { page } = session;
  const before = await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    e.cheerCrowd(true);
    return window.__demo.crowd.time;
  });
  await page.waitForTimeout(350);
  report.crowd = await page.evaluate(() => ({ count: __demo.crowd.count, batches: __demo.crowd.batches.length,
    time: __demo.crowd.time, excitement: __demo.crowd.excitement,
    flags: __demo.scene.children.filter(n => n.name === 'supporter-flag').length }));
  assert(report.crowd.count > 6000 && report.crowd.batches <= 24, 'Crowd density or draw-call budget');
  assert(report.crowd.time > before && report.crowd.excitement > .8 && report.crowd.excitement < 1, 'Crowd animation or reaction');
  assert(report.crowd.flags === 8, 'Missing supporter flags');

  report.players = await page.evaluate(async () => {
    const THREE = await import('three');
    const d = window.__demo;
    d.renderer.setAnimationLoop(null);
    const heights = [];
    for (const player of d.players) {
      player.root.position.set(0, 0, 0);
      player.root.rotation.set(0, 0, 0);
      player.model.position.set(0, 0, 0);
      player.model.rotation.set(0, 0, 0);
      const mixer = player.rig.avatar?.mixer || d.striker.mixer;
      for (const action of mixer._actions) {
        action.setEffectiveWeight(action.getClip().name === 'idle' ? 1 : 0);
        action.time = 0;
      }
      mixer.update(0);
      player.root.updateWorldMatrix(true, true);
      player.model.traverse(node => { if (node.isSkinnedMesh) node.skeleton.update(); });
      // Measure the visible skinned vertices, including the instance scale.
      const box = new THREE.Box3().setFromObject(player.model, true);
      heights.push(box.max.y - box.min.y);
      player.root.position.set(0, -50, 0);
    }
    // Put two players beside the goal at the same depth: no perspective trick.
    for (let i = 0; i < 2; i++) d.players[i].root.position.set(i ? 2 : -2, 0, d.dimensions.goal.PLANE_Z);
    d.camera.position.set(0, 2.1, d.dimensions.goal.PLANE_Z + 13);
    d.camera.lookAt(0, 1.2, d.dimensions.goal.PLANE_Z);
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('dim').style.display = 'none';
    document.getElementById('hud').style.display = 'none';
    d.renderer.render(d.scene, d.camera);
    return heights;
  });
  // Block heads are part of the style; the crown still sits at the scanned player's height.
  assert(report.players.every(h => h > 1.65 && h < 2.2), 'Players outside adult footballer height range');
  await page.screenshot({ path: `${CAPTURES}/stadium-scale.png` });
  await page.evaluate(() => {
    const d = __demo;
    d.camera.position.set(0, 5, d.dimensions.goal.PLANE_Z + 19);
    d.camera.lookAt(0, 4.5, d.dimensions.goal.PLANE_Z - 7);
    d.renderer.render(d.scene, d.camera);
  });
  await page.screenshot({ path: `${CAPTURES}/stadium-crowd.png` });
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/stadium.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

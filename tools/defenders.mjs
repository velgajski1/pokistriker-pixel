import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  report.poses = await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const THREE = await import('three');
    const d = window.__demo;
    d.renderer.setAnimationLoop(null);
    e.setupChance({ x: 0, y: .11, z: 0 }, 2, false);
    const results = [];
    for (const side of [-1, 1]) {
      e.setBlocker(0, side * .7, 1, side);
      const caps = e.getBlockerCapsules().slice(0, 7);
      const player = d.players.find(p => Math.abs(p.root.position.x - side * .7) < 1e-6
        && p.model.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(caps[0].a.x, caps[0].a.y, caps[0].a.z)) < .001);
      const point = name => player.model.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
      const hips = point('Hips'), neck = point('Neck');
      let error = 0;
      for (const [index, suffix] of [[1, 'Left'], [4, 'Right']]) {
        for (const [offset, from, to] of [[0, 'UpLeg', 'Leg'], [1, 'Leg', 'Foot'], [2, 'Foot', 'ToeBase']]) {
          const cap = caps[index + offset];
          error = Math.max(error, point(suffix + from).distanceTo(new THREE.Vector3(cap.a.x, cap.a.y, cap.a.z)),
            point(suffix + to).distanceTo(new THREE.Vector3(cap.b.x, cap.b.y, cap.b.z)));
        }
      }
      results.push({ side, capsules: caps.length, jointError: error,
        torsoRise: neck.y - hips.y,
        handReach: Math.max(point('LeftHand').y, point('RightHand').y) - neck.y,
        footSpread: Math.abs(point('LeftFoot').x - point('RightFoot').x) });
    }
    e.setBlocker(0, -1.2, 1, -1);
    e.setBlocker(1, 1.2, 1, 1);
    const z = e.chance.blockers[0].z;
    d.camera.position.set(0, 2.8, z + 7);
    d.camera.lookAt(0, 1, z);
    document.getElementById('overlay').style.display = 'none';
    d.renderer.render(d.scene, d.camera);
    return results;
  });
  for (const pose of report.poses) {
    assert(pose.capsules === 7 && pose.jointError < 1e-5, 'Defender collisions must follow both articulated legs and boots');
    assert(pose.torsoRise > .4 && pose.handReach < -.25, 'Defender must stay upright with hands down');
    assert(pose.footSpread > .35, 'Leading boot must extend sideways');
  }
  await page.screenshot({ path: `${CAPTURES}/defenders.png` });
  report.slides = await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    const d = window.__demo;
    const results = [];
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const name = side < 0 ? 'slide_left' : 'slide_right';
      e.setBlocker(i, side * 1.2, .8, side, 0, .3);
      const player = d.players.find(p => p.rig.avatar?.actions[name].getEffectiveWeight() > .99);
      const caps = e.getBlockerCapsules().slice(i * 7, i * 7 + 7);
      results.push({ side, weight: player.rig.avatar.actions[name].getEffectiveWeight(),
        hipHeight: caps[0].a.y, capsules: caps.length });
    }
    d.renderer.render(d.scene, d.camera);
    return results;
  });
  assert(report.slides.every(s => s.weight > .99 && s.hipHeight < .55 && s.capsules === 7),
    'Both slides must lower the body and retain body/leg-only collision');
  await page.screenshot({ path: `${CAPTURES}/defender-slides.png` });
  report.recovery = await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    e.setBlocker(0, -1.2, 0, -1, 0, 2);
    e.setBlocker(1, 1.2, 0, 1, 0, 2);
    return __demo.players.filter(p => p.rig.avatar?.procedural && p.rig.avatar.actions.alert.getEffectiveWeight() === 1).length;
  });
  assert(report.recovery >= 2, 'Defenders must recover to Alert after sliding');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/defenders.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    window.__gaitSpeed = 0;
    e.onFrame(dt => { __animationRig.root.position.z += window.__gaitSpeed * dt; });
    window.__animationRig = __demo.players.find(p => p.role === 'outfield').rig;
    __animationRig.avatar.procedural = false;
    __animationRig.avatar.passTime = -1;
    __animationRig.avatar.turnTime = -1;
    __animationRig.avatar.turnRate = 0;
  });
  report.gaits = [];
  for (const [speed, runName, expected] of [[0, 'run', 'idle'], [.01, 'run', 'walk'],
    [.1, 'run', 'walk'], [.5, 'run', 'walk'], [1.54, 'run', 'walk'],
    [2.25, 'run', 'quick_walk'], [4.7, 'run', 'run'], [4.7, 'run_alt', 'run_alt']]) {
    await page.evaluate(({ speed, runName }) => {
      const a = __animationRig.avatar;
      a.speed = speed * a.scale;
      window.__gaitSpeed = a.speed;
      a.runName = runName;
    }, { speed, runName });
    await page.waitForTimeout(100);
    const weights = await page.evaluate(() => Object.fromEntries(Object.entries(__animationRig.avatar.actions)
      .map(([name, action]) => [name, action.getEffectiveWeight()])));
    report.gaits.push({ speed, expected, weight: weights[expected] });
    assert(weights[expected] > .98, `Wrong gait at ${speed}: ${expected}`);
    assert(Math.abs(Object.values(weights).reduce((sum, w) => sum + w, 0) - 1) < 1e-6, 'Blend weights must sum to one');
  }
  report.turns = [];
  for (const [speed, rate, expected] of [[0, 2, 'turn_idle_left'], [0, -2, 'turn_idle_right'],
    [1.7, 2, 'turn_walk_left'], [1.7, -2, 'turn_walk_right']]) {
    await page.evaluate(({ speed, rate }) => {
      const a = __animationRig.avatar;
      a.speed = speed * a.scale; a.turnRate = rate; a.turnTime = -1;
      window.__gaitSpeed = a.speed;
    }, { speed, rate });
    await page.waitForTimeout(180);
    const weight = await page.evaluate(name => __animationRig.avatar.actions[name].getEffectiveWeight(), expected);
    report.turns.push({ expected, weight });
    assert(weight > .1, 'Turn clip did not play: ' + expected);
  }
  report.clips = await page.evaluate(async () => {
    const THREE = await import('three');
    const e = await import('../js/gameEngine.js');
    __demo.renderer.setAnimationLoop(null);
    const a = __animationRig.avatar;
    const names = Object.keys(a.actions);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), forward = new THREE.Vector3();
    const hip = a.model.getObjectByName('mixamorigHips');
    const turns = [];
    __animationRig.root.rotation.set(0, 0, 0);
    for (const name of names.filter(n => n.startsWith('turn_'))) {
      for (const action of Object.values(a.actions)) action.setEffectiveWeight(0);
      a.actions[name].setEffectiveWeight(1);
      let yaw = 0;
      for (let i = 0; i <= 24; i++) {
        a.actions[name].time = a.actions[name].getClip().duration * i / 24;
        a.mixer.update(0);
        hip.getWorldQuaternion(q);
        forward.set(0, 0, 1).applyQuaternion(q);
        yaw = Math.max(yaw, Math.abs(Math.atan2(forward.x, forward.z)));
      }
      turns.push({ name, maxYaw: yaw });
    }
    const dives = [];
    for (const side of [-1, 1]) {
      e.setKeeper(0, 1, side, .8, .4, 0);
      const k = __demo.players[0].rig.avatar;
      const name = side < 0 ? 'dive_left' : 'dive_right';
      dives.push({ name, weight: k.actions[name].getEffectiveWeight() });
    }
    const c = __demo.striker.mixer;
    const kick = c._actions.find(action => action.getClip().name === 'kick');
    for (const action of c._actions) action.setEffectiveWeight(action === kick ? 1 : 0);
    const trajectory = [];
    for (let i = 0; i <= 40; i++) {
      kick.time = i / 24;
      c.update(0);
      __demo.striker.bone('foot_R').getWorldPosition(p);
      const toe = __demo.striker.bone('toe_R').getWorldPosition(new THREE.Vector3());
      p.add(toe).multiplyScalar(.5);
      __demo.striker.root.worldToLocal(p);
      trajectory.push([+kick.time.toFixed(3), ...p.toArray().map(v => +v.toFixed(3))]);
    }
    return { names, turns, dives, kickTrajectory: trajectory };
  });
  assert(report.clips.names.length === 20, 'Not all selected clips exported');
  assert(report.clips.turns.every(t => t.maxYaw < .05), 'Turn root yaw was not removed');
  assert(report.clips.dives.every(d => d.weight === 1), 'Dive clips unused');
  const contact = report.clips.kickTrajectory[12];
  assert(contact[3] > report.clips.kickTrajectory[11][3], 'Contact must be on the forward swing');
  assert(contact[2] < .15, 'Strike is too high for a ground ball');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo.ready);
  await page.evaluate(async () => {
    const THREE = await import('three');
    const point = new THREE.Vector3(), toePoint = new THREE.Vector3();
    window.__passAudit = {};
    const sample = () => {
      const d = __demo;
      if (d.state.run?.building) {
        d.players.forEach((player, i) => {
          const a = player.rig.avatar;
          if (!a || a.passTime < 0) return;
          const record = __passAudit[i] ||= { kickWeight: 0, closestContact: 99 };
          record.kickWeight = Math.max(record.kickWeight, a.actions.kick.getEffectiveWeight());
          if (a.passTime > .24 && a.passTime < .36) {
            player.model.getObjectByName('mixamorigRightFoot').getWorldPosition(point);
            player.model.getObjectByName('mixamorigRightToeBase').getWorldPosition(toePoint);
            point.add(toePoint).multiplyScalar(.5);
            record.closestContact = Math.min(record.closestContact, point.distanceTo(d.ball.position));
          }
          if (!window.__passCapture && a.passTime > .12 && a.passTime < .26) {
            d.renderer.render(d.scene, d.camera);
            window.__passCapture = d.renderer.domElement.toDataURL();
          }
        });
      }
      if (d.state.phase !== 'AIM') requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, { timeout: 45000 });
  report.passes = await page.evaluate(() => __passAudit);
  const capture = await page.evaluate(() => window.__passCapture);
  if (capture) writeFileSync(`${CAPTURES}/biped-pass.png`, Buffer.from(capture.split(',')[1], 'base64'));
  assert(Object.keys(report.passes).length === 2, 'Both build-up passers must use the kick clip');
  assert(Object.values(report.passes).every(p => p.kickWeight > .9 && p.closestContact < .25), 'Pass kick failed to meet the ball');
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/animations.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, clips: { ...report.clips, kickTrajectory: undefined } }, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

import { writeFileSync } from 'node:fs';
import { open, CAPTURES } from './lib.mjs';

const errors = [];
const report = { errors, stages: [], offenders: [] };
let browser;
try {
  const session = await open(errors);
  browser = session.browser;
  const { page } = session;

  await page.evaluate(() => {
    const d = window.__demo;
    const previous = new Map();
    const samples = [];
    let last = performance.now();
    window.__movementAudit = { enabled: false, stage: '', samples };

    const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const tick = now => {
      const dt = Math.max(.001, (now - last) / 1000);
      last = now;
      for (let index = 0; index < d.players.length; index++) {
        const player = d.players[index];
        const root = player.root;
        const old = previous.get(player);
        previous.set(player, { x: root.position.x, z: root.position.z });
        if (!window.__movementAudit.enabled || !old) continue;
        const dx = root.position.x - old.x, dz = root.position.z - old.z;
        const distance = Math.hypot(dx, dz);
        const speed = distance / dt;
        const avatar = player.rig.avatar;
        const actions = player.role === 'striker'
          ? Object.fromEntries(Object.entries(d.striker.weights()))
          : avatar ? Object.fromEntries(Object.entries(avatar.actions).map(([name, action]) => [name, action.getEffectiveWeight()]))
            : {};
        const gait = ['walk', 'quick_walk', 'run', 'run_alt', 'turn_walk_left', 'turn_walk_right']
          .reduce((sum, name) => sum + (actions[name] || 0), 0);
        if (gait < .1) continue;

        // The audit runs in its own requestAnimationFrame callback and can
        // precede Three's render callback. Sample the current transforms, not
        // the previous rendered matrixWorld values.
        root.updateWorldMatrix(true, true);
        const rootWorld = root.getWorldQuaternion(root.quaternion.clone());
        const rootForward = root.position.clone().set(0, 0, 1).applyQuaternion(rootWorld);
        const rootWorldHeading = Math.atan2(rootForward.x, rootForward.z);
        let visualHeading = null;
        const left = player.model.getObjectByName('mixamorigLeftShoulder');
        const right = player.model.getObjectByName('mixamorigRightShoulder');
        if (left && right) {
          const lp = left.getWorldPosition(left.position.clone());
          const rp = right.getWorldPosition(right.position.clone());
          visualHeading = Math.atan2(-(lp.z - rp.z), lp.x - rp.x);
        }
        const modelWorld = player.model.getWorldQuaternion(player.model.quaternion.clone());
        const modelForward = root.position.clone().set(0, 0, 1).applyQuaternion(modelWorld);
        const modelHeading = Math.atan2(modelForward.x, modelForward.z);
        const hips = player.model.getObjectByName('mixamorigHips');
        let hipsHeading = null;
        if (hips) {
          const hipsWorld = hips.getWorldQuaternion(hips.quaternion.clone());
          const hipsForward = root.position.clone().set(0, 0, 1).applyQuaternion(hipsWorld);
          hipsHeading = Math.atan2(hipsForward.x, hipsForward.z);
        }
        const motionHeading = distance > 1e-6 ? Math.atan2(dx, dz) : null;
        const rootError = motionHeading === null ? null : Math.abs(angleDelta(root.rotation.y, motionHeading));
        const visualError = motionHeading === null || visualHeading === null
          ? null : Math.abs(angleDelta(visualHeading, motionHeading));
        samples.push({
          stage: window.__movementAudit.stage, index, team: player.team, role: player.role,
          speed, gait, rootHeading: root.rotation.y, modelHeading, hipsHeading, visualHeading,
          motionHeading, rootError, visualError,
          rootWorldHeading, rootRotation: root.rotation.toArray(),
          rootQuaternion: root.quaternion.toArray(), rootScale: root.scale.toArray(),
          modelParentIsRoot: player.model.parent === root,
          modelQuaternion: player.model.quaternion.toArray(),
          procedural: !!avatar?.procedural,
          weights: Object.fromEntries(Object.entries(actions).filter(([, weight]) => weight > .05)),
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const sampleStage = async (stage, milliseconds) => {
    await page.evaluate(name => {
      window.__movementAudit.stage = name;
      window.__movementAudit.enabled = true;
    }, stage);
    await page.waitForTimeout(milliseconds);
    await page.evaluate(() => { window.__movementAudit.enabled = false; });
  };

  await sampleStage('menu-ambient', 5000);
  await page.getByRole('button', { name: 'Career Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.__demo.state.screen === 'MATCH');
  await sampleStage('match-simulation', 5000);
  await page.evaluate(() => {
    const d = window.__demo;
    d.state.run.schedule[0] = Math.min(88, d.state.run.clock + .5);
  });
  await page.waitForFunction(() => window.__demo.state.run.building);
  await page.evaluate(() => {
    window.__movementAudit.stage = 'buildup';
    window.__movementAudit.enabled = true;
  });
  await page.waitForFunction(() => window.__demo.state.phase === 'AIM');
  await page.evaluate(() => { window.__movementAudit.enabled = false; });
  await sampleStage('aim-frozen', 300);
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__demo.state.phase === 'FLIGHT');
  await sampleStage('flight', 2500);

  const data = await page.evaluate(() => window.__movementAudit.samples);
  for (const stage of [...new Set(data.map(sample => sample.stage))]) {
    const samples = data.filter(sample => sample.stage === stage);
    // Gameplay sprinting tops out at 7.2 m/s. Faster samples are chance
    // placement between frames, not locomotion that can be judged for facing.
    const teleports = samples.filter(sample => sample.speed > 12);
    const moving = samples.filter(sample => sample.speed >= .02 && sample.speed <= 12);
    const stationary = samples.filter(sample => sample.speed < .02);
    const visual = moving.filter(sample => sample.visualError !== null);
    report.stages.push({
      stage,
      samples: samples.length,
      moving: moving.length,
      teleports: teleports.length,
      walkingStationary: stationary.length,
      rootWrong90: moving.filter(sample => sample.rootError > Math.PI / 2).length,
      visualWrong45: visual.filter(sample => sample.visualError > Math.PI / 4).length,
      visualBackward: visual.filter(sample => sample.visualError > Math.PI / 2).length,
      worstRootDegrees: moving.length ? Math.max(...moving.map(sample => sample.rootError * 180 / Math.PI)) : 0,
      worstVisualDegrees: visual.length ? Math.max(...visual.map(sample => sample.visualError * 180 / Math.PI)) : 0,
    });
  }
  report.offenders = data
    .filter(sample => sample.speed < .02 || sample.rootError > Math.PI / 4 || sample.visualError > Math.PI / 4)
    .sort((a, b) => (b.visualError || b.rootError || 0) - (a.visualError || a.rootError || 0))
    .slice(0, 80);
  await page.screenshot({ path: `${CAPTURES}/movement-facing.png` });
} catch (error) {
  report.failure = String(error?.stack || error);
} finally {
  if (browser) await browser.close();
  writeFileSync(`${CAPTURES}/movement-facing.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failure || errors.length ? 1 : 0;
}

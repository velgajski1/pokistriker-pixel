import { writeFileSync } from 'node:fs';
import { CAPTURES, assert, open, frameStats, gpuString } from './lib.mjs';

const report = { errors: [], failures: [], warnings: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  report.gpu = await gpuString(page);
  assert(await page.evaluate(() => window.__demo.striker.model === 'captain'), 'Captain did not load');
  await page.evaluate(() => {
    const d = window.__demo;
    const bones = [];
    d.striker.root.traverse(node => { if (node.isBone) bones.push(node); });
    const toes = ['toe_L', 'toe_R'].map(name => d.striker.bone(name));
    const points = toes.map(bone => bone.position.clone());
    const previous = points.map(point => point.clone());
    const rotations = bones.map(bone => bone.quaternion.clone());
    const rootPrevious = d.striker.root.position.clone();
    const cameraPosition = d.camera.position.clone();
    const cameraRotation = d.camera.quaternion.clone();
    const aimRotation = d.striker.root.quaternion.clone();
    const aimPosition = d.striker.root.position.clone();
    const samples = window.__strikerSamples = {
      slides: [], frames: [], aimFrames: 0, aimTurn: 0, aimMove: 0, idleMin: 1,
      jump: 0, handoverFrames: 0, idleReturned: false, captures: {}, launch: null,
    };
    let last, previousRun = false, previousHandover = false, aimed = false, runFrames = 0, previousSim = false;
    const capture = name => {
      d.renderer.render(d.scene, d.camera);
      samples.captures[name] = d.renderer.domElement.toDataURL('image/png');
    };
    const tick = time => {
      const dt = last === undefined ? 0 : (time - last) / 1000;
      const phase = d.state.phase;
      const weights = d.striker.weights();
      const root = d.striker.root;
      const speed = dt ? root.position.distanceTo(rootPrevious) / dt : 0;
      const sim = d.state.screen === 'MATCH' && phase === 'SIM';
      const running = sim && d.state.run?.building && speed > 4 && d.striker.speed > 4;
      if (sim && previousSim && dt) samples.frames.push(dt * 1000);
      previousSim = sim;
      toes.forEach((toe, i) => {
        toe.getWorldPosition(points[i]);
        // Meshy ToeBase is inside the boot, ~6 cm above its sole at contact.
        if (running && previousRun && Math.abs(points[i].y) <= 0.08 && Math.abs(previous[i].y) <= 0.08) {
          samples.slides.push(Math.hypot(points[i].x - previous[i].x, points[i].z - previous[i].z) / dt);
        }
        previous[i].copy(points[i]);
      });
      runFrames = running ? runFrames + 1 : 0;
      if (runFrames >= 8 && !samples.captures.run) {
        cameraPosition.copy(d.camera.position);
        cameraRotation.copy(d.camera.quaternion);
        const heading = root.rotation.y;
        d.camera.position.set(root.position.x + Math.cos(heading) * 6, 1.7,
          root.position.z - Math.sin(heading) * 6);
        d.camera.lookAt(root.position.x, 1, root.position.z);
        capture('run');
        d.camera.position.copy(cameraPosition);
        d.camera.quaternion.copy(cameraRotation);
      }
      if (phase === 'AIM' && !samples.launch) {
        if (!aimed) { aimRotation.copy(root.quaternion); aimPosition.copy(root.position); aimed = true; }
        samples.aimFrames++;
        samples.aimTurn = Math.max(samples.aimTurn, aimRotation.angleTo(root.quaternion));
        samples.aimMove = Math.max(samples.aimMove, aimPosition.distanceTo(root.position));
        samples.idleMin = Math.min(samples.idleMin, weights.idle);
      }
      if (phase === 'WINDUP' && d.shot.windup > 0.08 && !samples.captures.windup) capture('windup');
      if (phase === 'FLIGHT' && !samples.launch) {
        samples.launch = JSON.parse(JSON.stringify(d.lastLaunch));
        samples.theta = d.shot.theta;
        capture('contact');
      }
      if (phase === 'FLIGHT' && d.shot.flightTime > 0.25 && !samples.captures.flight) capture('flight');
      const handover = phase === 'FLIGHT' && d.shot.flightTime >= 0.65 && d.shot.flightTime <= 1.1;
      if (handover && previousHandover) {
        bones.forEach((bone, i) => { samples.jump = Math.max(samples.jump, rotations[i].angleTo(bone.quaternion)); });
        samples.handoverFrames++;
      }
      if (phase === 'FLIGHT' && d.shot.flightTime > 0.9 && weights.idle >= 0.99) samples.idleReturned = true;
      bones.forEach((bone, i) => rotations[i].copy(bone.quaternion));
      rootPrevious.copy(root.position);
      previousRun = running;
      previousHandover = handover;
      last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
  await page.waitForFunction(() => window.__demo.state.phase === 'AIM', null, { timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${CAPTURES}/striker-aim.png` });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__demo.shot.power >= 0.55);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__strikerSamples.idleReturned, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__demo.state.phase === 'SIM', null, { timeout: 15000 });
  const deadline = Date.now() + 240000;
  while (await page.evaluate(() => window.__strikerSamples.slides.length < 20 || window.__strikerSamples.frames.length < 300)) {
    assert(Date.now() < deadline, 'Timed out collecting build-up toe samples');
    await page.waitForFunction(() => window.__demo.state.phase === 'AIM' || window.__demo.state.screen !== 'MATCH'
      || (window.__strikerSamples.slides.length >= 20 && window.__strikerSamples.frames.length >= 300), null, { timeout: 45000 });
    const status = await page.evaluate(() => ({ screen: window.__demo.state.screen, phase: window.__demo.state.phase,
      done: window.__strikerSamples.slides.length >= 20 && window.__strikerSamples.frames.length >= 300 }));
    if (status.done) break;
    if (status.screen === 'TRAINING') {
      await page.getByRole('button', { name: 'Proceed To Next Match >', exact: true }).click();
    } else if (status.screen === 'MATCH' && status.phase === 'AIM') {
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__demo.shot.power >= 0.55);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.__demo.state.phase === 'SIM' || window.__demo.state.screen !== 'MATCH');
    } else {
      await page.getByRole('button', { name: /back|menu/i }).first().click();
      await page.getByRole('button', { name: 'Start Career >', exact: true }).click();
    }
  }
  const samples = await page.evaluate(() => window.__strikerSamples);
  for (const name of ['run', 'windup', 'contact', 'flight']) {
    assert(samples.captures[name], `Missing ${name} capture`);
    writeFileSync(`${CAPTURES}/striker-${name}.png`, Buffer.from(samples.captures[name].split(',')[1], 'base64'));
  }
  assert(samples.slides.length >= 8, `Too few planted toe samples: ${samples.slides.length}`);
  samples.slides.sort((a, b) => a - b);
  report.toe = { count: samples.slides.length, median: samples.slides[Math.floor(samples.slides.length / 2)],
    p90: samples.slides[Math.ceil(samples.slides.length * 0.9) - 1] };
  assert(report.toe.median < 1, `Toe skating: ${report.toe.median} m/s`);
  assert(samples.aimFrames >= 60 && samples.idleMin >= 0.9, 'Idle missing during aim');
  assert(samples.aimTurn < 1e-5 && samples.aimMove < 1e-5, 'Striker moved while aiming');
  const { instep, ball } = samples.launch;
  const delta = instep.map((value, i) => value - ball[i]);
  report.contactDistance = Math.hypot(...delta);
  report.contactBehind = delta[0] * Math.sin(samples.theta) - delta[2] * Math.cos(samples.theta);
  const ballRadius = await page.evaluate(() => {
    window.__demo.ball.geometry.computeBoundingSphere();
    return window.__demo.ball.geometry.boundingSphere.radius;
  });
  assert(Math.abs(report.contactDistance - ballRadius) <= 0.05, 'Instep missed ball');
  assert(report.contactBehind < 0, 'Instep is ahead of ball');
  report.handoverDegrees = samples.jump * 180 / Math.PI;
  assert(samples.handoverFrames >= 8 && samples.idleReturned && report.handoverDegrees <= 8, 'Kick-to-idle handover popped');
  report.frameStats = frameStats(samples.frames);
  if (report.frameStats.p95 >= 25) {
    const message = `SIM frame p95 ${report.frameStats.p95} ms exceeds budget`;
    if (/SwiftShader|llvmpipe/i.test(report.gpu)) report.warnings.push(message);
    else report.failures.push(message);
  }
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Runtime errors occurred');
  const json = JSON.stringify(report, null, 2);
  writeFileSync(`${CAPTURES}/striker.json`, `${json}\n`);
  console.log(json);
  process.exitCode = report.failures.length ? 1 : 0;
}

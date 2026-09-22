import { writeFileSync } from 'node:fs';
import { open } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  await page.evaluate(async () => {
    window.reviewEngine = await import('/js/gameEngine.js');
    window.reviewThree = await import('three');
    __demo.renderer.setAnimationLoop(null);
    reviewEngine.setStrikerAppearance('lars');
    document.querySelectorAll('body > :not(canvas):not(script)').forEach(n => {
      if (!n.contains(__demo.renderer.domElement)) n.style.visibility = 'hidden';
    });
    window.reviewPlayer = __demo.players.find(p => p.role === 'striker');
  });
  for (const side of [0, 1, 2]) {
    const data = await page.evaluate(side => {
      const T = reviewThree, p = reviewPlayer;
      const head = p.model.getObjectByName('mixamorigHead');
      const target = head.getWorldPosition(new T.Vector3());
      const angle = side * Math.PI * .65 + p.root.rotation.y;
      __demo.camera.position.set(target.x + Math.sin(angle) * .75, target.y + .04,
        target.z + Math.cos(angle) * .75);
      __demo.camera.lookAt(target);
      __demo.renderer.render(__demo.scene, __demo.camera);
      return __demo.renderer.domElement.toDataURL('image/png').split(',')[1];
    }, side);
    writeFileSync(`.captures/lars-${process.argv[2] || 'review'}-${side}.png`, Buffer.from(data, 'base64'));
  }
  const reports = [];
  for (const name of ['celebrate_victory', 'celebrate_jump', 'celebrate_cheer']) {
    const result = await page.evaluate(name => {
      const T = reviewThree, p = reviewPlayer, mixer = __demo.striker.mixer;
      const actions = mixer._actions;
      const action = actions.find(a => a.getClip().name === name);
      if (!action) throw new Error('Missing clip: ' + name);
      const duration = action.getClip().duration;
      mixer.timeScale = 1;
      for (const a of actions) a.setEffectiveWeight(a === action ? 1 : 0);
      p.root.rotation.set(0, 0, 0);
      const sheet = document.createElement('canvas');
      sheet.width = 1200; sheet.height = 800;
      const ctx = sheet.getContext('2d');
      let minFoot = Infinity, maxFoot = -Infinity;
      const foot = new T.Vector3();
      for (let i = 0; i <= 120; i++) {
        action.time = duration * i / 120;
        mixer.update(0);
        p.root.updateMatrixWorld(true);
        for (const side of ['Left', 'Right']) {
          p.model.getObjectByName('mixamorig' + side + 'ToeBase').getWorldPosition(foot);
          minFoot = Math.min(minFoot, foot.y); maxFoot = Math.max(maxFoot, foot.y);
          if (!Number.isFinite(foot.y)) throw new Error('Invalid pose');
        }
        if (i % 24 === 0) {
          const index = i / 24;
          __demo.camera.position.set(p.root.position.x + 1.5, 1.5, p.root.position.z + 3.7);
          __demo.camera.lookAt(p.root.position.x, 1.05, p.root.position.z);
          __demo.renderer.render(__demo.scene, __demo.camera);
          const canvas = __demo.renderer.domElement;
          const crop = canvas.height;
          ctx.drawImage(canvas, (canvas.width - crop) / 2, 0, crop, crop,
            (index % 3) * 400, Math.floor(index / 3) * 400, 400, 400);
          ctx.fillStyle = 'white'; ctx.font = '18px sans-serif';
          ctx.fillText(name + ' ' + action.time.toFixed(1), (index % 3) * 400 + 10, Math.floor(index / 3) * 400 + 25);
        }
      }
      return { name, duration, minFoot, maxFoot, image: sheet.toDataURL().split(',')[1] };
    }, name);
    writeFileSync(`.captures/${name}.png`, Buffer.from(result.image, 'base64'));
    delete result.image;
    reports.push(result);
  }
  if (process.argv.includes('--live')) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => __demo.ready);
    await page.evaluate(async () => {
      window.reviewEngine = await import('/js/gameEngine.js');
      reviewEngine.onFrame(() => {});
      reviewEngine.setAnimationsPaused(false);
    });
    for (const report of reports) {
      const start = await page.evaluate(name => {
        reviewEngine.stopReactions();
        reviewEngine.stopCelebration();
        const p = __demo.players.find(p => p.role === 'striker');
        p.root.position.x = 0;
        const total = reviewEngine.startCelebration(name);
        return { total, run: reviewEngine.celebration.runDuration };
      }, report.name);
      if (start.total !== 8) throw new Error('Celebration must total eight seconds');
      await page.waitForFunction(() => reviewEngine.celebration.phase === 'perform');
      const arrival = await page.evaluate(() => {
        const p = __demo.players.find(p => p.role === 'striker');
        return { x: p.root.position.x, z: p.root.position.z };
      });
      await page.waitForFunction(() => reviewEngine.celebration.time >= reviewEngine.celebration.duration);
      const end = await page.evaluate(() => {
        const p = __demo.players.find(p => p.role === 'striker');
        return { x: p.root.position.x, z: p.root.position.z };
      });
      if (arrival.x !== end.x || arrival.z !== end.z) throw new Error('Root glides during celebration');
      report.live = { ...start, runDistance: Math.abs(arrival.x), stationaryDuringPerformance: true };
      if (Math.abs(arrival.x) < .5) throw new Error('Missing run-up');
    }
  }
  writeFileSync('.captures/celebrations-report.json', JSON.stringify({ errors, reports }, null, 2));
  console.log(JSON.stringify({ errors, reports }));
  if (errors.length) throw new Error('Browser errors recorded');
} finally {
  await browser.close();
}

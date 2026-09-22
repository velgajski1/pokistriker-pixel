import { writeFileSync } from 'node:fs';
import { open } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.evaluate(async () => {
    window.e = await import('/js/gameEngine.js');
    window.T = await import('three');
    e.onFrame(() => {});
    e.setAnimationsPaused(false);
    document.querySelectorAll('body > :not(canvas):not(script)').forEach(n => {
      if (!n.contains(__demo.renderer.domElement)) n.style.visibility = 'hidden';
    });
  });
  const reports = [];
  for (const role of ['shooter', 'keeper']) {
    const report = await page.evaluate(async role => {
      e.stopCelebration(); e.stopReactions();
      const p = __demo.players.find(p => role === 'shooter' ? p.role === 'striker' : p.role === 'keeper' && p.team === 'away');
      p.root.position.set(0, 0, 0); p.root.rotation.set(0, Math.PI, 0);
      for (const q of __demo.players) q.root.visible = q === p;
      e.startReaction(role, 'react_walk_sad');
      const sheet = document.createElement('canvas'); sheet.width = 1600; sheet.height = 500;
      const ctx = sheet.getContext('2d');
      const samples = [];
      const started = performance.now();
      let shot = 0;
      const times = [.15, .5, 1.5, 3.5];
      const v = new T.Vector3();
      await new Promise(resolve => {
        const frame = () => {
          const time = (performance.now() - started) / 1000;
          p.root.updateWorldMatrix(true, true);
          const bones = {};
          for (const name of ['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand']) {
            p.model.getObjectByName('mixamorig' + name).getWorldPosition(v);
            bones[name] = v.toArray();
          }
          samples.push({ time, position: p.root.position.toArray(), heading: p.root.rotation.y, bones });
          if (shot < times.length && time >= times[shot]) {
            const pos = p.root.position;
            __demo.camera.position.set(pos.x + 2.4, 1.45, pos.z + 3.5);
            __demo.camera.lookAt(pos.x, .95, pos.z);
            __demo.renderer.render(__demo.scene, __demo.camera);
            const c = __demo.renderer.domElement;
            ctx.drawImage(c, (c.width - c.height * .8) / 2, 0, c.height * .8, c.height,
              shot * 400, 0, 400, 500);
            ctx.fillStyle = 'white'; ctx.font = '18px sans-serif';
            ctx.fillText(`${role} ${time.toFixed(2)}s`, shot * 400 + 8, 24);
            shot++;
          }
          if (time < 4.4) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      return { role, samples, image: sheet.toDataURL().split(',')[1] };
    }, role);
    writeFileSync(`.captures/sad-walk-${role}-review.png`, Buffer.from(report.image, 'base64'));
    delete report.image;
    reports.push(report);
  }
  writeFileSync('.captures/sad-walk-review.json', JSON.stringify({ reports, errors }, null, 2));
  console.log(JSON.stringify({ counts: reports.map(r => [r.role, r.samples.length]), errors }));
} finally { await browser.close(); }

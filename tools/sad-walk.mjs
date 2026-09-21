import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  const report = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js'), d = __demo;
    e.parade(2, 1); e.setAnimationsPaused(true);
    const p = d.players[2], a = p.rig.avatar;
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 840;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#202730'; ctx.fillRect(0, 0, 1280, 840);
    const measures = [];
    for (const [row, name] of ['walk', 'react_walk_sad'].entries()) {
      for (const [col, time] of [.35, 1.2, 2.4, 3.5].entries()) {
        for (const action of Object.values(a.actions)) action.setEffectiveWeight(0);
        a.actions[name].setEffectiveWeight(1); a.actions[name].time = time % a.data.clips[name].duration;
        a.mixer.update(0); p.root.updateWorldMatrix(true, true);
        const point = name => { const b = p.model.getObjectByName('mixamorig' + name); return b.getWorldPosition(b.position.clone()); };
        const neck = point('Neck'), left = point('LeftArm'), right = point('RightArm'), head = point('Head');
        measures.push({ name, time, width: left.distanceTo(right), headClearance: head.y - (left.y + right.y) / 2 });
        d.camera.position.set(neck.x + .55, neck.y + .18, neck.z + 1.25);
        d.camera.lookAt(neck.x, neck.y - .08, neck.z); d.renderer.render(d.scene, d.camera);
        const img = new Image(); img.src = d.renderer.domElement.toDataURL(); await img.decode();
        ctx.drawImage(img, 570, 60, 780, 975, col * 320, row * 420, 320, 400);
        ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(name + ' ' + time + 's', col * 320 + 8, row * 420 + 415);
      }
    }
    return { measures, image: canvas.toDataURL() };
  });
  writeFileSync('.captures/sad-walk-upper-body.png', Buffer.from(report.image.split(',')[1], 'base64'));
  assert(report.measures.every(m => Number.isFinite(m.width) && m.headClearance > .1), 'Compressed or invalid upper-body pose');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(report.measures, null, 2));
} finally { await browser.close(); }

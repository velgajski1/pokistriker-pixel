import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  const result = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const d = __demo;
    e.parade(0, 23);
    e.setAnimationsPaused(true);
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#202730'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const seen = new Set(), looks = [];
    for (const p of d.players) {
      const key = p.look.style + p.look.skin + p.look.hair;
      if (seen.has(key)) continue;
      seen.add(key);
      p.root.updateWorldMatrix(true, true);
      const head = p.model.getObjectByName('mixamorigHead');
      const target = head.getWorldPosition(head.position.clone());
      target.y += .075;
      d.camera.position.set(target.x + .25, target.y + .025, target.z + .85);
      d.camera.lookAt(target);
      d.renderer.render(d.scene, d.camera);
      const img = new Image();
      img.src = d.renderer.domElement.toDataURL();
      await img.decode();
      const n = looks.length, x = n % 5 * 240, y = Math.floor(n / 5) * 250;
      ctx.drawImage(img, 670, 250, 580, 580, x, y, 240, 220);
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif';
      ctx.fillText(p.look.style + (p.look.beard >= .4 ? ' / stubble' : ''), x + 8, y + 240);
      let halo = false;
      head.traverse(node => { if (node.geometry?.type === 'TorusGeometry') halo = true; });
      looks.push({ style: p.look.style, halo });
    }
    return { image: canvas.toDataURL(), looks };
  });
  writeFileSync('.captures/faces.png', Buffer.from(result.image.split(',')[1], 'base64'));
  assert(result.looks.length === 17, 'Missing appearance presets');
  assert(result.looks.every(look => !look.halo), 'Floating headband remains');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(result.looks));
} finally { await browser.close(); }

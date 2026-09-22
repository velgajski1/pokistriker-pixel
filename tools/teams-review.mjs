import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  const result = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const { OPPONENT_COLORS } = await import('/js/app.js');
    const d = window.__demo;
    d.renderer.setAnimationLoop(null);
    e.parade(0, 23);
    const player = d.players.find(p => p.team === 'away' && p.role === 'outfield');
    player.root.rotation.set(0, 0, 0);
    player.root.updateWorldMatrix(true, true);
    const target = player.root.position.clone();
    target.y += 1.05;
    d.camera.aspect = 1;
    d.camera.updateProjectionMatrix();
    d.renderer.setSize(400, 400, false);
    d.camera.position.set(target.x + .3, target.y + .25, target.z + 2.5);
    d.camera.lookAt(target);
    const canvas = document.createElement('canvas');
    canvas.width = 1500; canvas.height = 680;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#15212d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const patterns = [];
    OPPONENT_COLORS.forEach((theme, i) => {
      e.setMatchColors(theme, 100);
      d.renderer.render(d.scene, d.camera);
      const x = i % 5 * 300, y = Math.floor(i / 5) * 340;
      ctx.drawImage(d.renderer.domElement, x, y, 300, 300);
      ctx.fillStyle = '#fff'; ctx.font = '16px Arial';
      ctx.fillText(`${i + 1}. ${theme.name} / ${theme.pattern}`, x + 8, y + 324);
      player.model.traverse(node => {
        if (node.isMesh && node.material.name === 'kit') patterns.push(node.material.userData.teamPattern.pattern.value);
      });
    });
    return { image: canvas.toDataURL(), patterns };
  });
  writeFileSync('.captures/teams-review.png', Buffer.from(result.image.split(',')[1], 'base64'));
  assert(result.patterns.includes(1) && result.patterns.includes(2) && result.patterns.includes(3), 'Missing shirt patterns');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: ten team kits rendered; stripes, hoops and checks enabled; no browser errors.');
} finally { await browser.close(); }

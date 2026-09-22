import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  await page.waitForFunction(() => __demo.state.phase === 'AIM');
  const pose = () => page.evaluate(() => {
    const values = [];
    __demo.players.find(player => player.role === 'striker').model.traverse(node => {
      if (node.isBone) values.push(...node.position.toArray(), ...node.quaternion.toArray());
    });
    return values;
  });
  const before = await pose();
  await page.waitForTimeout(500);
  assert(JSON.stringify(before) === JSON.stringify(await pose()), 'Pre-shot stance must remain frozen');
  const result = await page.evaluate(async () => {
    const d = __demo;
    d.renderer.setAnimationLoop(null);
    const p = d.players.find(player => player.role === 'striker');
    const canvas = document.createElement('canvas');
    canvas.width = 1000; canvas.height = 650;
    const ctx = canvas.getContext('2d');
    const point = name => {
      const bone = p.model.getObjectByName('mixamorig' + name);
      return bone.getWorldPosition(bone.position.clone());
    };
    const neck = point('Neck');
    const yaw = p.root.rotation.y;
    for (const [i, angle] of [0, Math.PI / 2].entries()) {
      d.camera.position.set(neck.x + Math.sin(yaw + angle) * 2.3,
        neck.y + .05, neck.z + Math.cos(yaw + angle) * 2.3);
      d.camera.lookAt(neck.x, neck.y - .35, neck.z);
      d.renderer.render(d.scene, d.camera);
      const img = new Image(); img.src = d.renderer.domElement.toDataURL(); await img.decode();
      ctx.drawImage(img, 545, 0, 830, 1080, i * 500, 0, 500, 650);
    }
    return { image: canvas.toDataURL(), phase: d.state.phase };
  });
  writeFileSync('.captures/idle-shoulders-' + (process.argv[2] || 'current') + '.png',
    Buffer.from(result.image.split(',')[1], 'base64'));
  // Restore the normal render loop and verify idle still transitions into a shot.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => __demo?.ready && __demo.state.phase === 'AIM');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'POWER');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT');
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: front/profile capture, frozen AIM stance, POWER and FLIGHT transitions; no browser errors.');
} finally { await browser.close(); }

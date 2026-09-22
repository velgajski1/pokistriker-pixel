import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';

const label = process.argv[2] || 'after';
if (!/^[a-z-]+$/.test(label)) throw new Error('Invalid capture label');
const { browser, page, errors } = await open();
try {
  const shots = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const d = window.__demo;
    e.onFrame(() => {});
    d.renderer.setAnimationLoop(null);
    const z = d.dimensions.goal.PLANE_Z;
    const views = [
      { name: 'shooting', position: [0, 3, z + 17], target: [0, 3, z - 7] },
      { name: 'overhead', position: [0, 72, z + 60], target: [0, 0, z + 45] },
      { name: 'wide', position: [60, 40, z + 95], target: [0, 4, z + 48] },
    ];
    return views.map(view => {
      d.camera.position.set(...view.position);
      d.camera.lookAt(...view.target);
      d.renderer.render(d.scene, d.camera);
      return { name: view.name, image: d.renderer.domElement.toDataURL(),
        calls: d.renderer.info.render.calls, triangles: d.renderer.info.render.triangles };
    });
  });
  for (const shot of shots) {
    writeFileSync(`.captures/stadium-${label}-${shot.name}.png`, Buffer.from(shot.image.split(',')[1], 'base64'));
    console.log(`${shot.name}: ${shot.calls} draw calls, ${shot.triangles} triangles`);
  }
  assert(!errors.length, errors.join('\n'));
  console.log('PASS: three stadium views rendered without browser errors.');
} finally { await browser.close(); }

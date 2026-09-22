import { open, assert } from './lib.mjs';

const errors = [];
const { browser, page } = await open(errors);
try {
  await page.keyboard.press('Alt+4');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '.captures/staff-shooting.png' });
  await page.evaluate(async () => {
    window.staffEngine = await import('/js/gameEngine.js');
    staffEngine.onFrame(() => {});
    staffEngine.setAnimationsPaused(false);
    staffEngine.objects.ball.position.set(0, .12, 5);
    window.staffStart = staffEngine.sidelineStaff.officials.map(o => o.rig.root.position.z);
  });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => {
    const s = staffEngine.sidelineStaff;
    return {
      officials: s.officials.map((o, i) => ({ x: o.rig.root.position.x, z: o.rig.root.position.z,
        moved: Math.abs(o.rig.root.position.z - staffStart[i]), speed: o.speed,
        facing: Math.cos(o.rig.root.rotation.y) })),
      photographers: s.photographers.map(p => ({ x: p.rig.root.position.x, z: p.rig.root.position.z,
        loaded: !!p.model })),
    };
  });
  assert(result.officials.length === 2 && result.photographers.length === 4, 'Staff counts');
  assert(result.officials.every(o => Math.abs(o.x) > 34 && Math.abs(o.x) < 37), 'Touchline bounds');
  assert(result.officials.some(o => o.moved > .1), 'Officials move');
  assert(result.photographers.every(p => p.z < -20 || p.z > 85), 'Photographers behind goals');
  assert(result.photographers.every(p => p.loaded), 'Meshy photographer models loaded');
  for (const [kind, index] of [['photographers', 0], ['photographers', 1], ['officials', 0]]) {
    await page.evaluate(({ kind, index }) => {
      __demo.renderer.setAnimationLoop(null);
      const p = staffEngine.sidelineStaff[kind][index].rig.root.position;
      __demo.camera.position.set(p.x + 2.5, 2.1, p.z + 3.5);
      __demo.camera.lookAt(p.x, 1, p.z);
      __demo.renderer.render(__demo.scene, __demo.camera);
      document.querySelectorAll('body > :not(canvas):not(script)').forEach(n => {
        if (!n.contains(__demo.renderer.domElement)) n.style.visibility = 'hidden';
      });
    }, { kind, index });
    await page.screenshot({ path: `.captures/staff-${kind}-${index}.png` });
  }
  assert(errors.length === 0, errors.join('\n'));
  console.log(JSON.stringify({ ...result, errors }, null, 2));
} finally {
  await browser.close();
}

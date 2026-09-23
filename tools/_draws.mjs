import { open } from './lib.mjs';
const errors = [];
const { browser, page } = await open(errors);
await page.goto('http://localhost:5174/?shot=timing&quality=low', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demo?.ready);
await page.waitForTimeout(2200);
await page.screenshot({ path: '.captures/merged-players.png' });
const byName = await page.evaluate(async () => {
  const T = await import('three'), d = __demo, cam = d.camera;
  const frustum = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const tally = {};
  d.scene.traverseVisible(o => {
    if (!(o.isMesh || o.isSprite || o.isLine || o.isPoints)) return;
    if (o.frustumCulled && !frustum.intersectsObject(o)) return;
    const key = (o.name || o.geometry?.type || o.type).replace(/-\d+-\d+$/, '-*').slice(0, 28);
    tally[key] = (tally[key] || 0) + 1;
  });
  return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 22);
});
console.log(JSON.stringify(byName), errors);
await browser.close();

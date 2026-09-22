// Renders thumbnail candidates from the live game, 1024x1024, full bleed:
//   thumb-hero-<n>.png   low angle, striker mid-strike, ball big in the foreground
//                        (a fresh random striker look per boot)
//   thumb-net-<n>.png    the ball bulging the net inside the target, keeper beaten
//   logo/*.png           the same images with the BLOCK STRIKER logo, for places
//                        that allow text (store pages, social). Poki's thumbnail
//                        guidance is "avoid text", so upload the plain ones there.
//   thumbnails-sheet.png everything at full and at Poki tile size, for picking.
// Usage: node tools/poki-thumbnail.mjs [boots=4]   (server on DEMO_URL)
import { mkdirSync, writeFileSync } from 'node:fs';
import { open } from './lib.mjs';

const OUT = 'dist/poki';
mkdirSync(`${OUT}/logo`, { recursive: true });
const boots = Number(process.argv[2]) || 4;
const shots = {};
const raf = { polling: 'raf', timeout: 30000 };

async function stage(page) {
  await page.evaluate(() => {
    /** Renders from a staged camera at 1024x1024, colour-punched; returns a PNG data URL. */
    window.__thumb = async (setup) => {
      const THREE = await import('three');
      const d = __demo, renderer = d.renderer, scene = d.scene;
      const size = renderer.getSize(new THREE.Vector2());
      renderer.setSize(1024, 1024, false);
      const camera = new THREE.PerspectiveCamera(setup.fov ?? 42, 1, .05, 400);
      camera.position.fromArray(setup.position);
      camera.lookAt(new THREE.Vector3().fromArray(setup.look));
      const key = new THREE.DirectionalLight(0xfff1dc, setup.key ?? 2.6);
      key.position.copy(camera.position).add(new THREE.Vector3(.6, 1.6, 0));
      key.target.position.fromArray(setup.look);
      scene.add(key, key.target);
      const hidden = [];
      scene.traverse(n => {
        const hide = n.name === 'advertising-board' || (n.name === 'arcade-target' && setup.noTarget);
        if (hide && n.visible) { n.visible = false; hidden.push(n); }
      });
      renderer.render(scene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      const g = canvas.getContext('2d');
      g.filter = 'saturate(1.3) contrast(1.1) brightness(1.05)';
      g.drawImage(renderer.domElement, 0, 0);
      for (const n of hidden) n.visible = true;
      scene.remove(key, key.target);
      renderer.setSize(size.x, size.y, false);
      return canvas.toDataURL('image/png');
    };
  });
}

const aimAndShoot = async (page, level) => {
  await page.waitForFunction(() => __demo.state.phase === 'AIM', null, raf);
  await page.evaluate(lvl => { __demo.state.run.level = lvl; __demo.state.run.hearts = 5; }, level);
  await page.waitForFunction(() => Math.abs(__demo.shot.aimX - __demo.target.x) < .25, null, raf);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => __demo.state.phase === 'POWER' && __demo.shot.powerDir > 0
    && Math.abs(__demo.prediction.y - __demo.target.y) < .15, null, raf);
  await page.keyboard.press('Space');
};
const frame = page => page.evaluate(() => {
  const d = __demo, s = d.striker.root.position, b = d.ball.position;
  const gz = d.dimensions.goal.PLANE_Z, len = Math.hypot(s.x, gz - s.z);
  const head = d.striker.bone('head').getWorldPosition(s.clone());
  return { s: [s.x, s.y, s.z], b: [b.x, b.y, b.z], g: [-s.x / len, 0, (gz - s.z) / len], gz,
    head: [head.x, head.y, head.z] };
});
const add = (p, q, k = 1) => p.map((v, i) => v + q[i] * k);
const across = g => [-g[2], 0, g[0]];

for (let boot = 1; boot <= boots; boot++) {
  const { browser, page } = await open();
  await stage(page);
  // Hero: low and close, aimed between the face and the ball.
  await aimAndShoot(page, 1);
  await page.waitForFunction(() => __demo.state.phase === 'FLIGHT' && __demo.shot.flightTime > .035, null, raf);
  {
    const f = await frame(page);
    const position = add(add(f.s, f.g, 2.7), across(f.g), 1.3 + (boot % 3) * .25); position[1] = .45 + (boot % 2) * .1;
    const look = [(f.head[0] + f.b[0]) / 2, (f.head[1] + f.b[1]) / 2 + .1, (f.head[2] + f.b[2]) / 2];
    shots[`hero-${boot}`] = await page.evaluate(s => __thumb(s), { position, look, fov: 52, noTarget: true });
  }
  await page.waitForFunction(() => __demo.shot.resolved !== null, null, raf);
  await page.keyboard.press('Space');
  // Net: a stronger keeper, the ball already in the target, seen from the pitch at an angle.
  for (let attempt = 0; attempt < 5 && !shots[`net-${boot}`]; attempt++) {
    await aimAndShoot(page, 8);
    const scored = await page.waitForFunction(() => {
      const d = __demo;
      if (d.shot.resolved !== null && d.shot.resolved !== 'goal') return 'miss';
      return d.shot.entered && d.ballState.position.z < d.dimensions.goal.PLANE_Z - .35 ? 'net' : false;
    }, null, raf).then(h => h.jsonValue());
    if (scored === 'net') {
      const f = await frame(page);
      // From the ball's side, close to the post: ball and target in front, the
      // beaten keeper behind them.
      const side = f.b[0] >= 0 ? 1 : -1;
      const position = [f.b[0] + side * 1.1, 1.1, f.gz + 2.8];
      const look = [f.b[0] - side * .9, Math.max(.9, f.b[1]), f.gz - .4];
      shots[`net-${boot}`] = await page.evaluate(s => __thumb(s), { position, look, fov: 50, key: 1.8 });
    }
    await page.waitForFunction(() => __demo.shot.resolved !== null, null, raf);
    await page.keyboard.press('Space');
  }
  await browser.close();
}

// Logo versions and the contact sheet, composed with the game's own pixel font.
const { browser, page } = await open();
const composed = await page.evaluate(async shots => {
  await document.fonts.load('700 100px "Pixelify Sans"');
  const logo = async url => {
    const image = new Image(); image.src = url; await image.decode();
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    g.drawImage(image, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'top';
    const y = 40;
    // A soft dark band behind the logo keeps it readable over crowd or sky.
    const band = g.createLinearGradient(0, 0, 0, 380);
    band.addColorStop(0, '#0008'); band.addColorStop(.75, '#0004'); band.addColorStop(1, '#0000');
    g.fillStyle = band; g.fillRect(0, 0, 1024, 380);
    const text = (word, size, top, fill, shadows) => {
      g.font = `700 ${size}px "Pixelify Sans"`;
      for (const [dx, dy, colour] of shadows) { g.fillStyle = colour; g.fillText(word, 512 + dx, top + dy); }
      g.fillStyle = fill; g.fillText(word, 512, top);
    };
    // Grass-over-dirt "BLOCK", gold "STRIKER", each with stepped pixel shadows.
    text('BLOCK', 150, y, '#5daa3b', [[8, 22, '#000a'], [0, 16, '#5e3a1f'], [0, 11, '#8b5a34'], [0, 5, '#3e7d26']]);
    text('STRIKER', 112, y + 150, '#ffd23f', [[6, 14, '#000a'], [0, 6, '#b8860b']]);
    return c.toDataURL('image/png');
  };
  const out = {};
  for (const [name, url] of Object.entries(shots)) out[name] = await logo(url);
  const names = Object.keys(shots), cell = 300, tile = 150, per = 4;
  const rows = Math.ceil(names.length / per);
  const c = document.createElement('canvas');
  c.width = per * (cell + tile + 40) + 20; c.height = rows * (cell + 60) + 20;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  for (const [i, name] of names.entries()) {
    const image = new Image(); image.src = shots[name]; await image.decode();
    const x = 20 + (i % per) * (cell + tile + 40), y = 20 + Math.floor(i / per) * (cell + 60);
    g.drawImage(image, x, y, cell, cell);
    g.drawImage(image, x + cell + 10, y + cell - tile, tile, tile);
    g.fillStyle = '#222'; g.font = 'bold 18px sans-serif'; g.fillText(name, x, y + cell + 24);
  }
  out.__sheet = c.toDataURL('image/png');
  return out;
}, shots);
await browser.close();

for (const [name, url] of Object.entries(shots)) writeFileSync(`${OUT}/thumb-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
for (const [name, url] of Object.entries(composed)) {
  if (name === '__sheet') writeFileSync(`${OUT}/thumbnails-sheet.png`, Buffer.from(url.split(',')[1], 'base64'));
  else writeFileSync(`${OUT}/logo/thumb-${name}-logo.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log('rendered:', Object.keys(shots).join(', '));

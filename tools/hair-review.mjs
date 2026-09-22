import { writeFileSync } from 'node:fs';
import { open, assert } from './lib.mjs';

const label = process.argv[2] || 'after';
if (!/^[a-z-]+$/.test(label)) throw new Error('Use a simple capture label');
const { browser, page, errors } = await open();
try {
  const result = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const d = window.__demo;
    e.onFrame(() => {});
    e.parade(0, 23);
    e.setAnimationsPaused(true);
    d.renderer.setSize(520, 520, false);
    d.camera.aspect = 1;
    d.camera.updateProjectionMatrix();
    const sheet = (entries, career) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1040;
      canvas.height = Math.ceil(entries.length * 2 / 4) * 290;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#202730';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let tile = 0;
      for (const entry of entries) {
        if (career) e.setStrikerAppearance(entry.id);
        const rig = career ? d.players.find(player => player.root === d.striker.root) : entry;
        rig.root.updateWorldMatrix(true, true);
        const head = rig.model.getObjectByName('mixamorigHead');
        const target = head.getWorldPosition(head.position.clone());
        target.y += .07;
        for (const side of [false, true]) {
          d.camera.position.set(target.x + (side ? .55 : .1), target.y + .10, target.z + (side ? .18 : .56));
          d.camera.lookAt(target);
          d.renderer.render(d.scene, d.camera);
          const x = tile % 4 * 260, y = Math.floor(tile / 4) * 290;
          ctx.drawImage(d.renderer.domElement, x, y, 260, 260);
          ctx.fillStyle = '#fff';
          ctx.font = '14px sans-serif';
          ctx.fillText(`${career ? entry.name : entry.look.style} / ${side ? 'side' : 'front'}`, x + 5, y + 279);
          tile++;
        }
      }
      return canvas.toDataURL();
    };
    const seen = new Set();
    const presets = d.players.filter(rig => {
      const key = rig.look.style + ':' + rig.look.skin + ':' + rig.look.hair;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const squad = sheet(presets, false);
    const career = sheet(d.characters, true);
    return { squad, career, presets: presets.length, characters: d.characters.length };
  });
  for (const kind of ['squad', 'career']) {
    writeFileSync(`.captures/hair-${label}-${kind}.png`, Buffer.from(result[kind].split(',')[1], 'base64'));
  }
  assert(result.characters === 8, 'Missing career characters');
  assert(result.presets === 17, 'Missing squad presets');
  assert(!errors.length, errors.join('\n'));
  console.log(`Captured ${result.characters} career characters and ${result.presets} squad presets, front and side; no browser errors.`);
} finally {
  await browser.close();
}

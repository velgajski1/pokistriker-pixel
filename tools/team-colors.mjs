import { open, assert } from './lib.mjs';

const { browser, page, errors } = await open();
try {
  const results = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const { OPPONENT_COLORS } = await import('/js/app.js');
    const d = __demo;
    d.renderer.setAnimationLoop(null);
    // Block players: the rig's kit plus a hash of the painted skin canvas.
    const collect = () => d.players.map(p => {
      const canvas = p.rig.blocks.canvas, data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let i = 0; i < data.length; i += 4) hash = (Math.imul(hash, 31) + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7) | 0;
      return { ...p.rig.kit, skin: p.rig.look.skin, hair: p.rig.look.hair, canvas: hash };
    });
    const before = collect();
    const buffers = e.crowd.batches.map(m => m.instanceColor);
    const rows = OPPONENT_COLORS.map((theme, i) => {
      e.setMatchColors(theme, 7319 + i * 937);
      const after = collect();
      const correct = d.players.every((p, j) => p.team !== 'away'
        ? JSON.stringify(before[j]) === JSON.stringify(after[j])
        : ['kit', 'shorts', 'socks'].every(r => after[j][r] === (p.role === 'keeper' ? theme.keeper : theme)[r])
          && before[j].skin === after[j].skin && before[j].hair === after[j].hair
          && (after[j].canvas !== before[j].canvas || JSON.stringify(before[j]) === JSON.stringify(after[j])));
      const shirt = e.crowd.batches.find(m => m.userData.part === 0);
      let checksum = 0;
      for (const value of shirt.instanceColor.array) checksum += value;
      return { name: theme.name, correct, crowdChecksum: checksum,
        buffersReused: e.crowd.batches.every((m, j) => m.instanceColor === buffers[j]) };
    });
    return rows;
  });
  assert(results.every(r => r.correct && r.buffersReused), 'Team colours incorrect or instance buffers recreated');
  assert(results.length === 10, 'Expected ten opponents');
  assert(new Set(results.map(r => r.crowdChecksum)).size === 10, 'Crowd colours did not vary with each palette');
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

import { open, assert } from './lib.mjs';
const { browser, page, errors } = await open();
try {
  const results = await page.evaluate(async () => {
    const e = await import('/js/gameEngine.js');
    const result = [];
    for (const hz of [30, 60, 144]) for (const speed of [1, 6]) {
      const actor = { x: 0, z: 0, heading: Math.PI };
      let minDot = 1, turnedFirst = false;
      for (let i = 0; i < hz * 3; i++) {
        const x = actor.x, z = actor.z;
        e.moveActorForward(actor, 0, 12, speed / hz, 1 / hz);
        const dx = actor.x - x, dz = actor.z - z, d = Math.hypot(dx, dz);
        if (i === 0) turnedFirst = d === 0 && actor.heading !== Math.PI;
        if (d > 1e-8) minDot = Math.min(minDot, (dx * Math.sin(actor.heading) + dz * Math.cos(actor.heading)) / d);
      }
      result.push({ hz, speed, turnedFirst, minDot, z: actor.z });
    }
    return result;
  });
  assert(results.every(r => r.turnedFirst && r.minDot > .99999 && r.z > 1), 'Forward gait moved backward or failed to turn');
  for (const speed of [1, 6]) {
    const positions = results.filter(r => r.speed === speed).map(r => r.z);
    assert(Math.max(...positions) - Math.min(...positions) < .15, 'Turn/movement varies excessively by frame rate');
  }
  assert(!errors.length, errors.join('\n'));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

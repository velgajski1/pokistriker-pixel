// The keeper never stops a shot that crosses inside the target, and never
// visibly passes through one: for shots aimed at random points inside the
// ring (and the 0.3 m "through his fingers" band around it), the keeper must
// never stop a shot (only the frame may, near the posts) and
// the keeper's limbs must never overlap the ball's path ("ghosted").
// Usage: node tools/keeper-reach.mjs [shotsPerLevel=200]
import { open } from './lib.mjs';

const shots = Number(process.argv[2]) || 200;
const errors = [];
const { browser, page } = await open(errors);
const rows = await page.evaluate(async shots => {
  const app = await import('/js/app.js');
  const out = [];
  for (const level of [1, 3, 5, 8, 12, 16]) {
    const row = { level, beaten: 0, scored: 0, ghosted: 0, saved: 0, frame: 0 };
    const origin = { x: 0, y: 0, z: 0 }, target = {};
    for (let i = 0; i < shots; i++) {
      app.chooseChanceOrigin(origin, level);
      const range = origin.z - __demo.dimensions.goal.PLANE_Z;
      const keeperX = Math.max(-2.6, Math.min(2.6, origin.x * .25));
      app.chooseTarget(target, level, keeperX);
      // Anywhere the keeper must be beaten: the ring and the 0.3 m band just outside it.
      const angle = Math.random() * Math.PI * 2, radius = Math.sqrt(Math.random()) * (target.ring + .37);
      const r = app.simulateArcadeShotForTest({ level, x: origin.x, range, blockers: 0,
        targetX: target.x, targetY: target.y, ring: target.ring, bull: target.bull,
        aimError: Math.cos(angle) * radius, powerError: 0, heightOffset: Math.sin(angle) * radius });
      if (!r.beaten) continue;
      row.beaten++;
      if (r.outcome === 'goal') row.scored++;
      if (r.outcome === 'save') row.saved++;
      if (r.outcome === 'woodwork' || r.outcome === 'wide' || r.outcome === 'high') row.frame++;   // the frame, not the keeper
      if (r.ghosted) row.ghosted++;
    }
    app.endArcadeSimulationForTest();
    out.push(row);
  }
  return out;
}, shots);
console.table(rows);
if (errors.length) console.log(errors);
await browser.close();
const bad = rows.some(r => r.ghosted > 0 || r.saved > 0 || r.scored + r.frame < r.beaten);
console.log(bad ? 'PROBLEM: on-target shots were stopped or passed through the keeper' : 'On-target shots always beat the keeper, cleanly');
process.exit(bad ? 1 : 0);

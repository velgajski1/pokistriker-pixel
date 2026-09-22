// Arcade difficulty by level: conversion and precision tiers over many shots.
// Drives the production shot (setup, keeper and defender AI, swept collisions,
// goal-line verdict) through app.js's local test harness, aiming at the real
// target spot with a human-ish aim and power error.
// Usage: node tools/balance-simulation.mjs [shotsPerLevel=240]
import { writeFileSync } from 'node:fs';
import { CAPTURES, open } from './lib.mjs';

const shots = Number(process.argv[2]) || 240;
const levels = [1, 2, 3, 4, 5, 6, 8, 10, 14];
const errors = [];
const { browser, page } = await open(errors);
try {
  const table = await page.evaluate(async ({ shots, levels }) => {
    const app = await import('/js/app.js');
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    const rows = [];
    for (const level of levels) {
      const tally = { level, shots, goal: 0, bullseye: 0, target: 0, plain: 0, save: 0, blocked: 0,
        miss: 0, blockersSeen: 0, keeperSkill: 0 };
      const origin = { x: 0, y: 0, z: 0 }, target = {};
      for (let i = 0; i < shots; i++) {
        app.chooseChanceOrigin(origin, level);
        const range = origin.z - __demo.dimensions.goal.PLANE_Z;
        const keeperX = Math.max(-2.6, Math.min(2.6, origin.x * .25));
        app.chooseTarget(target, level, keeperX);
        const result = app.simulateArcadeShotForTest({ level, x: origin.x, range,
          targetX: target.x, targetY: target.y, ring: target.ring, bull: target.bull,
          aimError: gauss() * .45, powerError: gauss() * .035 });
        tally.blockersSeen += result.blockers;
        tally.keeperSkill += result.keeperSkill;
        if (result.outcome === 'goal') {
          tally.goal++;
          tally[result.tier === 'goal' ? 'plain' : result.tier]++;
        } else if (result.outcome === 'save') tally.save++;
        else if (result.outcome === 'blocked') tally.blocked++;
        else tally.miss++;
      }
      app.endArcadeSimulationForTest();
      const pct = n => Math.round(1000 * n / shots) / 10;
      rows.push({ level, conversion: pct(tally.goal), bullseye: pct(tally.bullseye), target: pct(tally.target),
        plainGoal: pct(tally.plain), saved: pct(tally.save), blocked: pct(tally.blocked), missed: pct(tally.miss),
        blockersPerShot: Math.round(100 * tally.blockersSeen / shots) / 100,
        keeperSkill: Math.round(100 * tally.keeperSkill / shots) / 100 });
    }
    return rows;
  }, { shots, levels });
  console.table(table);
  writeFileSync(`${CAPTURES}/balance.json`, JSON.stringify({ shots, table }, null, 2) + '\n');
  if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
} finally {
  await browser.close();
}

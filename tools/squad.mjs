import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const report = { errors: [], failures: [] };
let browser;
try {
  const session = await open(report.errors);
  browser = session.browser;
  const { page } = session;
  report.squad = await page.evaluate(async () => {
    const d = window.__demo;
    const e = await import('../js/gameEngine.js');
    const mesh = player => {
      let found;
      player.model.traverse(node => { if (node.isSkinnedMesh && node.material.name === 'skin') found = node; });
      return found;
    };
    const skins = d.players.map(mesh);
    const first = skins[0], second = skins[1];
    let accessoryDistance = 0;
    for (const player of d.players) {
      const head = player.model.getObjectByName('mixamorigHead');
      player.root.updateWorldMatrix(true, true);
      const origin = head.getWorldPosition(head.position.clone());
      head.traverse(node => {
        if (node.isMesh) accessoryDistance = Math.max(accessoryDistance,
          node.getWorldPosition(node.position.clone()).distanceTo(origin));
      });
    }
    e.parade(0, 5);
    e.setStrikerSwing(0);
    const keeper = d.players[0];
    const hand = keeper.model.getObjectByName('mixamorigLeftHand');
    const point = hand.position.clone();
    const heights = [];
    let error = 0;
    for (const side of [-1, 1]) {
      for (const high of [0, 1]) {
        e.setKeeper(keeper.root.position.x, 1, side, high, .5, 0);
        const caps = e.getKeeperCapsules();
        hand.getWorldPosition(point);
        const end = caps[2].b;
        error = Math.max(error, Math.hypot(point.x - end.x, point.y - end.y, point.z - end.z));
        heights.push(point.y);
      }
    }
    e.setKeeper(keeper.root.position.x, 0, 1, 0, 0, 0);
    const actions = d.striker.mixer._actions;
    const run = actions.find(a => a.getClip().name === 'run');
    for (const action of actions) action.setEffectiveWeight(action === run ? 1 : 0);
    let toeMin = Infinity, toeMax = -Infinity;
    for (let i = 0; i < 100; i++) {
      run.time = i / 100 * run.getClip().duration;
      d.striker.mixer.update(0);
      d.striker.bone('toe_L').getWorldPosition(point);
      toeMin = Math.min(toeMin, point.y);
      toeMax = Math.max(toeMax, point.y);
    }
    for (const action of actions) action.setEffectiveWeight(action.getClip().name === 'idle' ? 1 : 0);
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('dim').style.display = 'none';
    return { count: d.players.length, skinned: skins.filter(Boolean).length,
      sharedGeometry: first.geometry === second.geometry,
      independentSkeletons: first.skeleton.bones[0] !== second.skeleton.bones[0],
      independentMaterials: first.material !== second.material,
      skinColours: skins.map(m => m.material.color.getHexString()),
      capsuleError: error, diveHandHeights: heights, runToeRange: [toeMin, toeMax], accessoryDistance };
  });
  const s = report.squad;
  assert(s.count === 23 && s.skinned === 23, 'Both full teams and referee must use the Captain');
  assert(s.sharedGeometry && s.independentSkeletons && s.independentMaterials, 'Invalid clone ownership');
  assert(new Set(s.skinColours).size >= 4, 'Skin colour variety missing');
  assert(s.capsuleError < 1e-6, 'Keeper collision does not follow the hand');
  assert(s.accessoryDistance < .4, 'Hair accessory detached from head');
  assert(s.diveHandHeights.every(Number.isFinite), 'Invalid dive pose');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${CAPTURES}/squad-lineup.png` });
  await page.evaluate(async () => {
    const e = await import('../js/gameEngine.js');
    e.setKeeper(window.__demo.players[0].root.position.x, 1, 1, 1, .5, 0);
  });
  await page.screenshot({ path: `${CAPTURES}/squad-dive.png` });
} catch (error) {
  report.failures.push(String(error));
} finally {
  if (browser) await browser.close();
  if (report.errors.length) report.failures.push('Browser errors occurred');
  writeFileSync(`${CAPTURES}/squad.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failures.length ? 1 : 0;
}

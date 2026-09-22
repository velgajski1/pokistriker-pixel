import { writeFileSync } from 'node:fs';
import { open, assert, CAPTURES } from './lib.mjs';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
};
const shotsPerCell = Math.max(10, argument('shots', 40));
const careers = Math.max(50, argument('careers', 1000));
const maxSeasons = Math.max(1, argument('max-seasons', 6));
const seed = argument('seed', 20260922) >>> 0;
const profiles = {
  beginner: { reaction: .11, power: .13, regular: ['target', 'poacher', 'icebath', 'legday'],
    meta: ['pet', 'subnet', 'star', 'veins', 'talent', 'boot'], charmAt: 35 },
  average: { reaction: .065, power: .075, regular: ['poacher', 'target', 'legday', 'icebath'],
    meta: ['star', 'talent', 'veins', 'pet', 'boot', 'subnet'], charmAt: 25 },
  skilled: { reaction: .035, power: .04, regular: ['legday', 'target', 'icebath', 'poacher'],
    meta: ['talent', 'veins', 'star', 'boot', 'pet', 'subnet'], charmAt: 15 },
};
const checkpoints = [1, 4, 8, 12, 16];

const errors = [];
const { browser, page } = await open(errors);
let calibration, rules;
try {
  await page.keyboard.press('Alt+4');
  await page.waitForFunction(() => __demo.state.run && __demo.state.phase === 'AIM');
  ({ calibration, rules } = await page.evaluate(async ({ profiles, checkpoints, shotsPerCell, seed }) => {
    const app = await import('/js/app.js');
    const engine = await import('/js/gameEngine.js');
    engine.renderer.setAnimationLoop(null);
    let randomState = seed >>> 0;
    const random = () => {
      randomState |= 0; randomState = randomState + 0x6D2B79F5 | 0;
      let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    let spare = null;
    const normal = () => {
      if (spare !== null) { const value = spare; spare = null; return value; }
      const radius = Math.sqrt(-2 * Math.log(Math.max(1e-9, random())));
      const angle = Math.PI * 2 * random();
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    };
    const originalRandom = Math.random;
    Math.random = random;
    const rows = [];
    try {
      for (const [profile, input] of Object.entries(profiles)) {
        for (const match of checkpoints) for (let stage = 0; stage <= 5; stage++) {
          const outcomes = { goal: 0, save: 0, blocked: 0, woodwork: 0, high: 0, wide: 0, unresolved: 0 };
          let onTarget = 0;
          for (let sample = 0; sample < shotsPerCell; sample++) {
            const chance = { x: 0, y: 0, z: 0 };
            app.chooseChanceOrigin(chance, random);
            const range = chance.z + 20;
            const blockers = range > 15 ? (random() < .55 ? 2 : 1) : range > 12 ? 1 : random() < .5 ? 1 : 0;
            const target = (chance.x >= 0 ? -1 : 1) * 3.05;
            const distanceMultiplier = Math.min(2.5, 1 + Math.max(0, range - 10) * .05);
            const sweep = 12 * (1 - .12 * stage) * (1 - .05 * stage) * distanceMultiplier;
            const result = app.simulateBalanceShotForTest({ match, goals: sample % 3,
              x: chance.x, range, blockers, targetX: target, targetY: 1.35,
              aimError: normal() * input.reaction * sweep, powerError: normal() * input.power,
              keeperDepth: match <= 3 && sample % 3 === 0 ? [2.75, 2.25, 1.75][match - 1] : .75,
              training: { poacher: stage, target: stage, legday: stage, icebath: stage },
              meta: { star: stage, subnet: stage, talent: stage, veins: stage, pet: stage, boot: stage },
            });
            outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
            if (result.predicted.onTarget) onTarget++;
          }
          rows.push({ profile, match, stage, shots: shotsPerCell, onTarget,
            goals: outcomes.goal, conversion: outcomes.goal / shotsPerCell,
            onTargetRate: onTarget / shotsPerCell, outcomes });
        }
      }
    } finally {
      app.endBalanceSimulationForTest();
      Math.random = originalRandom;
    }
    return { calibration: rows, rules: app.balanceRulesForTest() };
  }, { profiles: Object.fromEntries(Object.entries(profiles).map(([name, p]) =>
    [name, { reaction: p.reaction, power: p.power }])), checkpoints, shotsPerCell, seed }));
} finally {
  await browser.close();
}

assert(!errors.length, errors.join('\n'));
assert(rules.defenseRatings[0] === 25 && rules.defenseRatings.at(-1) === 90,
  'Defense curve must run from 25 to 90');
const unresolved = calibration.reduce((sum, row) => sum + (row.outcomes.unresolved || 0), 0);
assert(unresolved === 0, `${unresolved} sampled shots never resolved`);

const makeRandom = initial => {
  let value = initial >>> 0;
  return () => {
    value |= 0; value = value + 0x6D2B79F5 | 0;
    let result = Math.imul(value ^ value >>> 15, 1 | value);
    result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result;
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
};
const cell = new Map(calibration.map(row => [`${row.profile}:${row.match}:${row.stage}`, row.conversion]));
const interpolate = (profile, match, training, meta) => {
  const stage = (training.target + training.legday + training.icebath + meta.talent + meta.veins) / 5;
  const lowStage = Math.floor(stage), highStage = Math.min(5, Math.ceil(stage));
  let lowerMatch = checkpoints[0], upperMatch = checkpoints.at(-1);
  for (const point of checkpoints) {
    if (point <= match) lowerMatch = point;
    if (point >= match) { upperMatch = point; break; }
  }
  const at = (m, s) => cell.get(`${profile}:${m}:${s}`);
  const stageRate = m => {
    const blend = stage - lowStage;
    return at(m, lowStage) + (at(m, highStage) - at(m, lowStage)) * blend;
  };
  const blend = upperMatch === lowerMatch ? 0 : (match - lowerMatch) / (upperMatch - lowerMatch);
  return Math.max(0, Math.min(1, stageRate(lowerMatch) + (stageRate(upperMatch) - stageRate(lowerMatch)) * blend));
};
const emptyLevels = keys => Object.fromEntries(keys.map(key => [key, 0]));
const buyRegular = (run, priority) => {
  let purchases = 0;
  for (let guard = 0; guard < 30; guard++) {
    const key = priority.find(name => run.training[name] < 5
      && run.cash >= rules.trainingCosts[run.training[name]]);
    if (!key) break;
    run.cash -= rules.trainingCosts[run.training[key]];
    run.training[key]++;
    purchases++;
  }
  return purchases;
};
const buyMeta = (career, priority) => {
  let purchases = 0;
  for (let guard = 0; guard < 40; guard++) {
    const key = priority.find(name => career.meta[name] < 5
      && career.legacy >= rules.metaCosts[name][career.meta[name]]);
    if (!key) break;
    career.legacy -= rules.metaCosts[key][career.meta[key]];
    career.meta[key]++;
    purchases++;
  }
  return purchases;
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function simulateSeason(profileName, career, random) {
  const policy = profiles[profileName];
  const run = { confidence: rules.morale.START, cash: 0, charmUses: 0,
    training: emptyLevels(['poacher', 'target', 'legday', 'icebath']) };
  let fairCredit = rules.fairChance.START_CREDIT;
  let enemyCredit = .5, teammateCredit = random();
  let totalGoals = 0, totalChances = 0, regularPurchases = 0, charms = 0;
  const reached = [];
  for (let match = 1; match <= rules.seasonMatches; match++) {
    reached.push(match);
    let playerGoals = 0, teammateGoals = 0, enemyGoals = 0;
    const schedule = [];
    for (let i = 0; i < rules.fairChance.GUARANTEED_PER_MATCH; i++) {
      const slot = 14 + (66 / rules.fairChance.GUARANTEED_PER_MATCH) * i
        + random() * (50 / rules.fairChance.GUARANTEED_PER_MATCH);
      schedule.push(Math.min(88, Math.round(slot)));
    }
    let openingKeeperUsed = false;
    for (let minute = 1; minute <= 90; minute++) {
      if (minute % rules.morale.MINUTES_PER_LOSS === 0) run.confidence = Math.max(0, run.confidence - 1);
      enemyCredit += .01 * Math.max(1, playerGoals + teammateGoals - enemyGoals);
      teammateCredit += .005;
      while (enemyCredit >= 1 || teammateCredit >= 1) {
        if (enemyCredit >= 1) { enemyCredit--; enemyGoals++; }
        else { teammateCredit--; teammateGoals++; }
      }
      const chanceRate = rules.fairChance.BASE_PER_MINUTE
        + rules.fairChance.PER_LEVEL_PER_MINUTE * (run.training.poacher + career.meta.star
          + (run.confidence < rules.morale.SUPER_SUB_AT ? career.meta.subnet : 0));
      fairCredit += chanceRate;
      if (minute <= rules.fairChance.LATEST_GRANT_MINUTE && fairCredit >= 1) {
        fairCredit--;
        let at = Math.min(88, Math.ceil(minute + 9));
        while (schedule.includes(at) && at < 88) at++;
        schedule.push(at);
      }
      let index;
      while ((index = schedule.indexOf(minute)) >= 0) {
        schedule.splice(index, 1);
        totalChances++;
        let chanceRate = interpolate(profileName, match, run.training, career.meta);
        if (!openingKeeperUsed && match <= 3) {
          // Opening-keeper samples comprise one third of the calibration cell;
          // compensate for a single easier first chance without treating every shot as open-net.
          chanceRate = Math.min(1, chanceRate * 1.08);
          openingKeeperUsed = true;
        }
        if (random() < chanceRate) {
          playerGoals++; totalGoals++;
          run.cash += rules.economy.GOAL_PAYOUT + rules.economy.BOOT_BONUS * career.meta.boot;
          const maximum = rules.morale.BASE_MAX * (1 + .05 * career.meta.pet);
          run.confidence = clamp(run.confidence + rules.morale.ON_GOAL, 0, maximum);
        } else run.confidence = Math.max(0, run.confidence + rules.morale.ON_MISSED_CHANCE);
      }
    }
    const won = playerGoals + teammateGoals > enemyGoals;
    const lost = playerGoals + teammateGoals < enemyGoals;
    run.confidence = clamp(run.confidence + (won ? 5 : lost ? -5 : 0), 0,
      rules.morale.BASE_MAX * (1 + .05 * career.meta.pet));
    run.cash += rules.economy.MATCH_SALARY + (won ? rules.economy.WIN_BONUS : 0);
    if (run.confidence <= 0) return { won: false, endMatch: match, totalGoals, totalChances,
      regularPurchases, charms, reached };
    if (match === rules.seasonMatches) return { won: true, endMatch: match, totalGoals, totalChances,
      regularPurchases, charms, reached };
    const charmCost = rules.economy.CHARM_BASE_COST * (run.charmUses + 1);
    if (run.confidence <= policy.charmAt && run.cash >= charmCost) {
      run.cash -= charmCost; run.charmUses++; charms++;
      run.confidence = Math.min(rules.morale.BASE_MAX * (1 + .05 * career.meta.pet),
        run.confidence + rules.economy.CHARM_RESTORE);
    }
    regularPurchases += buyRegular(run, policy.regular);
  }
}

const cohorts = [];
for (const [profileName, policy] of Object.entries(profiles)) {
  const random = makeRandom(seed ^ (profileName.charCodeAt(0) * 0x9E3779B9));
  const records = [];
  for (let trial = 0; trial < careers; trial++) {
    const career = { legacy: 0, meta: emptyLevels(['star', 'subnet', 'talent', 'veins', 'pet', 'boot']) };
    let metaPurchases = 0, result;
    const seasons = [];
    for (let season = 1; season <= maxSeasons; season++) {
      result = simulateSeason(profileName, career, random);
      seasons.push(result);
      if (result.won) break;
      career.legacy += result.totalGoals * rules.economy.LEGACY_PER_GOAL;
      metaPurchases += buyMeta(career, policy.meta);
    }
    records.push({ won: result.won, seasons: seasons.length, first: seasons[0], last: result,
      metaPurchases, meta: career.meta });
  }
  const wins = records.filter(record => record.won);
  const reach = match => records.filter(record => record.first.reached.includes(match)).length / records.length;
  cohorts.push({ profile: profileName, careers, completionRate: wins.length / careers,
    firstSeasonWinRate: records.filter(record => record.first.won).length / careers,
    meanSeasonsToWin: wins.length ? wins.reduce((sum, record) => sum + record.seasons, 0) / wins.length : null,
    firstSeasonReach: { match4: reach(4), match8: reach(8), match12: reach(12), match16: reach(16) },
    meanFirstSeasonGoals: records.reduce((sum, record) => sum + record.first.totalGoals, 0) / careers,
    meanFirstSeasonChances: records.reduce((sum, record) => sum + record.first.totalChances, 0) / careers,
    meanRegularPurchases: records.reduce((sum, record) => sum + record.first.regularPurchases, 0) / careers,
    meanMetaPurchases: records.reduce((sum, record) => sum + record.metaPurchases, 0) / careers });
}

const baseConversion = Object.fromEntries(Object.keys(profiles).map(profile => [profile,
  checkpoints.map(match => ({ match, conversion: cell.get(`${profile}:${match}:0`) }))]));
const warnings = [];
const cohort = name => cohorts.find(item => item.profile === name);
if (!(cohort('beginner').completionRate <= cohort('average').completionRate
  && cohort('average').completionRate <= cohort('skilled').completionRate)) {
  warnings.push('Completion rates are not ordered beginner <= average <= skilled. Increase shots per cell before tuning.');
}
if (cohort('average').firstSeasonWinRate < .05) warnings.push('Average first-season completion is below 5%.');
if (cohort('average').firstSeasonWinRate > .45) warnings.push('Average first-season completion exceeds 45%.');
if (cohort('average').firstSeasonReach.match8 < .25) warnings.push('Fewer than 25% of average players reach match 8 in season one.');
if (cohort('skilled').completionRate < .5) warnings.push(`Fewer than 50% of skilled careers win within ${maxSeasons} seasons.`);

const report = { seed, shotsPerCell, careersPerProfile: careers, maxSeasons, rules,
  inputProfiles: Object.fromEntries(Object.entries(profiles).map(([name, value]) => [name,
    { reactionErrorSeconds: value.reaction, powerError: value.power,
      regularPriority: value.regular, metaPriority: value.meta, charmAt: value.charmAt }])),
  baseConversion, calibration, cohorts,
  assessment: { status: warnings.length ? 'REVIEW' : 'WITHIN INITIAL TARGETS',
    targetAssumptions: { averageFirstSeasonWin: '5%–45%', averageReachMatch8: '>=25%',
      skilledWinWithinMaxSeasons: '>=50%', orderedByInputSkill: true }, warnings }, errors };
writeFileSync(`${CAPTURES}/balance-simulation.json`, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Balance simulation (${shotsPerCell} real shots/cell; ${careers} careers/profile; seed ${seed})`);
console.table(cohorts.map(item => ({ profile: item.profile,
  firstSeasonWin: `${(item.firstSeasonWinRate * 100).toFixed(1)}%`,
  winByMaxSeason: `${(item.completionRate * 100).toFixed(1)}%`,
  meanSeasonsToWin: item.meanSeasonsToWin?.toFixed(2) ?? '—',
  reachMatch8: `${(item.firstSeasonReach.match8 * 100).toFixed(1)}%`,
  goalsSeason1: item.meanFirstSeasonGoals.toFixed(1),
  upgradesSeason1: item.meanRegularPurchases.toFixed(1),
  metaPurchases: item.meanMetaPurchases.toFixed(1),
})));
console.log(`Assessment: ${report.assessment.status}`);
for (const warning of warnings) console.log(`- ${warning}`);
console.log(`Full report: ${CAPTURES}/balance-simulation.json`);

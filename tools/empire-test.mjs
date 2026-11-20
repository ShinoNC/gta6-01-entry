// Empire (businesses + stats + achievements) tests for SOLARIS KEYS.
// Run: node tools/empire-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
// Dismiss the mission-1 briefing so it does not block the screen.
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 1. Business system exists: 3 beacons, 3 minimap blips ---
check(
  '3 business beacons visible',
  await page.evaluate(() => window.__game.businesses.beacons.every((b) => b.group.visible)),
);
check(
  '3 business minimap blips',
  await page.evaluate(() => window.__game.businesses.blips().length === 3 && window.__game.businesses.blips().every((b) => !b.owned)),
);

// --- 2. Empire screen opens with B, shows 3 businesses + stats + achievements ---
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
check(
  'B opens the empire screen',
  await page.evaluate(() => !document.getElementById('empire-screen').classList.contains('hidden')),
);
check(
  'empire screen lists 3 businesses',
  await page.evaluate(() => {
    const text = document.getElementById('empire-list').textContent;
    return text.includes('KEYS CAB CO.') && text.includes('NEON PALMS') && text.includes('SOLSTICE MOTORS');
  }),
);
check(
  'empire screen shows stats + achievements sections',
  await page.evaluate(() => {
    const text = document.getElementById('empire-list').textContent;
    return text.includes('CAREER STATS') && text.includes('ACHIEVEMENTS') && text.includes('FIRST WHEELS') && text.includes('CARS STOLEN');
  }),
);
check(
  'only taxi buyable at start (REP 1, $1,250)',
  await page.evaluate(() => document.querySelectorAll('.empire-buy').length === 0),
  'start money $1,250 < taxi $2,000, so no buy button yet',
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
check(
  'B closes the empire screen',
  await page.evaluate(() => document.getElementById('empire-screen').classList.contains('hidden')),
);

// --- 3. REP gate + money gate (unit checks through the real object) ---
check(
  'nightclub blocked at REP 1',
  await page.evaluate(() => window.__game.businesses.canBuy(1, 99999, 1) === 'rep'),
);
check(
  'nightclub buyable at REP 3 with money',
  await page.evaluate(() => window.__game.businesses.canBuy(1, 99999, 3) === 'ok'),
);
check(
  'dealership blocked at REP 3',
  await page.evaluate(() => window.__game.businesses.canBuy(2, 99999, 3) === 'rep'),
);
check(
  'taxi blocked without money',
  await page.evaluate(() => window.__game.businesses.canBuy(0, 100, 1) === 'money'),
);

// --- 4. Buy the taxi through the screen ---
await page.evaluate(() => window.__game.setMoney(5000));
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
check(
  'taxi buy button appears with $5,000',
  await page.evaluate(() => document.querySelectorAll('.empire-buy').length === 1),
);
await page.click('.empire-buy');
await page.waitForTimeout(400);
check(
  'taxi bought: owned, money $5,000 -> $3,000',
  await page.evaluate(() => window.__game.businesses.state[0].owned === true && window.__game.money === 3000),
  await page.evaluate(() => `owned=${window.__game.businesses.state[0].owned} money=$${window.__game.money}`),
);
check(
  'taxi beacon turns green when owned',
  await page.evaluate(() => window.__game.businesses.beacons[0].pillar.material.color.getHex() === 0x7affc4),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 5. Income accrues, capped at 3 days ---
await page.evaluate(() => window.__game.businesses.update(2880));
check(
  '1 game day of taxi income = $1,200 pending',
  await page.evaluate(() => Math.floor(window.__game.businesses.state[0].pending) === 1200),
  await page.evaluate(() => `pending=$${Math.floor(window.__game.businesses.state[0].pending)}`),
);
await page.evaluate(() => {
  window.__game.businesses.state[0].pending = 3599;
  window.__game.businesses.update(2880);
});
check(
  'pending capped at 3 days ($3,600)',
  await page.evaluate(() => Math.floor(window.__game.businesses.state[0].pending) === 3600),
);

// --- 6. Collect by driving to the business + E ---
await page.evaluate(() => {
  window.__game.businesses.state[0].pending = 1200;
  window.__game.player.group.position.set(52, 0, 52);
});
await page.waitForTimeout(1500);
// The prompt cycles on a 0.6s timer with a 1-frame gap, so poll.
let collectSeen = false;
for (let i = 0; i < 10 && !collectSeen; i += 1) {
  collectSeen = await page.evaluate(() => document.getElementById('hud-message').textContent.includes('collect $1,200'));
  if (!collectSeen) await page.waitForTimeout(200);
}
check(
  'collect prompt shows near the taxi office',
  collectSeen,
  await page.evaluate(() => document.getElementById('hud-message').textContent),
);
const moneyBeforeCollect = await page.evaluate(() => window.__game.money);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
check(
  'E collects $1,200, pending resets',
  await page.evaluate((before) => window.__game.money === before + 1200 && window.__game.businesses.state[0].pending < 1, moneyBeforeCollect),
  await page.evaluate(() => `money=$${window.__game.money} pending=$${window.__game.businesses.state[0].pending}`),
);

// --- 7. Upgrade raises income ---
check(
  'taxi base income $1,200/day',
  await page.evaluate(() => window.__game.businesses.incomePerDay(0) === 1200),
);
await page.evaluate(() => window.__game.setMoney(5000));
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
await page.click('.empire-upgrade');
await page.waitForTimeout(400);
check(
  'upgrade: level 1, income $1,800/day, money $5,000 -> $4,000',
  await page.evaluate(() => window.__game.businesses.state[0].level === 1 && window.__game.businesses.incomePerDay(0) === 1800 && window.__game.money === 4000),
  await page.evaluate(() => `level=${window.__game.businesses.state[0].level} income=$${window.__game.businesses.incomePerDay(0)}/day money=$${window.__game.money}`),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 8. Stats: stealing a car counts + FIRST WHEELS achievement ---
await page.evaluate(() => {
  const car = window.__game.cars[3];
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check(
  'stealing counts: carsStolen 1, FIRST WHEELS unlocked (+$100)',
  await page.evaluate(() => window.__game.stats.carsStolen === 1 && window.__game.achievements.includes('firstWheels')),
  await page.evaluate(() => `carsStolen=${window.__game.stats.carsStolen} achievements=${window.__game.achievements.join(',')}`),
);

// --- 9. CAR THIEF at 10 steals ---
await page.keyboard.press('KeyF'); // exit the car from test 8
await page.waitForTimeout(300);
await page.evaluate(() => {
  window.__game.stats.carsStolen = 9;
  const car = window.__game.cars[4];
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check(
  'CAR THIEF unlocks at 10 steals (+$500)',
  await page.evaluate(() => window.__game.stats.carsStolen === 10 && window.__game.achievements.includes('carThief')),
);

// --- 10. ROAD KING via driven distance ---
await page.evaluate(() => {
  window.__game.stats.kmDriven = 100;
  window.__game.awardAchievements();
});
check(
  'ROAD KING unlocks at 100 km',
  await page.evaluate(() => window.__game.achievements.includes('roadKing')),
);

// --- 11. moneyEarned tracks all income ---
check(
  'moneyEarned > 0 after mission-less income (collect + achievements + steal)',
  await page.evaluate(() => window.__game.stats.moneyEarned >= 1200 + 100 + 500),
  await page.evaluate(() => `moneyEarned=$${Math.floor(window.__game.stats.moneyEarned)}`),
);

// --- 12. Save/load round-trip preserves empire state ---
await page.evaluate(() => {
  window.__game.save.saveGame(2, window.__game.snapshotSave());
  window.__game.businesses.reset();
  window.__game.stats.carsStolen = 0;
  const loaded = window.__game.save.loadGame(2);
  window.__game.applySave(loaded);
});
check(
  'save/load restores taxi owned + level + stats + achievements',
  await page.evaluate(() => {
    const b = window.__game.businesses.state[0];
    return b.owned === true && b.level === 1 && window.__game.stats.carsStolen === 10 && window.__game.achievements.includes('carThief');
  }),
  await page.evaluate(() => `owned=${window.__game.businesses.state[0].owned} level=${window.__game.businesses.state[0].level} carsStolen=${window.__game.stats.carsStolen}`),
);

// --- 13. Post-story endless content: side jobs + tapes still run ---
await page.evaluate(() => window.__game.missions.setCompleted(8));
await page.waitForTimeout(300);
check(
  'story complete shows STORY COMPLETE',
  await page.evaluate(() => window.__game.missions.progressLine() === 'STORY COMPLETE'),
);
await page.evaluate(() => window.__game.sideJobs.forceJob('delivery'));
await page.waitForTimeout(500);
check(
  'side job still offered after story ends',
  await page.evaluate(() => window.__game.sideJobs.job !== null && window.__game.sideJobs.job.type === 'delivery'),
);
// Tape pickup follows the focus (the car if driving); §12's load restores
// the driven car now, so exit first and walk to the tape on foot.
if (await page.evaluate(() => !!window.__game.drivenCar)) {
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(500);
}
await page.evaluate(() => {
  const tape = window.__game.tapes.tapes.find((t) => !t.taken);
  window.__game.player.group.position.set(tape.x, 0, tape.z);
});
await page.waitForTimeout(1500);
check(
  'tapes still collectable after story ends',
  await page.evaluate(() => window.__game.tapes.collected >= 1),
  await page.evaluate(() => `collected=${window.__game.tapes.collected}`),
);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);

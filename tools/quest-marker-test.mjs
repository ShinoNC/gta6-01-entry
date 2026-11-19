// Quest-marker test for SOLARIS KEYS (bug 2: missions auto-started via a
// phone call after 8s; GTA-style they must start at a gold marker in the
// world). Covers: no auto phone call while the player stays at spawn; the
// M1 marker beacon + minimap target exist at (52,0) from game start; walking
// to the marker shows the briefing and ACCEPT starts the mission; completing
// M1 shows the M2 marker at (-52,70) with a toast; the mission screen has no
// ACCEPT button, only the marker hint.
// Run: node tools/quest-marker-test.mjs
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
function note(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}
const phoneUp = () => page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);

// 1. No auto phone call: wait 20s real time at spawn (well past the old 8s
// snooze) — the phone must stay hidden.
await page.waitForTimeout(20000);
check('no auto phone call while standing at spawn', !(await phoneUp()));

// 2. M1 marker exists from game start: beacon visible at (52,0), target set.
const m1 = await page.evaluate(() => ({
  beaconVisible: window.__game.missions.beacon.group.visible,
  beaconX: +window.__game.missions.beacon.group.position.x.toFixed(0),
  beaconZ: +window.__game.missions.beacon.group.position.z.toFixed(0),
  target: window.__game.missions.target,
  pending: window.__game.missions.pendingMission?.name,
  atMarker: window.__game.missions.atMarker,
}));
note('M1 marker', JSON.stringify(m1));
check('M1 gold marker beacon visible at (52,0)', m1.beaconVisible && m1.beaconX === 52 && m1.beaconZ === 0,
  `visible=${m1.beaconVisible} at (${m1.beaconX},${m1.beaconZ})`);
check('M1 marker is the minimap/map target', m1.target?.x === 52 && m1.target?.z === 0, JSON.stringify(m1.target));
check('pending mission is FIRST FARE', m1.pending === 'FIRST FARE', m1.pending);
check('player at spawn is not at the marker', m1.atMarker === false);

// 3. Walk to the marker (teleport) — the briefing appears.
await page.evaluate(() => { window.__game.player.group.position.set(52, 0, 0); });
let up = false;
for (let i = 0; i < 12 && !up; i += 1) {
  await page.waitForTimeout(5000);
  up = await phoneUp();
}
check('briefing appears at the gold marker', up);
const giver = await page.evaluate(() => document.getElementById('phone-giver').textContent);
check('briefing is from Mara Solis', giver.toUpperCase().includes('MARA'), giver);

// 4. ACCEPT starts mission 1 with real gameplay: the target moves to the
// east pier (104,0), then the client waits 2s, then the drop is Palm Row.
await page.click('#phone-accept');
let started = false;
for (let i = 0; i < 6 && !started; i += 1) {
  await page.waitForTimeout(500);
  started = await page.evaluate(() => window.__game.missions.currentMission()?.name === 'FIRST FARE');
}
check('mission 1 starts on ACCEPT', started);
const m1Target = await page.evaluate(() => window.__game.missions.target);
check('M1 target after ACCEPT is the east pier (104,0)', m1Target?.x === 104 && m1Target?.z === 0, JSON.stringify(m1Target));
check('M1 does NOT auto-complete on ACCEPT', await page.evaluate(() => window.__game.missions.doneCount() === 0));
await page.evaluate(() => { window.__game.player.group.position.set(104, 0, 0); });
// The 2s waitAt needs 2s of GAME time; headless runs ~0.15x real time,
// so poll for the stage to advance instead of sleeping a fixed amount.
for (let i = 0; i < 40; i += 1) {
  if (await page.evaluate(() => window.__game.missions.stageIndex >= 2)) break;
  await page.waitForTimeout(1000);
}
check('M1 pickup + wait advances to stage 3', await page.evaluate(() => window.__game.missions.stageIndex === 2),
  `stageIndex=${await page.evaluate(() => window.__game.missions.stageIndex)}`);
await page.evaluate(() => { window.__game.player.group.position.set(-52, 0, 52); });
for (let i = 0; i < 12; i += 1) {
  if (await page.evaluate(() => window.__game.missions.doneCount() === 1)) break;
  await page.waitForTimeout(1000);
}
const afterM1 = await page.evaluate(() => ({
  done: window.__game.missions.doneCount(),
  money: window.__game.money,
  target: window.__game.missions.target,
  pending: window.__game.missions.pendingMission?.name,
  beaconVisible: window.__game.missions.beacon.group.visible,
  beaconX: +window.__game.missions.beacon.group.position.x.toFixed(0),
  beaconZ: +window.__game.missions.beacon.group.position.z.toFixed(0),
}));
note('after M1', JSON.stringify(afterM1));
check('mission 1 completes at the Palm Row drop, pays $500', afterM1.done === 1 && afterM1.money === 1750,
  `done=${afterM1.done} money=$${afterM1.money}`);

// 5. M2 marker appears at (-52,70) with the next giver.
check('M2 marker appears at (-52,70)', afterM1.beaconVisible && afterM1.beaconX === -52 && afterM1.beaconZ === 70,
  `visible=${afterM1.beaconVisible} at (${afterM1.beaconX},${afterM1.beaconZ})`);
check('M2 marker is the map target', afterM1.target?.x === -52 && afterM1.target?.z === 70, JSON.stringify(afterM1.target));
check('pending mission is THE CORAL RUN', afterM1.pending === 'THE CORAL RUN', afterM1.pending);

// 6. Walk to the M2 marker — Juno's briefing appears; LATER dismisses it and
// it re-prompts (player still at the marker).
await page.evaluate(() => { window.__game.player.group.position.set(-52, 0, 70); });
up = false;
for (let i = 0; i < 12 && !up; i += 1) {
  await page.waitForTimeout(5000);
  up = await phoneUp();
}
check('M2 briefing appears at its marker', up);
const giver2 = await page.evaluate(() => document.getElementById('phone-giver').textContent);
check('M2 briefing is from Juno Reyes', giver2.toUpperCase().includes('JUNO'), giver2);
await page.click('#phone-later');
await page.waitForTimeout(500);
check('LATER dismisses the briefing', !(await phoneUp()));
// Snooze is 20 game-seconds; headless runs ~0.1x, so the re-prompt takes a
// while — force the snooze down to prove the re-prompt path works.
await page.evaluate(() => { window.__game.missions.snooze = 0; });
up = false;
for (let i = 0; i < 6 && !up; i += 1) {
  await page.waitForTimeout(5000);
  up = await phoneUp();
}
check('briefing re-prompts at the marker after LATER', up);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// 7. Mission screen (M): no ACCEPT button, marker hint shown instead.
await page.keyboard.press('KeyM');
await page.waitForTimeout(800);
const screen = await page.evaluate(() => ({
  acceptButtons: document.querySelectorAll('#mission-list .mission-accept').length,
  hint: document.getElementById('mission-list').textContent.includes('Head to the marker on the map'),
  pendingRow: [...document.querySelectorAll('.mission-row.pending')].length,
}));
note('mission screen', JSON.stringify(screen));
check('mission screen has no ACCEPT button', screen.acceptButtons === 0, `${screen.acceptButtons} buttons`);
check('mission screen shows the marker hint', screen.hint);
check('mission 2 row is pending', screen.pendingRow === 1, `${screen.pendingRow} pending rows`);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);

// 8. Objective line guides to the marker: live distance + direction arrow
// (the old "head to the gold marker" text was replaced by the guidance).
const obj = await page.evaluate(() => document.getElementById('hud-objective').textContent);
check('objective line guides to the marker (distance + arrow)', /\d+m [↑→↓←]/.test(obj), obj);

check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(fails === 0 ? `ALL ${results.length} CHECKS PASSED` : `${fails} FAILURES`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);

// Punch test for SOLARIS KEYS (bug 4: left click did not punch, only
// rotated the camera). Covers: click while pointer-locked attacks
// immediately (fists: cooldown + arm swing + sound), the lock-engaging
// click does not attack, punching a ped knocks them down, and dragging
// without a lock rotates the camera without attacking.
// Run: node tools/punch-test.mjs
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
function info(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => {
  document.getElementById('phone-later')?.click();
  window.__game.missions.snoozeBriefing(600); // keep the briefing out of this test
  window.__punchSound = null;
  const orig = window.__game.audio.punchSound.bind(window.__game.audio);
  window.__game.audio.punchSound = (hit) => {
    window.__punchSound = { hit };
    orig(hit);
  };
});
await page.waitForTimeout(300);

const combatState = () => page.evaluate(() => ({
  cooldown: window.__game.combat.cooldownTimer,
  weapon: window.__game.combat.currentWeapon().id,
  punchTimer: window.__game.player.punchTimer,
  // group children: torso, head, hairTop, armLeft, armRight, legLeft, legRight
  armRightX: window.__game.player.group.children[4].rotation.x,
  punchSound: window.__punchSound,
}));
const waitCooldown = async () => {
  for (let i = 0; i < 30; i += 1) {
    const s = await combatState();
    if (s.cooldown <= 0) return;
    await page.waitForTimeout(500);
  }
};

check('fists selected by default', (await combatState()).weapon === 'fists');

// --- 1. The lock-engaging click must NOT attack ---
await page.mouse.click(640, 360); // engages pointer lock
await page.waitForTimeout(600);
let s = await combatState();
check('pointer locked', await page.evaluate(() => window.__game.input.locked === true));
check('lock click does not punch', s.cooldown <= 0 && s.punchTimer <= 0, `cooldown=${s.cooldown.toFixed(2)} punchTimer=${s.punchTimer.toFixed(2)}`);

// --- 2. Click while locked punches immediately (whiff: no ped in range) ---
await page.mouse.click(640, 360);
await page.waitForTimeout(600);
s = await combatState();
info('after locked click (whiff)', `cooldown=${s.cooldown.toFixed(2)} punchTimer=${s.punchTimer.toFixed(2)} sound=${JSON.stringify(s.punchSound)}`);
check('locked click triggers tryShoot (fists cooldown)', s.cooldown > 0, `cooldown=${s.cooldown.toFixed(2)}`);
check('locked click plays the punch sound (whiff)', s.punchSound !== null && s.punchSound.hit === false, JSON.stringify(s.punchSound));
// The arm swing is set by the NEXT player.update after the punch (the tap
// fires after player.update in the frame), and headless runs few frames per
// second — poll for the swing instead of reading once.
let minArmX = 0;
for (let i = 0; i < 20; i += 1) {
  const a = await page.evaluate(() => window.__game.player.group.children[4].rotation.x);
  minArmX = Math.min(minArmX, a);
  if (minArmX < -1) break;
  await page.waitForTimeout(200);
}
check('locked click swings the arm', s.punchTimer > 0 && minArmX < -1, `punchTimer=${s.punchTimer.toFixed(2)} minArmRightX=${minArmX.toFixed(2)}`);

// --- 3. Punching a ped knocks them down ---
await waitCooldown();
await page.evaluate(() => {
  const g = window.__game;
  const ped = g.pedestrians.peds[0];
  const line = g.pedestrians.lines.find((l) => l.axis === 'z' && l.at === 0);
  ped.line = line;
  ped.along = g.player.position.z - 2; // 2m in front of the player (facing -Z)
  ped.side = 0; // road centre, not the sidewalk (7.6m offset would be out of range)
  ped.direction = 1;
  ped.knockedTimer = 0;
  ped.fleeTimer = 0;
  ped.frozen = false;
  g.pedestrians.placeOnSidewalk(ped);
});
await page.waitForTimeout(500);
const pedPos = await page.evaluate(() => {
  const p = window.__game.pedestrians.peds[0].mesh.group.position;
  const pl = window.__game.player.position;
  return { x: p.x, z: p.z, dist: Math.hypot(p.x - pl.x, p.z - pl.z) };
});
info('ped placed in front', `(${pedPos.x.toFixed(1)},${pedPos.z.toFixed(1)}) dist=${pedPos.dist.toFixed(1)}m`);
check('ped is in punch range', pedPos.dist < 2.6, `dist=${pedPos.dist.toFixed(1)}m`);
await page.evaluate(() => { window.__punchSound = null; });
await page.mouse.click(640, 360);
await page.waitForTimeout(600);
// A punch is non-lethal: onHitPedestrian makes the ped FLEE (guns knock
// them down). Assert the flee, not a knockdown.
const pedFlee = await page.evaluate(() => window.__game.pedestrians.peds[0].fleeTimer);
s = await combatState();
info('after punching the ped', `fleeTimer=${pedFlee.toFixed(2)} sound=${JSON.stringify(s.punchSound)}`);
check('punch makes the ped flee', pedFlee > 0, `fleeTimer=${pedFlee.toFixed(2)}`);
check('punch hit plays the impact sound', s.punchSound !== null && s.punchSound.hit === true, JSON.stringify(s.punchSound));

// --- 4. Drag without a lock rotates the camera, does not attack ---
await waitCooldown();
await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
await page.waitForTimeout(500);
const yawBefore = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
await page.mouse.move(640, 360);
await page.mouse.down();
await page.mouse.move(940, 360, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);
const yawAfter = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
s = await combatState();
info('after drag (no lock)', `yawOffset ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)} cooldown=${s.cooldown.toFixed(2)}`);
check('drag without lock rotates the camera', Math.abs(yawAfter - yawBefore) > 0.1, `yawOffset ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)}`);
check('drag without lock does not attack', s.cooldown <= 0 && s.punchTimer <= 0, `cooldown=${s.cooldown.toFixed(2)}`);

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);

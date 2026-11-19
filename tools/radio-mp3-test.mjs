// MP3 radio tests for SOLARIS KEYS: each station plays its own full-length
// Pixabay track on loop via HTMLAudioElement (volume 0.3); R/options switch
// stations; nowPlaying shows the real track name; a failed load degrades to
// silence, never a crash. Expects the real compressed tracks in game/assets/
// (~130s each, 128 kbps). Headless Chromium decodes MP3, so playback state
// is hard-checked; if a file ever fails to load, the duration checks report
// it instead of silently passing.
// Run: node tools/radio-mp3-test.mjs
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
async function dismissPhone() {
  await page.evaluate(() => document.getElementById('phone-later')?.click());
}
const radioState = () => page.evaluate(() => {
  const a = window.__game.audio;
  const el = a.radioAudio;
  if (!el) return { exists: false };
  return {
    exists: true,
    src: el.src,
    loop: el.loop,
    volume: el.volume,
    paused: el.paused,
    readyState: el.readyState,
    networkState: el.networkState,
    duration: el.duration,
    currentTime: el.currentTime,
    error: el.error ? el.error.code : null,
    failed: a.radioFailed,
    nowPlaying: a.nowPlaying(),
  };
});

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(800);
await dismissPhone();
await page.waitForTimeout(1500);

let st = await radioState();
check('radio Audio element created after start', st.exists === true);
check('station 1 src is radio-1.mp3', typeof st.src === 'string' && st.src.endsWith('radio-1.mp3'), st.src);
check('radio loops', st.loop === true);
check('radio volume is 0.3', st.volume === 0.3, `got ${st.volume}`);
check(
  'nowPlaying shows WAVE 88.1 + track name',
  typeof st.nowPlaying === 'string' && st.nowPlaying.includes('WAVE 88.1') && st.nowPlaying.includes('No Copyright Music'),
  st.nowPlaying,
);
info('playback state after start', `paused=${st.paused} readyState=${st.readyState} networkState=${st.networkState} duration=${st.duration} error=${st.error} failed=${st.failed}`);
check('station 1 MP3 decoded (readyState >= 2)', st.readyState >= 2, `readyState=${st.readyState} error=${st.error}`);
check('station 1 is the full track (~131s)', Number.isFinite(st.duration) && st.duration > 125 && st.duration < 140, `duration=${st.duration}`);
check('MP3 playing (not paused)', st.paused === false);
const t0 = st.currentTime;
await page.waitForTimeout(1200);
st = await radioState();
check('playhead advances', st.currentTime > t0, `${t0} -> ${st.currentTime}`);

// Switch stations with R (KeyR handler calls nextStation).
async function waitForTrack() {
  for (let i = 0; i < 10; i += 1) {
    const d = await page.evaluate(() => window.__game.audio.radioAudio.duration);
    if (Number.isFinite(d) && d > 0) return;
    await page.waitForTimeout(500);
  }
}
await page.keyboard.press('KeyR');
await waitForTrack();
st = await radioState();
check('R switches src to radio-2.mp3', typeof st.src === 'string' && st.src.endsWith('radio-2.mp3'), st.src);
check('nowPlaying shows RADIO SOL 101.9', st.nowPlaying.includes('RADIO SOL 101.9'), st.nowPlaying);
check('station 2 is the full track (~130s)', Number.isFinite(st.duration) && st.duration > 125 && st.duration < 140, `duration=${st.duration}`);
await page.keyboard.press('KeyR');
await waitForTrack();
st = await radioState();
check('R switches src to radio-3.mp3', typeof st.src === 'string' && st.src.endsWith('radio-3.mp3'), st.src);
check('nowPlaying shows KEYS FM 95.5', st.nowPlaying.includes('KEYS FM 95.5'), st.nowPlaying);
check('station 3 is the full track (~135s)', Number.isFinite(st.duration) && st.duration > 125 && st.duration < 140, `duration=${st.duration}`);
await page.keyboard.press('KeyR');
await waitForTrack();
st = await radioState();
check('R wraps back to radio-1.mp3', typeof st.src === 'string' && st.src.endsWith('radio-1.mp3'), st.src);

// Music toggle pauses/resumes (only meaningful if a track loaded).
await page.evaluate(() => window.__game.audio.setMusicEnabled(false));
await page.waitForTimeout(300);
st = await radioState();
check('setMusicEnabled(false) pauses', st.paused === true);
await page.evaluate(() => window.__game.audio.setMusicEnabled(true));
await page.waitForTimeout(500);
st = await radioState();
check('setMusicEnabled(true) resumes', st.paused === false);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);

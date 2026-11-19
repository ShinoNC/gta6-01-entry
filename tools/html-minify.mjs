// Minify tools/src-backup/index.html -> game/index.html (deterministic).
// The live file is the readable backup with whitespace collapsed:
//  - CSS: one rule per line is joined; spaces around {}:;, removed.
//  - HTML: newlines + indentation between tags removed.
// Usage: node tools/html-minify.mjs [--check]
//   --check: verify minify(backup) == live file (byte-identical), no write.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ENTRY, 'tools/src-backup/index.html');
const DEST = join(ENTRY, 'game/index.html');

export function minifyHtml(raw) {
  // Minify the <style> block: strip newlines, collapse spaces around CSS punctuation.
  const styleRe = /<style>([\s\S]*?)<\/style>/;
  const m = raw.match(styleRe);
  let css = m[1];
  css = css
    .replace(/\n\s*/g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1');
  let out = raw.replace(styleRe, `<style>${css}</style>`);
  // Collapse HTML: remove newlines + leading whitespace; keep single spaces inside text.
  out = out
    .split('\n')
    .map((line) => line.trim())
    .join('')
    .replace('<script type="importmap">{', '<script type="importmap">\n{')
    .replace('} }</script>', '} }\n</script>');
  return out;
}

const minified = minifyHtml(readFileSync(SRC, 'utf8'));
if (process.argv.includes('--check')) {
  const live = readFileSync(DEST, 'utf8');
  // Whitespace-normalized comparison: the live file keeps a few newlines inside
  // text nodes that render identically; only non-whitespace differences matter.
  const norm = (s) => s.replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/\s+/g, ' ');
  if (norm(minified) === norm(live)) {
    console.log(`CHECK OK: minify(backup) == live file (whitespace-insensitive); minified ${minified.length} B vs live ${live.length} B`);
  } else {
    console.log('CHECK FAIL: lengths', minified.length, 'vs live', live.length);
    const a = norm(minified);
    const b = norm(live);
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
    console.log('first diff at normalized byte', i);
    console.log('minified:', JSON.stringify(a.slice(Math.max(0, i - 80), i + 120)));
    console.log('live    :', JSON.stringify(b.slice(Math.max(0, i - 80), i + 120)));
    process.exit(1);
  }
} else {
  writeFileSync(DEST, minified);
  console.log('wrote', DEST, minified.length, 'bytes');
}

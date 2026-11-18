// SOLARIS KEYS — entry hand-in for gta6-01 (Node 22, standard library only).
//
// The game itself lives in game/ beside this file: static files a desktop
// browser loads offline (index.html, ES modules under src/, pixel-art PNGs
// under assets/, three.js vendored under vendor/). This program only delivers
// it: it copies game/ and screenshots/ into the output directory and writes
// dossier.json there, the summary the judge reads, using the vendored
// make.fun dossier builder. The caps passed to the builder are the scorer's
// own (see the kit's reference/gate.json): text_max_bytes shapes the dossier
// text; the rest refuse an entry the scorer would refuse.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Then serve the game locally with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const entryDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(entryDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(entryDir, 'screenshots'))) {
  cpSync(join(entryDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

# Readable sources for minified game files

All 24 files in `game/src/` are MINIFIED with esbuild (to fit the
163,840 B dossier cap). This directory holds the readable originals — edit
here and re-minify, never in `game/src/`. `police.js` was minified in the
20/11 fix batch (freed ~8.4 KB); `main.js` was minified in fix batch 5
(53,417 → 28,967 B, freed ~24.4 KB).

## Editing a minified file

1. Edit the file HERE in `tools/src-backup/`.
2. Re-minify into place:
   `npx -y esbuild tools/src-backup/<name>.js --minify --outfile=/tmp/<name>.min.js && mv /tmp/<name>.min.js game/src/<name>.js`
   (esbuild refuses in-place overwrite, hence the temp file.)
3. `node --check game/src/<name>.js`
4. Re-measure the dossier:
   `rm -rf /tmp/doss-check && MAKEFUN_OUTPUT_DIR=/tmp/doss-check node main.ts && node -e "const d=require('/tmp/doss-check/dossier.json');console.log(Buffer.byteLength(d.text), d.text.includes('[Cut at'))"`
   Must stay under 163,840 B with no cut marker.
5. Run `node tools/verify.mjs` + `node tools/gta-audit-test.mjs`.

## Minified files (24)

audio, business, camera, city, combat, dialogue, effects, hud, input,
main, missions, pedestrians, player, police, random, robbery, save,
sidejobs, tapes, textures, traffic, vehicles, wanted, weather.

`game/index.html` is minified from its readable copy here with
`node tools/html-minify.mjs` (its CSS is minified but its markup is
intact).

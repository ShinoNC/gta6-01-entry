# Readable sources for minified game files

20 of the 23 files in `game/src/` are MINIFIED with esbuild (to fit the
163,840 B dossier cap after the GTA-logic fixes). This directory holds the
readable originals. `main.js` and `police.js` are NOT
minified — they are edited in place in `game/src/` (copies here are backups).

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

## Minified files (20)

audio, camera, city, combat, dialogue, effects, hud, input, pedestrians,
player, random, robbery, save, sidejobs, tapes, textures, traffic, vehicles,
wanted, weather.

## Kept readable (2)

main.js, police.js (+ game/index.html, whose CSS is minified
but whose markup is intact; its readable copy is index.html here).

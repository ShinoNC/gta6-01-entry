# VICE ROYALE — a GTA-style open world for make.fun (gta6-01)

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ShinoNC/gta6-01-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ShinoNC/gta6-01-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Begin with nothing and take the whole island. A 10x10-block open world
ringed by beach and open sea: 8 story jobs, 3 businesses to buy, a garage,
side jobs, bank robberies, 4 gangs, a 5-star wanted system, day and night
weather plus 40 hidden tapes, in one static page with no build step.

v2 (24 Nov 2026): 10x10 map, tower and arena on the front row, pooled robbery cars, punch fix.

## Play

Serve `game/` as static files (or run `node serve.ts`), then open
`game/index.html` in a desktop browser. Once loaded it needs no network:
three.js ships vendored under `game/vendor/`, and textures and radio are local.

- **W/S** move · **A/D** turn · **F** enter or exit a car · **CLICK** punch or shoot
- **SPACE** jump / handbrake · **M** missions · **B** business · **N** map
- **E** interact · **Q/E** change menu tabs · **SHIFT** nitro (when owned)

## What's inside

- `game/index.html` — the whole page: HUD, menus, minimap, full map.
- `game/src/` — 26 ES modules covering city, traffic (48 cars), police,
  combat, missions, businesses, side jobs, robberies, weather, audio, save.
- `game/assets/` — pixel-art PNGs plus three local radio tracks.
- `screenshots/` — chase, street, missions and title shots.
- `main.ts` — the hand-in program: it copies `game/` and `screenshots/`,
  then writes `dossier.json` using the vendored make.fun dossier builder.

## Credits

- 3D models (people, vehicles, houses, weapons, city kit, speedboat,
  Coconut Palm, animation clips) by [Vinish](https://vinish.dev), licensed
  [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) — decimated and
  recoloured for the game.

## Notes

- Seeded RNG: `?seed=N` replays the same island, traffic and weather.
- Saves sit in `localStorage` (3 slots); look and settings persist too.
- The game runs offline; these badges are its only network use.

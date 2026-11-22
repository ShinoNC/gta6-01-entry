# VICE ROYALE — a GTA-style open world for make.fun (gta6-01)

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/ShinoNC/gta6-01-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/ShinoNC/gta6-01-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Start with nothing. Take the whole island. A 12×12-block open world with
a beach ring and open sea: 8 story jobs, 3 buyable businesses, a garage,
side jobs, bank robberies, 4 gangs, a 5-star wanted system, day/night
weather, and 40 hidden tapes — in one static page, no build step.

## Play

Serve `game/` statically (or run `node serve.ts`) and open
`game/index.html` in a desktop browser. No network needed once loaded:
three.js is vendored under `game/vendor/`, textures and radio are local.

- **W/S** move · **A/D** turn · **F** enter/exit car · **CLICK** punch/shoot
- **SPACE** jump / handbrake · **M** missions · **B** business · **N** map
- **E** interact · **Q/E** switch menu tabs · **SHIFT** nitro (when owned)

## What's inside

- `game/index.html` — the whole page: HUD, menus, minimap, full map.
- `game/src/` — 26 ES modules: city, traffic (48 cars), police, combat,
  missions, businesses, side jobs, robberies, weather, audio, save.
- `game/assets/` — pixel-art PNGs and three local radio tracks.
- `screenshots/` — chase, street, missions and title shots.
- `main.ts` — the hand-in program: copies `game/` + `screenshots/` and
  writes `dossier.json` with the vendored make.fun dossier builder.

## Notes

- Seeded RNG: `?seed=N` replays the same island, traffic and weather.
- Saves live in `localStorage` (3 slots); look and settings persist too.
- The game runs offline; the only network use is this page's badges.

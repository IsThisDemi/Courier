# Building and hacking on Courier

Courier is an **Electron** shell around a small **Node** server: the server
receives Dota's Game State Integration, talks to OpenDota and serves the UI;
Electron shows that UI as a frameless, always-on-top overlay. To just
install it, see [INSTALL.md](INSTALL.md).

## Running from source

```sh
npm install
npm run install-gsi      # writes the GSI file into Dota (the app also does it on its own)
npm run electron         # the overlay on top of the game
npm run server           # server only: open http://127.0.0.1:51234/ in a browser
```

In Steam add `-gamestateintegration` to Dota 2's launch options, then start
Courier before Dota.

## Building the release files

```sh
npm run dist:win         # dist/Courier-<version>-windows-setup.exe + -windows-portable.exe
npm run dist:mac         # dist/Courier-<version>-mac-arm64.dmg (ad-hoc signed)
npm run icons            # redraws assets/icon-*.png and build/icon.{png,ico,icns}
```

Both work from a Mac: electron-builder edits the Windows executable's icon
and version without Wine.

## Trying it without Dota: the simulator

`tools/gsi-sim.js` sends Courier the same GSI packets the game does: draft,
pre-game, clock, gold, levels, deaths, purchases, Roshan kills.

```sh
npm run server                    # in one terminal
npm run sim                       # a full match at 10x speed
npm run sim -- --scenario game --clock 600 --speed 1 --hero axe --enemies riki,sniper,lion
npm run sim -- --scenario snapshot --clock 1250 --hero axe     # a single moment
npm run sim -- --draft none       # like bot matches: no picks from the game
```

Options: `--hero`, `--team radiant|dire`, `--allies`, `--enemies`
(comma-separated), `--scenario full|draft|game|snapshot`, `--speed`,
`--clock`, `--duration`, `--seed`, `--port`.

## Tests

Every test runs in headless Chromium and never opens a window.

```sh
npm test              # unit tests + end-to-end against a fake OpenDota
npm run shots         # a screenshot of every tab in tests/shots/, fed by the simulator
npm run test:detect   # hero recognition from the screen (needs the server on 51234)
npm run shots -- --overlay 0.78 --width 380               # overlay with a transparent background
npm run shots -- --overlay 0.78 --width 380 --compact 1   # compact mode
COURIER_SMOKE=1 npx electron .   # starts Electron without showing the window and checks preload and overlay
```

### README images

```sh
node tests/shots.js <dir>/overlay --overlay 0.78 --width 380
node tests/shots.js <dir>/compact --overlay 0.78 --width 380 --compact 1
python3 tools/make-readme-art.py <dir> --font Archivo.ttf
```

They use only the app's own UI on a drawn background, never images of the
game. `--font` wants a `.ttf`; the Archivo in `renderer/fonts` is a woff2,
which `fontTools` converts.

## Environment variables

| Variable | Default | |
|---|---|---|
| `COURIER_PORT` | `51234` | Port for the UI and the GSI endpoint |
| `COURIER_DATA` | `~/.courier` | Settings, cache and logs |
| `COURIER_MIN_INTERVAL` | `1100` | Minimum milliseconds between OpenDota requests |
| `OPENDOTA_BASE` | `https://api.opendota.com/api` | Point it at a fake OpenDota in tests |
| `DOTA_PATH` | | Dota 2 folder, when it isn't found on its own |

The old `DOTA_COMPANION_*` names still work.

## Where the data comes from

| What | Source | Cache |
|---|---|---|
| Matchups against enemies | OpenDota `/heroes/{id}/matchups` (pro matches) | 24 hours |
| Synergy with allies | OpenDota explorer, pro matches of the last three patches | 24 hours |
| Pro builds | Explorer, `purchase_log` of the hero's last 120 pro matches in the chosen position, from the current patch | 24 hours |
| Position | Explorer: lane (`lane_role`) and farm order within the team, per pro match | 24 hours |
| Neutral items | Explorer: neutral and enchantment at match end; tiers from the game's `neutral_items.txt` (`node scripts/fetch-neutral-tiers.js` after a patch) | 24 hours |
| Meta | OpenDota `/heroStats` | 24 hours |
| Suggested bans | Allies' matchups + meta + how contested the hero is in pro play | 24 hours |
| Items against enemies | Explorer: final inventories of players facing that hero in the last three patches, against the last 6000 pro matches, keeping only items from your hero's build | 24 hours |
| Enemy items | The pro builds of the enemy heroes (an estimate, not what they actually have) | 24 hours |
| Skill order | Explorer: `ability_upgrades_arr` of the hero's last 120 pro matches in the chosen position, from the current patch | 24 hours |
| My heroes | OpenDota `/players/{id}/heroes`, last 180 days | 24 hours |
| Match recap | OpenDota `/matches/{id}` (asks for a parse when it isn't there yet) | 5 minutes |

When the new patch has fewer than 20 pro matches for a hero, Courier
widens to the previous patch and says so.

## Reading the screen

The player GSI doesn't send other players' picks. In the desktop app,
`renderer/js/screen.js` captures the Dota window and `renderer/detect.js`
matches the ten portraits at the top against fingerprints of the official
portraits (`renderer/data/prints.json`, rebuilt by `scripts/make-prints.js`):

- **on the pick screen** (hero selection and strategy time) every 6
  seconds, as heroes get picked. Portraits there are bigger and further
  out than in the match; the layout is measured on the current client,
  with both the narrow and the wide spacing around the clock, and small
  scale differences are tried automatically. Heroes only hovered (grey)
  don't count;
- **in the match** every 25 seconds while enemies are missing.

## What the game sends

The GSI file asks Dota for every block it offers. Courier keeps what it
receives from the real game (not from the simulator) in
`~/.courier/logs/gsi/`:

- `state-<phase>.json`: the last full packet of each phase (pick, strategy,
  pre-game, match, end), refreshed every 5 seconds;
- `keys.json`: every field received at least once, with a sample value;
- `events.jsonl`: every event (Roshan, Aegis, runes, courier…) with the
  game clock.

After updating the GSI blocks, run `npm run install-gsi` again (or just
start the app) and restart Dota. `npm run uninstall-gsi` removes the file.

## Project layout

```
electron-main.js        # overlay window, tray, shortcuts, screen capture, GSI install
preload.js              # the bridge between the page and the main process
server.js               # GSI endpoint, OpenDota queue and cache, JSON API, static UI
lib/
├── gsi-install.js      # the gamestate_integration file inside Dota
├── gsi-state.js        # match state from GSI packets
├── gsi-sampler.js      # what the real game sent, kept for debugging
├── opendota.js         # OpenDota client
├── remote.js           # request queue, retries and disk cache
├── suggest.js          # picks and bans
├── counters.js         # items against the enemies, enemy predictions
├── probuild.js         # pro builds
├── skills.js           # skill order
├── neutrals.js         # neutral items and enchantments
├── positions.js        # positions 1–5 from pro matches
├── patches.js          # patch windows
└── constants.js        # heroes and items
renderer/               # the UI (plain HTML, CSS and JS) and its data
scripts/                # GSI install, Dota path, data refreshers
tools/                  # GSI simulator, icons, README images
tests/                  # unit, end-to-end, screen recognition, screenshots
```

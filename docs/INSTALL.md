# Installing Courier

Every build is on the
[Releases page](https://github.com/IsThisDemi/Courier/releases/latest).
The builds aren't signed with a paid certificate, so Windows and macOS ask
for one extra click the first time.

- [Windows](#%EF%B8%8F-windows)
- [Mac](#-mac)
- [First match](#first-match)
- [Shortcuts](#shortcuts)
- [Settings](#settings)
- [Uninstalling](#uninstalling)

## 🖥️ Windows

Requires **Windows 10** or newer, 64-bit.

- **Installer**: run `Courier-…-windows-setup.exe`.
- **Portable**: run `Courier-…-windows-portable.exe` from any folder, no
  installation.

SmartScreen may say it protected your PC: click **More info → Run
anyway**.

## 🍎 Mac

Requires an **Apple Silicon** Mac (M1 or later).

1. Open `Courier-…-mac-arm64.dmg` and drag **Courier** into *Applications*.
2. Open it. macOS says it can't verify the developer: go to **System
   Settings → Privacy & Security** and press **Open Anyway** at the bottom.
   If it says the app **"is damaged"**, run
   `xattr -dr com.apple.quarantine /Applications/Courier.app` in Terminal.
3. To read heroes from the screen, allow Courier in **System Settings →
   Privacy & Security → Screen Recording** when macOS asks.

## First match

1. **Open Courier before Dota.** On first launch it finds your Dota 2
   folder (every Steam library) and writes its Game State Integration file
   there. If it can't find Dota, right-click the Courier icon in the
   notification area (menu bar on Mac) and choose **Collega a Dota 2…**
   to pick the `dota 2 beta` folder yourself.
2. **Add one launch option, once.** In Steam: *Dota 2 → Properties →
   General → Launch Options*, add `-gamestateintegration`. Without it, Dota
   sends nothing.
3. **Play in borderless window mode** (*Settings → Video*). In exclusive
   full screen no window can stay on top of the game.
4. Start Dota. The dot in Courier's top bar turns on as soon as the game
   talks to it.

Drag the top bar to move the window; Courier remembers where you left it.

### Reading heroes from the screen

The player GSI only tells Courier about **your** hero. To fill in the other
nine, open **Lettura dallo schermo** in the Draft tab: Courier recognizes
the portraits at the top of the screen, on the pick screen every few
seconds and in the match until every enemy is known. If it reads the wrong
spot, **Allinea con 3 clic** saves an alignment for that screen. Missing
heroes can always be added by hand with the **+** in each lineup.

## Shortcuts

They work while you play, even when Courier isn't focused.

| Shortcut | What it does |
|---|---|
| **Alt+D** | Show or hide the window |
| **Alt+T** | Click-through: clicks go to the game (gold border while on) |
| **Alt+C** | Compact mode: clock, upcoming events, next item and skill |
| **Alt+1 / 2 / 3** | Draft, Match, Items |
| **Alt+R** | Roshan killed now |

In Settings you can make clicks pass through **automatically** during the
match and come back in the draft. The same controls are in the tray icon's
menu.

## Settings

The gear icon opens them:

- **OpenDota API key**: optional. Without one OpenDota allows about 60
  requests a minute; Courier queues them and falls back to its saved copy
  when OpenDota is slow. A free key comes from
  <https://www.opendota.com/api-keys>.
- **Your Account ID or Steam ID**: for *my heroes* and the end-of-match
  recap.
- **Background opacity**: how much of the game shows through.

Settings, cache and logs live in `~/.courier/` (`%USERPROFILE%\.courier`
on Windows). **Apri il log** in Settings opens the log.

## Uninstalling

Uninstall Courier like any other app, then remove
`gamestate_integration_courier.cfg` from
`dota 2 beta\game\dota\cfg\gamestate_integration\` so Dota stops sending
data, and delete `~/.courier/` if you want to drop the cache too.

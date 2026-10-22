# companion-module-rs6-presets: PV Control Center

A Bitfocus **Companion** module (3.4 and later, including 4.x and 5.x) for the **PV Control Center** app
(formerly RS6 Presets). It controls an Analog Way Aquilon RS6 (Barco E2-style destination presets), a Barco E2,
a PixelHue, a Blackmagic ATEM and Panasonic PTZ cameras, **all through the app's HTTP API** (default port 8080).
The module never connects to a device directly. The module id stays `rs6-presets` (shortname `rs6presets`), so
existing connections and buttons keep working; only the display name is now "PV Control Center".

Built on `@companion-module/base` ~1.10 (node18 runtime) in plain JavaScript, with no TypeScript build.

![icon](companion/icon.png)

## New in 0.7.1

- **RS6 backup buttons name the source.** Each input and background backup key shows the source it protects, the backup source that slot switches to (`LIVE_9` becomes that input's label, `STILL_1` is `Still 1`, `NATIVE_2` is `Native 2`), and the live state (`PRIMARY`, `BKP 1`, `BKP 2`, plus `AUTO`). Group backups are buttons too, with the group name, the same state, and the member list.
- **Text shrinks to fit.** Button text size is `auto` instead of a fixed 14. Companion draws that as shrink-to-fit, wrapping on spaces, so a long name no longer runs off the key. A fixed size never shrinks, and on Companion 5 it is scaled up (`14` with no top bar becomes about 23% of the key) which is what was clipping.
- **Not a Companion-base upgrade.** Font, weight and "start at this size, then shrink" are layered text elements. Those exist in `@companion-module/base` 2.1 and Companion's graphics overhaul, and that base is a breaking API (Companion 3.4 would not load the module). This module still speaks Companion 3.4 through 5.x, so it stays on base 1.10 and uses the `auto` size every one of those versions already draws.

## New in 0.6.0 (for Control Center app 0.8.0, API 8)

- **One path to every device.** New actions, feedbacks, variables and button presets for E2 (`e2_…`), PixelHue
  (`pixelhue_…`), ATEM (`atem_…`) and Panasonic PTZ (`ptz_…`), plus `sys_set_active`. All existing RS6 action,
  feedback and variable ids are unchanged. See `companion/HELP.md` for the full list.
- **Compatibility check.** The module expects API 8. It starts the multi-system long-poll
  (`GET /api/sys?since=<rev>&timeout=<ms>&views=all`) only when the app reports API 8 and lists the
  `sysLongpoll`, `sysViews` and `companionGateway` features in `GET /api/version`. With an app at API 5–7 the RS6
  buttons keep working, the status stays OK and the log says to update the app.
- **PTZ hold-to-run** with stop on release: press = move/zoom/focus, release = `ptz_stop`. While held the module
  sends `POST /api/sys/ptz/cmd/keepalive` every 0.5 s (the app sends nothing to the camera for it, it only re-arms
  its 1.5 s dead-man). A lost release stops after **PTZ max hold** (config, default 20 s); a lost connection stops
  within the app's dead-man. Destroying or reconfiguring the connection sends a stop for every held camera.
- **Full camera command set.** `ptz_exec`, `ptz_toggle`, `ptz_set`, `ptz_step` and `ptz_adjust` reach all 71
  commands of the app's PTZ catalog (the bitfocus companion-module-panasonic-ptz aw_ptz / aw_cam set plus AW-UE150
  spec additions; `src/ptz-ops.js` is generated from it by `tools/gen-ptz-ops.js`). At runtime the module reads each
  camera's own catalog (`GET /api/sys/ptz/cameras/:id/catalog`) for its options and ranges.
- **Button looks.** The 0.6.0 styling pass (72×72 tech-look backgrounds; text was a fixed size 14, which 0.7.1 changes to `auto`) now has a family per
  system: E2 lime, PixelHue rose, ATEM gold, PTZ indigo, each with Preview / Program / selected lit states.
  `python3 tools/make-button-styles.py` regenerates `src/styles.js`; `python3 tools/render-preview.py OUT.png`
  renders the preview sheet.

## Install on a Mac (one line)

```bash
curl -fsSL https://github.com/stevenmarr/companion-module-rs6-presets/releases/latest/download/install-companion-module.sh | bash
```

The script ([install-companion-module.sh](install-companion-module.sh), also attached to every release):
- downloads the release's module package `companion-module-rs6-presets.tgz` (built with
  `companion-module-build`)
- checks it and saves it as `~/companion-modules/rs6-presets/companion-module-rs6-presets-<version>.tgz`
- lists the rs6-presets versions Companion already has
- opens Companion's Modules page and shows the file in Finder

It is safe to run again, never uses sudo, and doesn't touch Companion's own files. To pass options,
use `| bash -s -- --dev`:

| Option | Effect |
|---|---|
| `--version v0.3.1` | Install that release instead of the latest. |
| `--file <.tgz or release .zip>` | Use a local file instead of downloading. |
| `--dev` | Also unpack to `~/companion-modules/dev/rs6-presets` for the Developer modules path. Automatic on Companion 3.x. |
| `--restart` | Quit and reopen Companion. |
| `--no-open` | Don't open Companion or Finder. |

Then, in Companion 4.x or 5.x (this is Companion's supported way to add a module that isn't in its
store; see the Modules page in the Companion user guide):
1. **Modules › Import module package**, then choose the `.tgz` the script printed. In the file
   dialog, press Cmd+Shift+G and paste the path. Don't unpack the `.tgz`.
2. **New connection:** Connections › **+ Add connection**, search **PV Control Center** (Performance Video; module id rs6-presets),
   pick the version you imported, then set **App host/IP** (`127.0.0.1` if the app runs on the same
   Mac) and **App port** `8080`.
   **Existing connection:** open it, click the **pencil** next to the module version, pick the new
   version and **Save**. The connection restarts; Companion itself doesn't need a restart.
3. Drag buttons from **Buttons › Presets › rs6-presets**. Buttons you already have keep working,
   because the module id never changes. Buttons dragged from an older version keep their old text;
   drag them again only if you want the new text.

## New in 0.5.0 (for app 0.5.0)

**Upgrading keeps your connection and buttons.** The module id is still `rs6-presets` (the same id in every
release), so Companion treats 0.5.0 as a new version of the same module. Import the `.tgz`, then on the
existing connection click the **pencil** next to the version and pick **0.5.0**. Until you do that, the
connection stays on the version it was created with. Importing alone doesn't switch it.

- **Covers 24 to 96 tiles.** The app now has a tile-count setting (24/48/72/96, default 48). The recall
  dropdown, the `preset_<N>_name`/`preset_<N>_summary` variables and the button presets cover every tile
  up to that count, plus any used tile above it. Empty tiles show `N (empty)`. The button presets are grouped
  in pages of 24 (`Preset tiles 1-24`, `25-48`, ...), matching the app's pager.
- **Version check.** The module reads `appVersion`/`apiVersion` from the app (`GET /api/version` also
  exists). If the app is older or newer than the module expects (API 5), the connection shows a
  **warning** status and the log says which one to update. It is logged once, not on every poll.
- **Recall no longer fights the app.** 0.3.2 sent its own `POST /api/selection` after a recall, which
  raced the app (since app 0.3.1 the app selects the preset's screens itself) and could name destinations
  the app no longer had. Against app 0.3.1+ the module now leaves the selection to the app. Against older
  apps it still sets the selection, but only to destinations that exist.
- **New variables:** `app_version`, `app_api_version`, `show_name` (the app's current show file) and `tile_count`.
- Backup feedback uses the app's `active` flag when the app provides it.
- A contract test runs this module against the real app (mock device) to check every field it reads.

| Module | Works with app | Notes |
|---|---|---|
| 0.5.0 | 0.5.0 (API 5) | Warns against older or newer apps but still works with 0.2.0+. |
| 0.4.0 | 0.4.0 | Tiles 1-24 only. No version check. |
| 0.3.2 | 0.3.x | Extra selection POST after recall. |
| 0.3.1 and older | 0.3.x | Variables only for existing presets. Buttons for a moved tile say "No preset N". |

## New in 0.4.0 (for app 0.4.0)

- **Buttons follow the tile.** The app can now swap or move preset tiles (drag, MOVE mode, or
  `POST /api/presets/swap`). The preset numbers swap, so "Recall preset 3", `$(rs6presets:preset_3_name)`
  and the preset-3 tally feedbacks always mean *whatever is in tile 3*. A Stream Deck page laid out like the
  app's grid stays in step with it, with no re-programming. `preset_<N>_name` and `preset_<N>_summary` now
  exist for every tile from 1 to max(24, highest number). A tile emptied by a move shows `N (empty)`
  instead of a stale name.
- **`backup_group_<G>_name`**: the backup group's name as set on the device, for groups that exist.
- Older apps work as before.

## New in 0.3.2

- **Recalling a preset selects that preset's destinations.** TAKE and CUT, and the destination buttons, follow the destination group assigned on the preset in the app (its screens, plus the Master's screens). If the app's selection is still the previous group after the recall, the module sets it.

## New in 0.3.1

- **Preset buttons show the preset's name**, live from `$(rs6presets:preset_<N>_name)`. The number
  is shown only for a preset without a name. Text is auto-sized, so a long name wraps on a 72×72
  button. Master memory buttons show the memory name the same way (`master_mem_<N>_name`).
- The variables in button text use your connection's label. If you renamed the connection from
  `rs6presets`, newly generated buttons use the new label (the button list is rebuilt whenever presets or memories change, or when the connection restarts).
- **TAKE and CUT buttons show their targets** on a second line (`$(rs6presets:selection)`, for
  example `S1 S2`). With app 0.3.1 that is exactly the set TAKE and CUT will act on.
- With app 0.3.1, PVW/PGM tally stays correct after a TAKE on the RS6. The fix is in the app; see
  its README.

## New in 0.3.0: combined presets and imported memories

App 0.3.0 imports the RS6's own memories (Screen/Aux, Master, Multiviewer) and lets you build
**combined presets** on its front screen (a different memory per screen, optionally a Master and
multiviewer memories). The module follows along:

- **Preset dropdowns.** *Recall preset to Preview*, *Preset on Preview* and *Preset on Program* now
  use a dropdown that lists every app preset with its contents, e.g. `10 Panel Master + MV (M:3 S4:30 MV1:2)`.
  You can still type a number (custom values are allowed), so 0.2.0 buttons keep working.
- **New actions:** *Load Screen memory to a destination* (PVW/PGM), *Load Master memory* (PVW/PGM),
  *Load Multiviewer memory*, *Refresh memories from the RS6*. Each memory dropdown is built from the
  memories the app imported, with their names.
- **Memory feedbacks** (*Destination last Screen memory is X*, *Last Master memory is X*) use the same
  named dropdowns.
- **New variables:** `screen_mem_<N>_name`, `master_mem_<N>_name` (for every named or loaded memory),
  `mv_mem_<N>_name` (only when the app's *memory probe* is on, because multiviewer memory names are not
  in the AWJ guide), `preset_<N>_summary` (e.g. `M:3 S4:30 MV1:2`) and `memories_imported` (time of
  the last import).
- **New button presets:** *Master memories* (one per named Master: loads it to Preview, with PVW/PGM
  tally), *Refresh memories*, and a Performance Video logo button.
- Dropdowns, variables and buttons are rebuilt when a memory is renamed on the device or a preset changes.

Against app 0.2.0 everything above degrades quietly: dropdowns fall back to plain numbers and the
memory actions return the app's 404.

## What you get

| Kind | Items |
|---|---|
| **Config** | App host/IP · app port (8080) · Updates: **Long-poll** (default) or Poll only · poll interval (300 ms) |
| **Actions** | Recall preset to Preview (dropdown of combined presets, **0.3.0**) · **Load Screen / Master / Multiviewer memory** and **Refresh memories** (**0.3.0**) · TAKE · CUT · Toggle destination (S1…, A1…) · Auto take (toggle/on/off) · **Input freeze** (toggle/on/off) · **Backup: select primary / backup 1 / backup 2** for an input, background set (`S1/2`) or backup group · **Backup: automatic/manual mode** · **Audio channel mute** (input rx / output tx; toggle/on/off) |
| **Feedbacks** | Preset on Preview (green) and Preset on Program (red), each with an optional "partial" match · Destination selected (amber) · Auto take ON · App connected to the RS6 · **Input on Program (red)** and **Input on Preview (green)** from the device, with an input dropdown built from the device's input labels and optionally limited to one destination · **Destination last Screen memory is X** (PGM or PVW) · **Last Master memory is X** · **Input frozen** (blue) · **Input unavailable / disabled** · **Backup active** (any slot, or a specific one) · **Audio channel muted** (red) |
| **Variables** | `last_preset_number`, `last_preset_name`, `program_presets`, `selection`, `auto_take`, `device_connected`, `preset_<N>_name`. **New in 0.2.0:** `input_<N>_label`; `<S1>_pgm_memory_number`, `<S1>_pgm_memory_name`, `<S1>_pvw_memory_number` and `<S1>_pvw_memory_name` for every destination; `master_pgm_number`, `master_pgm_name`, `master_pvw_number` and `master_pvw_name`; `<S1>_pgm_layer1` (label of the Program layer-1 source); `live_mode`. **New in 0.3.0:** `screen_mem_<N>_name`, `master_mem_<N>_name`, `mv_mem_<N>_name`, `preset_<N>_summary`, `memories_imported`. **New in 0.4.0:** `backup_group_<G>_name`; preset variables exist for every tile 1..max(24, highest). **New in 0.7.1:** `bk_in_<N>_name`, `bk_in_<N>_src1`, `bk_in_<N>_src2`, `bk_in_<N>_state` (and `bk_bg_<S>_<set>_…` for a background set); `bk_grp_<G>_state`, `bk_grp_<G>_members` |
| **Presets** | One button per app preset (recall plus PVW/PGM tally), one per destination (toggle plus selected feedback), TAKE, CUT, AUTO TAKE, and "last recalled" and "last Master" displays. **New:** *Input tally* (one per input: label, PVW green, PGM red, yellow text when unavailable or disabled); *Input freeze* (one per input: toggle, blue when frozen); *Backups* (PRIMARY / BKP 1 / BKP 2 for each input with backups, the source name and the live state); *Backup groups* and *Background backups* (same three slots). *Audio inputs mute* and *Audio outputs mute* (one per channel). **0.3.0:** *Master memories*, *Refresh memories*, logo button. **0.7.1:** text size `auto` (shrink to fit). Presets regenerate when presets, inputs, channels, backup sets or labels change. |

### How it stays up to date

The module talks **only to the RS6 Presets app's HTTP API**. It never connects to the Aquilon.

- **Long-poll (default).** The module sends `GET /api/state?since=<rev>&timeout=20000`, and the app
  holds the request open until something changes. With app 0.2.0's live AWJ subscriptions, a change
  made on the RC400T or the Web RCS reaches Companion feedback within a few tens of milliseconds:
  tally, last memory, freeze, backups, mutes and labels.
- **Fallback.** If the app doesn't return a `rev` (an app older than 0.2.0), the module logs it once
  and polls `GET /api/state` every *poll interval*. *Poll only* forces this mode. After a network
  error, the module waits one poll interval and retries.

The live features need RS6 Presets app **0.2.0 or later**, connected to the RS6 with live state on.
Against an older app, the new feedbacks are simply false and the new variables are empty.

## Alternative: the Developer modules path

Use this on Companion 3.x, which has no package import, or for development. You need Companion 3.4 or newer and the RS6 Presets app running somewhere on the
network.

1. Make a folder for dev modules, for example `~/companion-dev-modules`.
2. Put the module inside it, using **either**:
   - **Pre-built (no Node or npm needed):** copy `dist/rs6-presets/` from this zip to
     `~/companion-dev-modules/rs6-presets/`. It holds a bundled `main.js`, `package.json` and `companion/manifest.json`.
   - **From source:** copy this whole folder to `~/companion-dev-modules/companion-module-rs6-presets/`, then run
     ```bash
     cd ~/companion-dev-modules/companion-module-rs6-presets
     npm install
     ```
3. Open the **Companion launcher** window (the small window with the "Launch GUI" button), click the
   **cog** (on Companion 4.1 and later this opens a Settings window), and set **Developer modules path** to `~/companion-dev-modules`. Companion
   restarts its module host and picks the module up. It also reloads when files there change.
4. In the Companion web UI, go to **Connections › Add connection**, search for **"PV Control Center"**
   (manufacturer Performance Video), and add it.
5. Set **App host/IP** to the Mac running the RS6 Presets app (`127.0.0.1` if it's the same machine) and
   **App port** to `8080`.
6. Drag buttons from **Presets › rs6-presets**: Presets, Destinations and Transitions.

On a headless or Pi install, pass `--extra-module-path /path/to/companion-dev-modules` to the
Companion binary instead of using the launcher. Check the docs for your Companion version, since the
flag name has changed between releases.

## Develop

```bash
npm install
npm test              # unit + wiring tests, and end-to-end runs against the sibling app checkout in --mock mode
npm run package       # companion-module-build -> pkg/ and pkg.tgz
```

## Verified vs inferred

- **Verified (by tests):**
  - the module's logic, and its wiring under a stubbed `@companion-module/base`
  - long-poll, the poll fallback, abort on destroy, and every new action route (against a fake app)
  - an end-to-end run against the real app in `--mock` mode (`test/fixtures/app-state-0.2.0.json`
    was captured from it). A freeze made through the app reached the module's feedback in about 65 ms.
  - 0.3.0: combined-preset dropdowns, memory dropdowns/variables, Master memory buttons and the new
    memory routes, against `test/fixtures/app-state-0.3.0.json` (captured from app 0.3.0 `--mock`).
  - `companion-module-build` completes and produces `dist/rs6-presets`
  - 0.6.0: `test/e2e-systems.test.js` runs the module against the real Control Center app 0.8.0 in `--mock` mode:
    E2 (selection, recall, take, auto take, cue), PixelHue (selection, recall, cut), ATEM (buses, cut, auto, keys,
    aux, macros, FTB) and PTZ (select, hold with keep-alives past the dead-man, stop on release, max hold, iris,
    gain, WB, R gain / B pedestal, presets with names, tally, power, OSD menu). It checks that every request went
    to the app. `test/fixtures/app-sys-0.8.0.json` was captured from that app.
- **Not verified:**
  - **The module has not been loaded into a running Companion instance.**
  - It has not run against a real RS6 or the AW Simulator.
- **Device-side caveats:** these come from the app, so see "Verified vs inferred" in the app README.
  - The **freeze write is inferred**: AWJ §6.1 documents only a read of `freeze`.
  - "Backup active" means the device reports a selected backup slot other than `NONE` (§6.5).
  - Input tally counts `LIVE_<n>` layer and background sources. In AWJ mode it doesn't know whether
    a layer is closed.
- **Memory names and validity come from the app** (0.3.0). Screen and Master memory names are
  documented (AWJ §3.7). Whether a slot is *valid/empty* and multiviewer memory names are **not** in the
  AWJ guide; the app reads them only with its opt-in *memory probe* (inferred paths). Without it, the
  app treats a slot as valid when it has a name or the device reported it loaded.
- The module icon (`companion/icon.png`) and the logo button are the Performance Video LLC play mark;
  the Companion 3 manifest has no icon field, so the icon is referenced from HELP.md.
- Preset tally is the app's tally. In 0.2.0 it follows the device's last-loaded Screen memory per
  destination (AWJ §3.11) and TBAR side (§3.8), so recalls and takes from the RC400T or Web RCS show up.

MIT licensed. See `LICENSE`.

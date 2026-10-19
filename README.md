# companion-module-rs6-presets

A Bitfocus **Companion 3.x** module for the **RS6 Presets** app, which adds Barco E2-style
destination presets to an Analog Way Aquilon RS6. Companion talks to the app over HTTP (default port
8080), and the app talks to the RS6. The module never connects to the Aquilon directly.

Built on `@companion-module/base` ~1.10 (node18 runtime) in plain JavaScript, with no TypeScript build.

![icon](companion/icon.png)

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
| **Variables** | `last_preset_number`, `last_preset_name`, `program_presets`, `selection`, `auto_take`, `device_connected`, `preset_<N>_name`. **New in 0.2.0:** `input_<N>_label`; `<S1>_pgm_memory_number`, `<S1>_pgm_memory_name`, `<S1>_pvw_memory_number` and `<S1>_pvw_memory_name` for every destination; `master_pgm_number`, `master_pgm_name`, `master_pvw_number` and `master_pvw_name`; `<S1>_pgm_layer1` (label of the Program layer-1 source); `live_mode`. **New in 0.3.0:** `screen_mem_<N>_name`, `master_mem_<N>_name`, `mv_mem_<N>_name`, `preset_<N>_summary`, `memories_imported` |
| **Presets** | One button per app preset (recall plus PVW/PGM tally), one per destination (toggle plus selected feedback), TAKE, CUT, AUTO TAKE, and "last recalled" and "last Master" displays. **New:** *Input tally* (one per input: label, PVW green, PGM red, yellow text when unavailable or disabled); *Input freeze* (one per input: toggle, blue when frozen); *Backups* (PRIMARY / BKP 1 / BKP 2 for each input with backups); *Audio inputs mute* and *Audio outputs mute* (one per channel). **0.3.0:** *Master memories*, *Refresh memories*, logo button. Presets regenerate when presets, inputs, channels or labels change. |

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

## Sideload with Companion's developer modules folder

You need Companion 3.x (3.4 or newer recommended) and the RS6 Presets app running somewhere on the
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
   **cog / Advanced settings**, and set **Developer modules path** to `~/companion-dev-modules`. Companion
   restarts its module host and picks the module up. It also reloads when files there change.
4. In the Companion web UI, go to **Connections › Add connection**, search for **"RS6 Presets"**
   (manufacturer Analog Way), and add it.
5. Set **App host/IP** to the Mac running the RS6 Presets app (`127.0.0.1` if it's the same machine) and
   **App port** to `8080`.
6. Drag buttons from **Presets › rs6-presets**: Presets, Destinations and Transitions.

On a headless or Pi install, pass `--extra-module-path /path/to/companion-dev-modules` to the
Companion binary instead of using the launcher. Check the docs for your Companion version, since the
flag name has changed between releases.

## Develop

```bash
npm install
npm test              # 18 unit + wiring tests (stubbed Companion host, fake app server with long-poll)
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

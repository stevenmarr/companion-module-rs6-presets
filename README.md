# companion-module-rs6-presets

A Bitfocus **Companion 3.x** module for the **RS6 Presets** app, which adds Barco E2-style
destination presets to an Analog Way Aquilon RS6. Companion talks to the app over HTTP (default port
8080), and the app talks to the RS6. The module never connects to the Aquilon directly.

Built on `@companion-module/base` ~1.10 (node18 runtime) in plain JavaScript, with no TypeScript build.

## What you get

| Kind | Items |
|---|---|
| **Config** | App host/IP, app port (8080), poll interval (300 ms) |
| **Actions** | Recall preset N to Preview · TAKE · CUT · Toggle destination (S1…, A1…) · Auto take (toggle/on/off) |
| **Feedbacks** | Preset on Preview (green) · Preset on Program (red), each with an optional "partial" match · Destination selected (amber) · Auto take ON · App connected to the RS6 |
| **Variables** | `last_preset_number`, `last_preset_name`, `program_presets`, `selection`, `auto_take`, `device_connected`, and `preset_<N>_name` for every preset |
| **Presets** | One button per app preset (recall plus PVW/PGM tally), one per destination (toggle plus selected feedback), TAKE, CUT, AUTO TAKE, and a "last recalled" display. They regenerate when presets are added or renamed in the app. |

The module polls `GET /api/state` on the app. Actions call the app's HTTP API (see the app README).

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
npm test              # unit + wiring tests (stubbed Companion host, fake app server)
npm run package       # companion-module-build -> pkg/ and pkg.tgz
```

## Notes

- Tally comes from the app's own record of what *it* recalled, took and cut. Actions done on the RC400T
  or Web RCS aren't reflected. See "Limitations" in the app README.
- So far the module has been checked by unit tests and by a wiring test that loads it with a stubbed
  `@companion-module/base` and drives it against the live mock app. **It has not yet been loaded into
  a running Companion instance.** `companion-module-build` completes without errors.

MIT licensed. See `LICENSE`.

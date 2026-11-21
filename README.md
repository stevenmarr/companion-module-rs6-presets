# Performance Video Control Center (Companion module)

A Bitfocus **Companion** module for the **Performance Video Control Center** app. It puts Control Center on your
Stream Decks: the buttons and pages you build in Control Center, and the live deck pages Control Center draws (HOME,
PTZ, ATEM, CONSOLE) with the + / + XL knobs and touch strips. **Every command goes through Control Center's HTTP API**
(default port 8080); the module never connects to a device.

Module id `pvllc-control-center`, shortname `pvcc`, npm name `companion-module-pvllc-control-center`. It needs
Companion with the layered button editor (module-base 2.2, the PV Companion fork on `feat/lcars-gui`, which ships the
module built in). Plain JavaScript on `@companion-module/base` ~2.2 (node22 runtime), no build step.

![icon](companion/icon.png)

## New in 0.14.0: Control Center only

- **Presets are Control Center presets only:** **CC deck: ...** (the live deck pages, knobs and touch strips) and
  **CC buttons / CC page: ...** (the BUTTONS / PAGES library). The older per-system preset sections and their
  setting are gone.
- **Nothing breaks.** Every action, feedback and variable id is unchanged, so buttons you already placed keep
  working. An upgrade script drops the removed setting from existing connections.
- Names, descriptions and help say Control Center throughout.

## What you get

| Kind | Items |
|---|---|
| **Config** | Control Center host / IP and port (8080) · Updates: long-poll (default) or poll only · poll interval (300 ms) · E2 / PixelHue / ATEM / PTZ on / off · **Control Center deck pages for** (Stream Deck sizes, default + XL) · PTZ max hold (20 s) |
| **Presets** | **CC deck: <deck> (whole deck, follows HOME and page keys)**, **CC deck: <deck> · <page>**, **CC deck: touch-strip displays and knobs**, **CC buttons**, **CC page: <name> (<surface>)** |
| **Control Center actions** | `cc_button_run` (run a CC button: press / release / hold / turn / push / touch, knob delta), `cc_deck_key`, `cc_deck_dial`, `cc_dial_widget` |
| **Control Center feedbacks** | `cc_button_look`, `cc_deck_look`, `cc_dial_look` (text and colours from Control Center), `cc_pages_refresh` (internal) |
| **System actions and feedbacks** | Everything Control Center drives, for your own buttons: Analog Way Aquilon RS6 (preset recall, memories, TAKE / CUT, destinations, auto take, freeze, backups, audio mute), E2 / PixelHue (`e2_…`, `pixelhue_…`), ATEM (`atem_…`) and Panasonic PTZ (`ptz_…`, hold-to-run with stop on release, knob actions). See `companion/HELP.md`. |
| **Variables** | `cc_buttons_rev`, `cc_button_count`, `cc_page_count`, `cc_strip_<deck>_<n>`, `cc_dial_<dial>`, `cc_deck_<deck>_page`, `app_version`, `show_name`, plus each system's status variables |

### How it stays up to date

- **CC buttons and pages:** the module checks Control Center's buttons revision every 3 s. An edit in Control Center,
  or **SYNC TO COMPANION** on its COMPANION tab, republishes the presets and dropdowns. The module reports its version,
  revision and preset counts to that tab.
- **Deck pages:** long-poll on `GET /api/companion/deck`; a new value updates feedbacks and variables, a new page set
  republishes the presets.
- **System state:** long-poll on `GET /api/state?since=<rev>` and `GET /api/sys?since=<rev>&views=all`, falling back
  to polling every *poll interval*.

## Install

**PV Companion** has this module built in; nothing to install.

**Stock Companion 4.x / 5.x on a Mac** (one line):

```bash
curl -fsSL https://github.com/stevenmarr/companion-module-rs6-presets/releases/latest/download/install-companion-module.sh | bash
```

The script ([install-companion-module.sh](install-companion-module.sh), also attached to every release) downloads
`pvllc-control-center.tgz`, checks it, saves it under `~/companion-modules/pvllc-control-center/` and opens
Companion's Modules page. It never uses sudo. Options (`| bash -s -- --dev`): `--version vX.Y.Z`, `--file <.tgz>`,
`--dev`, `--restart`, `--no-open`.

Then in Companion:
1. **Modules › Import module package**, choose the `.tgz` the script printed (Cmd+Shift+G to paste the path).
2. **New connection:** Connections › **+ Add connection**, search **Control Center** (Performance Video), set the
   host / IP of the Mac running Control Center (`127.0.0.1` on the same Mac) and port `8080`.
   **Existing connection:** click the **pencil** next to the module version, pick the new version, **Save**.
3. Drag buttons from **Buttons › Presets › Performance Video Control Center**, or download pages from Control
   Center's COMPANION tab and import them.

**Developer modules path** (development): put this folder (after `npm install`) in a dev-modules folder and point
Companion's **Developer modules path** at it.

## Module id and repository name

The module id is `pvllc-control-center`. `companion/manifest.json` still lists `legacyIds: ["rs6-presets"]` and the
GitHub repository still has its first name, `companion-module-rs6-presets`. Both are internal only: Companion uses the
legacy id to move connections made with the module's first release (0.10.0) onto this module, keeping their buttons.
Do not remove it. The reason is also written in `src/main.js` (JSON has no comments).

## Develop

```bash
npm ci
npm test              # unit, wiring and upgrade tests; end-to-end runs when a Control Center checkout is found
npm run package       # companion-module-build -> pvllc-control-center-<version>.tgz
```

The end-to-end tests start the Control Center app in `--mock` mode from `RS6_APP_DIR` (or a sibling checkout) and
skip when it is not there. Every other test is hermetic: no network beyond 127.0.0.1 fakes, no child processes.

MIT licensed. See `LICENSE`.

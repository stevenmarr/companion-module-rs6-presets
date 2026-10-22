## PV Control Center

![Performance Video](icon.png)

Controls the **PV Control Center** app (formerly RS6 Presets): Analog Way Aquilon RS6 presets, Barco E2,
PixelHue, Blackmagic ATEM and Panasonic PTZ cameras. **Every command goes through the app** (default port
8080); this module never talks to a device. Remove any direct E2 / ATEM / Panasonic connections from
Companion once your buttons use this module, so there is one path to each device.

### E2, PixelHue, ATEM and PTZ (new in 0.6.0, needs Control Center app 0.8.0 / API 8)

The module checks `GET /api/version` for the `sysLongpoll`, `sysViews` and `companionGateway` features and
then follows the app's multi-system long-poll (`GET /api/sys?since=<rev>&views=all`). With an older app the
RS6 buttons keep working and the log says to update the app. Config: **E2 / PixelHue / ATEM / PTZ** on/off
and **PTZ max hold** (a held motion button stops by itself after this long, default 20 s).

**E2 / PixelHue** (`e2_…`, `pixelhue_…`): recall preset by tile to Preview or Program, TAKE, CUT, toggle
destination, select destinations, auto take, refresh; E2 also cue play/pause/stop and freeze. Feedbacks:
preset on Preview/Program, destination selected, auto take, connected. Variables: tile names, last preset,
selection, per-destination Program/Preview preset names.

**ATEM** (`atem_…`): Program / Preview source, CUT, AUTO, fade to black (+ rate), transition style, mix rate,
upstream keys on air / tie, downstream keys on air / tie / auto, aux sources, macro run / stop. Feedbacks:
source on Program / Preview, key states, aux source, macro running, FTB, transition running, style.
Variables: Program / Preview names, style, mix rate, FTB, aux sources, input and macro names.

**Panasonic PTZ** (`ptz_…`): select camera; pan/tilt (8 directions or a signed proportional speed), zoom and
focus **while held**: put the move on the button's press and **PTZ: stop** on its release (the button presets
do this). While held the module re-arms the app's dead-man every 0.5 s; if the release is lost, the
connection drops or Companion stops, the camera stops (max hold, or the app's 1.5 s dead-man). ALL STOP,
session speeds, preset recall (with speed) / store (with name), power, red / green tally, and the camera's
full command set from the app's catalog (the bitfocus Panasonic PTZ module's aw_ptz / aw_cam commands plus the
AW-UE150 interface spec): one-shot commands (AWB, ABB, one-touch AF, home, OSD menu keys, step up/down),
on/off settings (AF, auto iris, super gain, detail, colour bars, OSD menu …), list settings (gain, ND,
shutter, WB mode, scene, gamma / knee / matrix type …, set or step up/down) and levels (iris, R/B gain,
R/G/B/master pedestal, detail, gamma, knee, matrix, chroma, colour temperature: set, up, down, centre).
Use "Selected camera" to drive whichever camera is selected. Feedbacks: selected, tally, power, online,
moving, last preset, error, any on/off setting, any setting value. Variables per camera (`ptz_<id>_…` and
`ptz_sel_…` for the selected one): name, model, power, tally, pan/tilt/zoom/focus, iris, gain, shutter, ND,
WB, scene, last preset and preset names.

**Button looks:** each system has its own family colour (E2 lime, PixelHue rose, ATEM gold, PTZ indigo),
the same 72×72 tech-look backgrounds and fixed text size 14 as the RS6 buttons; TAKE / CUT stay red.

### RS6

**Config:** the app's host/IP and port, the update mode (long-poll by default, poll only as an option) and the poll interval.

**Actions:**
- Recall preset to Preview (dropdown of the app's presets, including combined presets, e.g. `10 Panel Master + MV (M:3 S4:30 MV1:2)`)
- Load Screen memory to a destination, Load Master memory, Load Multiviewer memory (dropdowns of the memories the app imported from the RS6, with names)
- Refresh memories from the RS6
- TAKE and CUT
- Toggle destination
- Auto take (toggle, on or off)
- Input freeze
- Backup: select primary, backup 1 or backup 2 for an input, a background set (written `S1/2`) or a
  backup group
- Backup: automatic or manual mode
- Audio channel mute

**Feedbacks:**
- Preset on Preview (green) and preset on Program (red)
- Destination selected (amber)
- Auto take on
- App connected to the RS6
- **Input on Program (red)** and **Input on Preview (green)**, taken from the device, with an input
  dropdown built from the device's labels
- Destination last Screen memory is X
- Last Master memory is X
- Input frozen
- Input unavailable or disabled
- Backup active
- Audio channel muted

**Variables:** `$(rs6presets:last_preset_number)`, `$(rs6presets:last_preset_name)`,
`$(rs6presets:program_presets)`, `$(rs6presets:selection)`, `$(rs6presets:auto_take)`,
`$(rs6presets:device_connected)`, and `$(rs6presets:preset_N_name)` for each tile (1 to the app's tile count, or the highest used; "N (empty)" for an empty tile). Swapping or moving tiles in the app (0.4.0) swaps the numbers, so buttons follow the tile. `$(rs6presets:backup_group_G_name)` holds each backup group's device name.
New in 0.5.0: the tiles follow the app's tile count (24/48/72/96), with button presets in pages of 24.
`$(rs6presets:app_version)`, `$(rs6presets:app_api_version)`, `$(rs6presets:show_name)` and `$(rs6presets:tile_count)`
are new. If the app version doesn't match, the connection shows a warning and the log says what to update.
**Upgrading:** import the new package, then click the pencil next to the version on the connection and pick
the new version. The connection and its buttons are kept.
New in 0.2.0:
- `$(rs6presets:input_N_label)`
- `$(rs6presets:S1_pgm_memory_number)` and `_name`, with the matching `pvw` versions
- `$(rs6presets:master_pgm_number)` and `_name`, with the matching `pvw` versions
- `$(rs6presets:S1_pgm_layer1)`
- `$(rs6presets:live_mode)`

New in 0.3.0:
- `$(rs6presets:screen_mem_N_name)` and `$(rs6presets:master_mem_N_name)` for each named memory
- `$(rs6presets:mv_mem_N_name)` (only with the app's memory probe on)
- `$(rs6presets:preset_N_summary)`, e.g. `M:3 S4:30 MV1:2`
- `$(rs6presets:memories_imported)`

**Presets:** one button per app preset, which recalls it, shows its name (from
`$(rs6presets:preset_N_name)`; the number if it has no name) and shows PVW/PGM tally, plus destination
toggles, TAKE and CUT (with their target screens on a second line), and Auto take. Also: Input tally and Input freeze buttons for each input,
Backup buttons, an Audio mute button for each channel, and (0.3.0) Master memory buttons (showing the memory name), Refresh memories and a logo button. They regenerate when presets are added
or renamed in the app.

With RS6 Presets app 0.2.0 or later, tally and status come from the device itself (AWJ
subscriptions), so changes made on the RC400T or the Web RCS show up. The freeze write is inferred,
because the AWJ guide documents only a read of it.

Memory import and combined presets need RS6 Presets app 0.3.0 or later. Memory names are documented
(AWJ §3.7); memory validity and multiviewer memory names are inferred and only read when the app's
memory probe is enabled.

**Install** (macOS): `curl -fsSL https://github.com/stevenmarr/companion-module-rs6-presets/releases/latest/download/install-companion-module.sh | bash`,
then **Modules › Import module package** and choose the `.tgz` it prints.

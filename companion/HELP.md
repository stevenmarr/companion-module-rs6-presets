## RS6 Presets

![Performance Video](icon.png)

Controls the **RS6 Presets** web app, which gives an Analog Way Aquilon RS6 Barco E2-style
destination presets. Companion talks to the app (default port 8080), and the app talks to the RS6.

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

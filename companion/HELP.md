## RS6 Presets

Controls the **RS6 Presets** web app, which gives an Analog Way Aquilon RS6 Barco E2-style
destination presets. Companion talks to the app (default port 8080), and the app talks to the RS6.

**Config:** the app's host/IP and port, the update mode (long-poll by default, poll only as an option) and the poll interval.

**Actions:**
- Recall preset to Preview
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
`$(rs6presets:device_connected)`, and `$(rs6presets:preset_N_name)` for each preset.
New in 0.2.0:
- `$(rs6presets:input_N_label)`
- `$(rs6presets:S1_pgm_memory_number)` and `_name`, with the matching `pvw` versions
- `$(rs6presets:master_pgm_number)` and `_name`, with the matching `pvw` versions
- `$(rs6presets:S1_pgm_layer1)`
- `$(rs6presets:live_mode)`

**Presets:** one button per app preset, which recalls it and shows PVW/PGM tally, plus destination
toggles, TAKE, CUT and Auto take. Also: Input tally and Input freeze buttons for each input,
Backup buttons, and an Audio mute button for each channel. They regenerate when presets are added
or renamed in the app.

With RS6 Presets app 0.2.0 or later, tally and status come from the device itself (AWJ
subscriptions), so changes made on the RC400T or the Web RCS show up. The freeze write is inferred,
because the AWJ guide documents only a read of it.

## RS6 Presets

Controls the **RS6 Presets** web app, which gives an Analog Way Aquilon RS6 Barco E2-style
destination presets. Companion talks to the app (default port 8080), and the app talks to the RS6.

**Config:** the app's host/IP and port, plus the poll interval.

**Actions:** Recall preset to Preview, TAKE, CUT, Toggle destination, Auto take (toggle/on/off).

**Feedbacks:** preset on Preview (green), preset on Program (red), destination selected (amber),
auto take on, app connected to the RS6.

**Variables:** `$(rs6presets:last_preset_number)`, `$(rs6presets:last_preset_name)`,
`$(rs6presets:program_presets)`, `$(rs6presets:selection)`, `$(rs6presets:auto_take)`,
`$(rs6presets:device_connected)`, and `$(rs6presets:preset_N_name)` for each preset.

**Presets:** one button per app preset, which recalls it and shows PVW/PGM tally, plus destination
toggles, TAKE, CUT and Auto take. They regenerate when presets are added or renamed in the app.

Tally is the app's own record of what it recalled and took. Anything done on the RC400T or the
Web RCS is not seen by it.

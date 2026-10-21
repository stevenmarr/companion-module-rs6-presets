#!/usr/bin/env bash
# Install the RS6 Presets Companion module on macOS.
#
#   curl -fsSL https://github.com/stevenmarr/companion-module-rs6-presets/releases/latest/download/install-companion-module.sh | bash
#
# Companion 4.x / 5.x (official way for a module that is not in the store): the script downloads the
# module package (.tgz) to ~/companion-modules/rs6-presets/ and opens Companion's Modules page, where you
# click "Import module package" and pick that file. Companion 3.x has no package import, so there the
# script unpacks the module for the "Developer modules path" setting instead (also available with --dev).
#
# Options (with curl | bash, pass them as: ... | bash -s -- --dev):
#   --version vX.Y.Z   install that release instead of the latest
#   --file PATH        use a local .tgz package or release .zip instead of downloading
#   --dev              also unpack for Companion's Developer modules path (~/companion-modules/dev)
#   --no-open          don't open Companion / Finder
#   --restart          quit and reopen Companion afterwards (not needed for a package import)
#   --dir PATH         install folder (default ~/companion-modules/rs6-presets)
#
# Safe to run again: it only writes inside the install folder, never uses sudo, and leaves Companion's
# own data alone (Companion copies an imported package into its own modules folder itself).
set -euo pipefail

REPO="stevenmarr/companion-module-rs6-presets"
ASSET="companion-module-rs6-presets.tgz"
DIR="${HOME}/companion-modules/rs6-presets"
VERSION="" FILE="" DEV=0 OPEN=1 RESTART=0

die() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
hd()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --dev) DEV=1; shift ;;
    --no-open) OPEN=0; shift ;;
    --restart) RESTART=1; shift ;;
    -h|--help) sed -n '2,24p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] && die "don't run this with sudo; it only writes to your home folder."
[ "$(uname -s)" = "Darwin" ] || say "Note: written for macOS; continuing anyway."
command -v curl >/dev/null || die "curl is required"
command -v tar  >/dev/null || die "tar is required"

# Companion version (from the app bundle), to pick the install method.
APP="/Applications/Companion.app"
CVER=""
if [ -d "$APP" ] && command -v defaults >/dev/null; then CVER="$(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)"; fi
CMAJOR="${CVER%%.*}"
if [ -n "$CVER" ] && [ "${CMAJOR:-0}" -lt 4 ] 2>/dev/null; then DEV=1; fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rs6mod.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DIR"

# ---- get the package ----
PKG="$TMP/$ASSET"
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "no such file: $FILE"
  case "$FILE" in
    *.tgz|*.tar.gz) cp "$FILE" "$PKG" ;;
    *.zip)
      command -v unzip >/dev/null || die "unzip is required for a .zip"
      unzip -q "$FILE" -d "$TMP/zip"
      D="$(find "$TMP/zip" -type d -path '*/dist/rs6-presets' | head -n 1)"
      [ -n "$D" ] || die "$FILE has no dist/rs6-presets folder (use the release zip or the .tgz)"
      mkdir -p "$TMP/build" && cp -R "$D" "$TMP/build/pkg"
      (cd "$TMP/build" && tar -czf "$PKG" pkg) ;;
    *) die "--file must be a .tgz package or a release .zip" ;;
  esac
  say "Using local file $FILE"
else
  if [ -n "$VERSION" ]; then URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
  else URL="https://github.com/$REPO/releases/latest/download/$ASSET"; fi
  say "Downloading $URL"
  curl -fsSL --retry 2 -o "$PKG" "$URL" || die "download failed ($URL)"
fi

# ---- check it is a Companion module package ----
tar -tzf "$PKG" >/dev/null 2>&1 || die "not a valid .tgz package"
tar -xzf "$PKG" -C "$TMP" pkg/companion/manifest.json 2>/dev/null || die "package has no pkg/companion/manifest.json"
MANIFEST="$TMP/pkg/companion/manifest.json"
grep -q '"id": *"rs6-presets"' "$MANIFEST" || die "this package is not the rs6-presets module"
MVER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
[ -n "$MVER" ] || die "could not read the module version"

TGZ="$DIR/companion-module-rs6-presets-$MVER.tgz"
if [ -f "$TGZ" ] && cmp -s "$PKG" "$TGZ"; then say "Package $MVER is already in $DIR (unchanged)."
else cp "$PKG" "$TGZ.part" && mv -f "$TGZ.part" "$TGZ"; say "Saved $TGZ"; fi
ln -sfn "$(basename "$TGZ")" "$DIR/companion-module-rs6-presets-latest.tgz"

# ---- optional: Developer modules path ----
DEVROOT="$(dirname "$DIR")/dev"
if [ "$DEV" -eq 1 ]; then
  mkdir -p "$DEVROOT"
  rm -rf "$TMP/dev" && mkdir -p "$TMP/dev" && tar -xzf "$PKG" -C "$TMP/dev"
  rm -rf "$DEVROOT/rs6-presets.old"
  [ -d "$DEVROOT/rs6-presets" ] && mv "$DEVROOT/rs6-presets" "$DEVROOT/rs6-presets.old"
  mv "$TMP/dev/pkg" "$DEVROOT/rs6-presets" && rm -rf "$DEVROOT/rs6-presets.old"
  say "Unpacked $MVER to $DEVROOT/rs6-presets"
fi

# ---- already imported? (Companion keeps imported versions in its own modules folder) ----
CMODS="$HOME/Library/Application Support/companion/modules"
HAVE="$(ls -1 "$CMODS" 2>/dev/null | grep -E '^rs6-presets-' | sed 's/^rs6-presets-//' | tr '\n' ' ' || true)"

# Companion's web UI port (from the running process, else the default 8000)
PORT="$(ps -axo command 2>/dev/null | sed -n 's/.*Companion.app.*--admin-port=\([0-9]*\).*/\1/p' | head -n 1)"; PORT="${PORT:-8000}"
UI="http://127.0.0.1:$PORT"

hd "RS6 Presets Companion module $MVER is ready${CVER:+ (Companion $CVER found)}"
if [ -n "$HAVE" ]; then say "Companion already has rs6-presets version(s): $HAVE"; fi
if [ "${CMAJOR:-4}" -ge 4 ] 2>/dev/null || [ -z "$CVER" ]; then
  hd "Do this in Companion ($UI):"
  say "  1. Modules (left sidebar) > Import module package > choose:"
  say "       $TGZ"
  say "     (in the file dialog press Cmd+Shift+G and paste that path; do not unzip the .tgz)"
  say "  2. New connection: Connections > + Add connection > search \"rs6-presets\" (Analog Way) >"
  say "     version $MVER > set App host/IP (127.0.0.1 if the RS6 Presets app runs on this Mac) and port 8080."
  say "     Existing connection: open it, click the pencil next to the module version, pick $MVER, Save."
  say "  3. Buttons: your existing buttons and the connection settings are kept (the module id never changes)."
  say "     New button presets: Buttons > Presets > rs6-presets. No Companion restart is needed."
  if [ -n "$HAVE" ]; then
    say ""
    say "  Upgrading: importing adds $MVER next to the old version(s). Your connection keeps using the old one"
    say "  until you click the pencil next to its version and choose $MVER."
  fi
fi
if [ "$DEV" -eq 1 ]; then
  hd "Developer modules path (Companion 3.x, or instead of importing):"
  say "  Set it to:  $DEVROOT"
  say "  Companion 4.1+/5.x: Companion launcher window > cog > Settings > Developer modules path."
  say "  Companion 3.x/4.0:  launcher window > cog > 'Developer modules path' field."
  say "  Then restart Companion (or use --restart). The module shows up under Connections."
  say "  Use only one method: a dev-path module and an imported package with the same id can be confusing."
fi

if [ "$OPEN" -eq 1 ] && command -v open >/dev/null; then
  open -R "$TGZ" 2>/dev/null || true
  if pgrep -f "Companion.app/Contents/Resources/main.js" >/dev/null 2>&1; then open "$UI/modules" 2>/dev/null || true
  else say ""; say "Companion is not running: start it, then open $UI/modules"; fi
fi

if [ "$RESTART" -eq 1 ]; then
  hd "Restarting Companion"
  osascript -e 'tell application "Companion" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pgrep -f "Companion.app/Contents/Resources/main.js" >/dev/null 2>&1 || break; sleep 0.5; done
  open -a Companion || say "Could not reopen Companion; start it from Applications."
fi
say ""

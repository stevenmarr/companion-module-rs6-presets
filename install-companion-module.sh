#!/usr/bin/env bash
# Install the Performance Video Control Center Companion module on macOS.
#
#   curl -fsSL https://github.com/stevenmarr/companion-module-rs6-presets/releases/latest/download/install-companion-module.sh | bash
#
# Companion 4.x / 5.x (official way for a module that is not in the store): the script downloads the
# module package (.tgz) to ~/companion-modules/pvllc-control-center/ and opens Companion's Modules page, where you
# click "Import module package" and pick that file. Companion 3.x has no package import, so there the
# script unpacks the module for the "Developer modules path" setting instead (also available with --dev).
#
# Options (with curl | bash, pass them as: ... | bash -s -- --dev):
#   --version vX.Y.Z   install that release instead of the latest
#   --file PATH        use a local .tgz package or release .zip instead of downloading
#   --dev              also unpack for Companion's Developer modules path (~/companion-modules/dev)
#   --no-open          don't open Companion / Finder
#   --restart          quit and reopen Companion afterwards (not needed for a package import)
#   --dir PATH         install folder (default ~/companion-modules/pvllc-control-center)
#
# Safe to run again: it only writes inside the install folder, never uses sudo, and leaves Companion's
# own data alone (Companion copies an imported package into its own modules folder itself).
set -euo pipefail

# GitHub redirects the old repo name if the repo is renamed, so this keeps working either way.
REPO="stevenmarr/companion-module-rs6-presets"
ID="pvllc-control-center"
ASSET="pvllc-control-center.tgz"
OLD_ASSET="companion-module-rs6-presets.tgz"   # asset name of releases before v0.11.0 (--version v0.10.0 etc.)
DIR="${HOME}/companion-modules/${ID}"
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

TMP="$(mktemp -d "${TMPDIR:-/tmp}/pvccmod.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
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
      D="$(find "$TMP/zip" -type d \( -path "*/dist/$ID" -o -path '*/dist/rs6-presets' \) | head -n 1)"
      [ -n "$D" ] || die "$FILE has no dist/$ID folder (use the release zip or the .tgz)"
      mkdir -p "$TMP/build" && cp -R "$D" "$TMP/build/pkg"
      (cd "$TMP/build" && tar -czf "$PKG" pkg) ;;
    *) die "--file must be a .tgz package or a release .zip" ;;
  esac
  say "Using local file $FILE"
else
  if [ -n "$VERSION" ]; then BASE="https://github.com/$REPO/releases/download/$VERSION"
  else BASE="https://github.com/$REPO/releases/latest/download"; fi
  say "Downloading $BASE/$ASSET"
  if ! curl -fsSL --retry 2 -o "$PKG" "$BASE/$ASSET"; then
    say "Not found; trying the pre-0.11.0 asset name $OLD_ASSET"
    curl -fsSL --retry 2 -o "$PKG" "$BASE/$OLD_ASSET" || die "download failed ($BASE/$ASSET)"
  fi
fi

# ---- check it is a Companion module package ----
tar -tzf "$PKG" >/dev/null 2>&1 || die "not a valid .tgz package"
tar -xzf "$PKG" -C "$TMP" pkg/companion/manifest.json 2>/dev/null || die "package has no pkg/companion/manifest.json"
MANIFEST="$TMP/pkg/companion/manifest.json"
grep -Eq '"id": *"(pvllc-control-center|rs6-presets)"' "$MANIFEST" || die "this package is not the Control Center module"
MVER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n 1)"
[ -n "$MVER" ] || die "could not read the module version"

TGZ="$DIR/$ID-$MVER.tgz"
if [ -f "$TGZ" ] && cmp -s "$PKG" "$TGZ"; then say "Package $MVER is already in $DIR (unchanged)."
else cp "$PKG" "$TGZ.part" && mv -f "$TGZ.part" "$TGZ"; say "Saved $TGZ"; fi
ln -sfn "$(basename "$TGZ")" "$DIR/$ID-latest.tgz"

# ---- optional: Developer modules path ----
DEVROOT="$(dirname "$DIR")/dev"
if [ "$DEV" -eq 1 ]; then
  mkdir -p "$DEVROOT"
  rm -rf "$TMP/dev" && mkdir -p "$TMP/dev" && tar -xzf "$PKG" -C "$TMP/dev"
  rm -rf "$DEVROOT/$ID.old"
  [ -d "$DEVROOT/$ID" ] && mv "$DEVROOT/$ID" "$DEVROOT/$ID.old"
  mv "$TMP/dev/pkg" "$DEVROOT/$ID" && rm -rf "$DEVROOT/$ID.old"
  say "Unpacked $MVER to $DEVROOT/$ID"
  if [ -d "$DEVROOT/rs6-presets" ]; then say "Note: $DEVROOT/rs6-presets is the old module; remove it so only one copy loads."; fi
fi

# ---- already imported? (Companion keeps imported versions in its own modules folder) ----
CMODS="$HOME/Library/Application Support/companion/modules"
HAVE="$(ls -1 "$CMODS" 2>/dev/null | grep -E "^$ID-" | sed "s/^$ID-//" | tr '\n' ' ' || true)"
OLDHAVE="$(ls -1 "$CMODS" 2>/dev/null | grep -E '^rs6-presets-' | sed 's/^rs6-presets-//' | tr '\n' ' ' || true)"

# Companion's web UI port (from the running process, else the default 8000)
PORT="$(ps -axo command 2>/dev/null | sed -n 's/.*Companion.app.*--admin-port=\([0-9]*\).*/\1/p' | head -n 1)"; PORT="${PORT:-8000}"
UI="http://127.0.0.1:$PORT"

hd "Control Center Companion module $MVER is ready${CVER:+ (Companion $CVER found)}"
if [ -n "$HAVE" ]; then say "Companion already has $ID version(s): $HAVE"; fi
if [ -n "$OLDHAVE" ]; then say "Companion also has the old rs6-presets module ($OLDHAVE). Its connections move to $ID when you pick $MVER; remove the old versions on the Modules page afterwards."; fi
if [ "${CMAJOR:-4}" -ge 4 ] 2>/dev/null || [ -z "$CVER" ]; then
  hd "Do this in Companion ($UI):"
  say "  1. Modules (left sidebar) > Import module package > choose:"
  say "       $TGZ"
  say "     (in the file dialog press Cmd+Shift+G and paste that path; do not unzip the .tgz)"
  say "  2. New connection: Connections > + Add connection > search \"Control Center\" (Performance Video) >"
  say "     version $MVER > set App host/IP (127.0.0.1 if Control Center runs on this Mac) and port 8080."
  say "     Existing connection: open it, click the pencil next to the module version, pick $MVER, Save."
  say "  3. Buttons: existing rs6-presets connections and buttons carry over (the manifest lists rs6-presets as a legacy id)."
  say "     New button presets: Buttons > Presets > Performance Video Control Center. No Companion restart is needed."
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

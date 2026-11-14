#!/bin/bash
# Installs or updates Megatron on an Apple Silicon Mac. Published as a release asset, so it passes
# the same draft review as the app:
#   curl -fsSL https://github.com/Megatron-HQ/Megatron/releases/latest/download/install.sh | bash
# curl doesn't quarantine what it downloads, so the ad-hoc signed app opens without Gatekeeper's
# "could not verify" wall. Stock macOS tools only: this runs before anything else is installed.
set -euo pipefail

REPO_URL='https://github.com/Megatron-HQ/Megatron/releases'
BUNDLE_ID='com.megatron.app'
INSTALL_COMMAND="curl -fsSL $REPO_URL/latest/download/install.sh | bash"

die() {
  printf 'Megatron install: %s\n' "$*" >&2
  exit 1
}

plist_value() {
  /usr/bin/plutil -extract "$2" raw -o - "$1/Contents/Info.plist" 2>/dev/null || true
}

# Homebrew records every cask it manages under Caskroom, whatever --appdir it installed to.
homebrew_manages_megatron() {
  local caskroom
  for caskroom in /opt/homebrew/Caskroom /usr/local/Caskroom; do
    [ -d "$caskroom/megatron" ] && return 0
  done
  command -v brew >/dev/null 2>&1 && [ -d "$(brew --caskroom 2>/dev/null)/megatron" ]
}

# Matches the app and its helpers by executable path, so a copy elsewhere on disk doesn't count.
megatron_running() {
  local line
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in "$1"/Contents/*) return 0 ;; esac
  done < <(/bin/ps -axo command=)
  return 1
}

require_quit() {
  if megatron_running "$1"; then die "Quit Megatron, then run this again."; fi
}

cleanup() {
  if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR" || true; fi
  if [ -n "$STAGED" ]; then rm -rf "$STAGED" || true; fi
  # After a swap the old copy is aside: delete it, or put it back if the new one never landed.
  if [ -n "$OLD" ] && [ -e "$OLD" ]; then
    if [ -e "$TARGET" ]; then rm -rf "$OLD" || true; else mv "$OLD" "$TARGET"; fi
  fi
}

# Everything runs from here, called on the last line: if `curl | bash` is cut off mid-download,
# bash never reaches the call and nothing runs.
main() {
  WORK_DIR='' STAGED='' OLD='' TARGET=''
  trap cleanup EXIT

  if [ "$(uname -s)" != Darwin ]; then
    die "this installer is for macOS. Windows builds are at $REPO_URL."
  fi
  # hw.optional.arm64, not uname -m: a shell running under Rosetta reports x86_64 on Apple Silicon.
  if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" != 1 ]; then
    die "Megatron needs an Apple Silicon Mac; no Intel build ships."
  fi

  if homebrew_manages_megatron; then
    die "Homebrew manages this Megatron install. Update it with: brew upgrade --cask megatron"
  fi

  local dir
  for dir in /Applications "$HOME/Applications"; do
    if [ -e "$dir/Megatron.app" ]; then
      TARGET="$dir/Megatron.app"
      break
    fi
  done
  if [ -n "$TARGET" ]; then
    if [ "$(plist_value "$TARGET" CFBundleIdentifier)" != "$BUNDLE_ID" ]; then
      die "$TARGET is a different app. Move it, then run this again."
    fi
    if [ ! -w "$TARGET" ] || [ ! -w "$(dirname "$TARGET")" ]; then
      die "$TARGET belongs to another account, so this one can't replace it. Ask its owner to delete it, then run this again."
    fi
  elif [ -w /Applications ]; then
    TARGET=/Applications/Megatron.app
  else
    mkdir -p "$HOME/Applications"
    TARGET="$HOME/Applications/Megatron.app"
  fi

  WORK_DIR="$(mktemp -d)"
  local feed version zip_name sha512
  local semver='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
  feed="$(curl -fsSL --proto '=https' "$REPO_URL/latest/download/latest-mac.yml")" ||
    die "couldn't reach GitHub to find the latest release."
  # The top-level keys, not the indented files: list. Values become a URL and a file name, so
  # only plain shapes pass.
  version="$(printf '%s\n' "$feed" | sed -n "s/^version: *['\"]\{0,1\}\([^'\"]*\).*/\1/p")"
  zip_name="$(printf '%s\n' "$feed" | sed -n "s/^path: *['\"]\{0,1\}\([^'\"]*\).*/\1/p")"
  sha512="$(printf '%s\n' "$feed" | sed -n "s/^sha512: *['\"]\{0,1\}\([^'\"]*\).*/\1/p")"
  if ! [[ "$version" =~ $semver && "$zip_name" =~ ^[A-Za-z0-9._-]+\.zip$ &&
    "$sha512" =~ ^[A-Za-z0-9+/]+=*$ ]]; then
    die "the release feed is malformed."
  fi

  if [ -e "$TARGET" ] && [ "$(plist_value "$TARGET" CFBundleShortVersionString)" = "$version" ]; then
    echo "Megatron $version is already installed at $TARGET. It's up to date."
    exit 0
  fi
  require_quit "$TARGET"

  echo "Downloading Megatron $version..."
  local zip="$WORK_DIR/$zip_name"
  # The versioned URL, not latest/: a release published mid-run can't swap the file under the hash.
  curl -fL --proto '=https' --progress-bar -o "$zip" "$REPO_URL/download/v$version/$zip_name" ||
    die "the download failed."
  if [ "$(/usr/bin/openssl dgst -sha512 -binary "$zip" | /usr/bin/openssl base64 -A)" != "$sha512" ]; then
    die "the download doesn't match the release's checksum."
  fi

  /usr/bin/ditto -x -k "$zip" "$WORK_DIR/app"
  local app="$WORK_DIR/app/Megatron.app"
  if [ ! -d "$app" ]; then die "the download doesn't contain Megatron.app."; fi
  if ! /usr/bin/codesign --verify --deep --strict "$app" 2>/dev/null; then
    die "the downloaded app's signature doesn't verify."
  fi
  if [ "$(plist_value "$app" CFBundleIdentifier)" != "$BUNDLE_ID" ] ||
    [ "$(plist_value "$app" CFBundleShortVersionString)" != "$version" ]; then
    die "the downloaded app isn't Megatron $version."
  fi

  # Stage beside the target so both renames stay on one volume; checked again here because
  # Megatron could have been opened during the download.
  local parent
  parent="$(dirname "$TARGET")"
  STAGED="$parent/.Megatron.app.installing-$$"
  mv "$app" "$STAGED"
  require_quit "$TARGET"
  if [ -e "$TARGET" ]; then
    OLD="$parent/.Megatron.app.previous-$$"
    mv "$TARGET" "$OLD"
  fi
  mv "$STAGED" "$TARGET"
  STAGED=''
  # Defensive, matching the Homebrew cask: curl sets no quarantine flag, but nothing may add one.
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

  echo "Installed Megatron $version to $TARGET."
  echo "Open it from Launchpad or Spotlight, or run: open '$TARGET'"
  echo "It updates itself from now on. To reinstall later: $INSTALL_COMMAND"
}

main "$@"

# Environment setup quirks

Quirks hit during M0 setup on this machine — not project bugs, but real gotchas a fresh clone can
hit.

## `Error: Electron uninstall` on first `npm run dev`

This machine's npm (11.x) has an install-script allowlist (`npm approve-scripts`, writes an
`allowScripts` block into `package.json`). It silently blocked Electron's own postinstall (which
downloads the Electron binary) on first `npm install` — `npm run dev` failed with `Error: Electron
uninstall`. Fixed via `npm approve-scripts electron`, which wrote a version-pinned `"allowScripts":
{"electron@<version>": true}` into `package.json` (now tracked). Because `package-lock.json` is
committed, everyone resolves the exact same Electron version, so this approval should just work
for a fresh clone — nobody else should need to re-run `npm approve-scripts` unless the Electron
version in `package.json` actually changes (e.g. a deliberate upgrade), in which case re-approve
for the new pinned version. Don't blindly approve every flagged package — only ones you actually
need (we skipped `electron-winstaller`, which is Windows-only and irrelevant to a macOS-only build
target).

## Still seeing it after the approval above

`node_modules/electron`'s `extract-zip`-based install script silently no-op'd once in this
environment (exits 0, extracts nothing, no error) despite the artifact downloading fine to the
local Electron cache. Root cause wasn't pinned down — check first whether
`node_modules/electron/dist/` actually contains an `Electron.app` (mac) / `electron.exe`
(Windows). If it's missing, extract the cached zip manually: the cache lives at
`~/Library/Caches/electron/<hash>/electron-v<version>-<platform>-<arch>.zip` on macOS (use
`unzip`) or `%LOCALAPPDATA%\electron\Cache` on Windows (use `tar -xf` or PowerShell's
`Expand-Archive`), into `node_modules/electron/dist/`, then write
`node_modules/electron/path.txt` with the platform-relative exe path
(`Electron.app/Contents/MacOS/Electron` on macOS, `electron.exe` on Windows). CI now runs on
`windows-latest` too (see below) — if this is a real cross-platform issue rather than a one-off
local quirk, CI should catch it on a clean install before anyone hits it manually.

## CI coverage

CI runs the full `typecheck`/`lint`/`test` suite on both `macos-latest` and `windows-latest`
(packaging/DMG build stays macOS-only, unrelated to catching dev-environment breakage). This
exists specifically because the team develops across both platforms — it's the safety net for
anything platform-specific slipping through.

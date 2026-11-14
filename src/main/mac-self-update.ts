// macOS self-update for the ad-hoc signed build. Squirrel.Mac can't install it: an ad-hoc
// signature's designated requirement is its cdhash, which changes every build, so Squirrel rejects
// every update. electron-updater still downloads and sha512-checks the zip; this module checks the
// extracted app and swaps the bundle in place after the app quits. Every binary is absolute and
// run without a shell, and paths reach the swap script as arguments, never as script text.
import { execFile, spawn } from 'child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { promisify } from 'util'

const run = promisify(execFile)
const BUNDLE_ID = 'com.megatron.app'

export function selfUpdateBlocker(bundlePath: string): string | null {
  if (bundlePath.includes('/AppTranslocation/'))
    return 'macOS is running it from a temporary copy. Move Megatron to your Applications folder and open it from there.'
  for (const path of [bundlePath, dirname(bundlePath)]) {
    try {
      accessSync(path, constants.W_OK)
    } catch (error) {
      // EROFS: a mounted disk image or other read-only volume (verified on macOS 27.2).
      return (error as NodeJS.ErrnoException).code === 'EROFS'
        ? `${path} is on a read-only volume.`
        : `this account can't write to ${path}.`
    }
  }
  return null
}

async function plistValue(app: string, key: string): Promise<string | null> {
  try {
    const plist = join(app, 'Contents', 'Info.plist')
    const { stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
    return stdout.trim()
  } catch {
    return null
  }
}

export async function stageUpdate(
  zipPath: string,
  expectedVersion: string,
  stagingDir: string
): Promise<string> {
  rmSync(stagingDir, { recursive: true, force: true })
  try {
    mkdirSync(stagingDir, { recursive: true })
    try {
      await run('/usr/bin/ditto', ['-x', '-k', zipPath, stagingDir])
    } catch {
      throw new Error("the downloaded update couldn't be unpacked.")
    }
    const app = join(stagingDir, 'Megatron.app')
    if (!existsSync(app)) throw new Error("the downloaded update doesn't contain Megatron.app.")
    try {
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    } catch {
      throw new Error("the downloaded update's signature doesn't verify.")
    }
    if (
      (await plistValue(app, 'CFBundleIdentifier')) !== BUNDLE_ID ||
      (await plistValue(app, 'CFBundleShortVersionString')) !== expectedVersion
    )
      throw new Error(`the downloaded update isn't Megatron ${expectedVersion}.`)
    return app
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
}

// Runs detached so it outlives the app. TERM/HUP are ignored so a logout can't stop it between the
// two renames, which run back to back on one volume; the staged copy moves beside the target first
// because it may live on another volume. On failure the old app goes back and the reason lands in
// the result file for the next launch to show.
const SWAP_SCRIPT = `
trap '' TERM HUP
pid=$1 staged=$2 target=$3 relaunch=$4 result=$5
parent=\${target%/*}
next="$parent/.Megatron.app.installing-$$"
old="$parent/.Megatron.app.previous-$$"
fail() {
  if [ -e "$old" ] && [ ! -e "$target" ]; then /bin/mv "$old" "$target"; fi
  /bin/rm -rf "$next" "$staged"
  printf '%s\\n' "$1" > "$result"
  if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
  exit 1
}
waited=0
while kill -0 "$pid" 2>/dev/null; do
  waited=$((waited + 1))
  if [ "$waited" -gt 600 ]; then fail "Megatron didn't quit within a minute, so the update wasn't installed."; fi
  /bin/sleep 0.1
done
[ -d "$target" ] || fail "Megatron.app moved while the update was waiting to install."
/bin/mv "$staged" "$next" || fail "the update couldn't be copied next to $target."
/bin/mv "$target" "$old" || fail "$target couldn't be replaced."
/bin/mv "$next" "$target" || fail "$target couldn't be replaced."
/bin/rm -rf "$old"
/bin/rm -f "$result"
if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
`

export interface SwapRequest {
  pid: number
  staged: string
  target: string
  relaunch: boolean
  resultFile: string
}

export function scheduleSwap({ pid, staged, target, relaunch, resultFile }: SwapRequest): void {
  spawn(
    '/bin/bash',
    [
      '-c',
      SWAP_SCRIPT,
      'megatron-update',
      String(pid),
      staged,
      target,
      relaunch ? '1' : '0',
      resultFile
    ],
    { detached: true, stdio: 'ignore' }
  ).unref()
}

// Consumed once, so a failure is reported on the launch after it and never again.
export function readSwapResult(resultFile: string): string | null {
  try {
    const text = readFileSync(resultFile, 'utf8').trim()
    rmSync(resultFile, { force: true })
    return text || null
  } catch {
    return null
  }
}

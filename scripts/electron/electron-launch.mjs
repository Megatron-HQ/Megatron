/**
 * Arguments required to make Electron launch reliably in visual checks.
 *
 * `--in-process-gpu` is Windows-only. Some Windows installations can't start
 * Chromium's separate GPU process; folding that work into the main process
 * avoids a startup crash there (added in 09aa164). It has no purpose on macOS
 * or Linux — the GPU process starts fine — and on macOS, where compositing is
 * always GPU-backed, forcing GPU work in-process is a known source of
 * intermittent renderer/compositor stalls in a backgrounded automation window.
 * So it's gated to win32 rather than passed unconditionally.
 *
 * `platform` defaults to `process.platform`; it's a parameter only so the test
 * can exercise both branches. Production call sites pass nothing.
 */
export function visualVerifierLaunchArgs(appEntryPath, userDataDir, platform = process.platform) {
  const args = []
  if (platform === 'win32') args.push('--in-process-gpu')
  args.push(appEntryPath, `--user-data-dir=${userDataDir}`)
  return args
}

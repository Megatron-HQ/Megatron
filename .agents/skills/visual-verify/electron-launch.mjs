/**
 * Arguments required to make Electron launch reliably in visual checks.
 *
 * Some Windows installations cannot start Chromium's separate GPU process.
 * Keeping that work in Electron's main process avoids a startup crash while
 * preserving the renderer that the verifier captures.
 */
export function visualVerifierLaunchArgs(appEntryPath, userDataDir) {
  return ['--in-process-gpu', appEntryPath, `--user-data-dir=${userDataDir}`]
}

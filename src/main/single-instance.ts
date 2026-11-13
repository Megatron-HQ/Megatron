export interface RestorableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
}

// Electron keys the lock on the userData folder, so a second copy on the same data quits instead of
// running its own scans, writes and update downloads against it; a launch with a different
// --user-data-dir (the isolated smoke runs under scripts/) is a separate instance and still starts.
export function claimSingleInstance(
  app: SingleInstanceApp,
  getWindows: () => readonly RestorableWindow[]
): boolean {
  if (!app.requestSingleInstanceLock()) {
    console.info('[app] Megatron is already running with this data folder; focusing that copy')
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    const [window] = getWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  return true
}

import { watchAllowedPath } from './permissions'

const CHANGE_SETTLE_MS = 1_000
const MAX_CHANGE_WAIT_MS = 5_000
const RECONCILE_INTERVAL_MS = 30_000
const IGNORED_PROJECT_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.tmp',
  '.temp',
  '__macosx'
])

export interface InventoryWatchRoot {
  path: string
  kind: 'project' | 'inventory'
}

interface InventoryWatcherOptions {
  getRoots: () => InventoryWatchRoot[]
  refresh: () => Promise<unknown>
  reportError: (error: unknown) => void
  watch?: (
    path: string,
    onChange: (event: string, filename: string | null) => void,
    onError: (error: Error) => void
  ) => { close: () => void }
}

function isRelevantChange(
  root: InventoryWatchRoot,
  event: string,
  filename: string | null
): boolean {
  if (filename === null || root.kind === 'inventory') return true
  const parts = filename
    .split(/[\\/]/)
    .map((part) => (process.platform === 'win32' ? part.toLowerCase() : part))
  const claudeIndex = parts.indexOf('.claude')
  const directories = claudeIndex < 0 ? parts : parts.slice(0, claudeIndex)
  if (directories.some((part) => IGNORED_PROJECT_DIRECTORIES.has(part))) return false
  const gitIndex = directories.indexOf('.git')
  if (gitIndex >= 0) return gitIndex === parts.length - 1 && event === 'rename'
  return event === 'rename' || claudeIndex >= 0
}

export function createInventoryWatcher(options: InventoryWatcherOptions): {
  update: () => void
  close: () => void
} {
  const watch = options.watch ?? watchAllowedPath
  const watchers = new Map<string, { close: () => void }>()
  let closed = false
  let generation = 0
  let dirty = false
  let refreshing = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let maximumWaitTimer: ReturnType<typeof setTimeout> | undefined

  function clearChangeTimers(): void {
    clearTimeout(settleTimer)
    clearTimeout(maximumWaitTimer)
    settleTimer = undefined
    maximumWaitTimer = undefined
  }

  function update(): void {
    if (closed) return
    const currentGeneration = ++generation
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    for (const root of options.getRoots()) {
      if (watchers.has(root.path)) continue
      try {
        const watcher = watch(
          root.path,
          (event, filename) => {
            if (closed || generation !== currentGeneration) return
            if (isRelevantChange(root, event, filename)) schedule()
          },
          (error) => {
            if (closed || generation !== currentGeneration) return
            options.reportError(error)
            schedule()
          }
        )
        watchers.set(root.path, watcher)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR') options.reportError(error)
      }
    }
  }

  function schedule(): void {
    if (closed) return
    dirty = true
    clearTimeout(settleTimer)
    settleTimer = setTimeout(flush, CHANGE_SETTLE_MS)
    maximumWaitTimer ??= setTimeout(flush, MAX_CHANGE_WAIT_MS)
  }

  function flush(): void {
    clearChangeTimers()
    if (closed || !dirty || refreshing) return
    dirty = false
    // Reattach before scanning: atomic file replacements and moved roots can orphan a watch.
    update()
    refreshing = true
    void Promise.resolve()
      .then(() => {
        return closed ? undefined : options.refresh()
      })
      .catch(options.reportError)
      .finally(() => {
        refreshing = false
        if (dirty && !closed) schedule()
      })
  }

  update()
  // Native notifications may be dropped. This also retries missing or inaccessible roots.
  const reconciliationTimer = setInterval(() => {
    dirty = true
    flush()
  }, RECONCILE_INTERVAL_MS)
  reconciliationTimer.unref?.()

  return {
    update,
    close() {
      closed = true
      generation++
      clearInterval(reconciliationTimer)
      clearChangeTimers()
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    }
  }
}

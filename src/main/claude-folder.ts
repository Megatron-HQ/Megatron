import { isAbsolute } from 'path'
import type { ClaudeFolderChoice, ClaudeFolderIssue, ClaudeFolderStatus } from '../shared/ipc'
import {
  activeConfigRoot,
  configDirectoryKey,
  currentConfigDirectory,
  expectedConfigDirectory,
  listConfigFolders,
  resolveConfigRoot,
  sameFolder,
  settingsChoice
} from './config-root'
import { defaultConfigRoot, namesConfigFolder, type ConfigRoot } from './permissions'
import type { ThemeStore } from './theme'

const RESTARTING_MESSAGE =
  'Megatron is restarting to switch Claude Code folders. Try again after it reopens.'

function unavailableMessage(directory: string): string {
  return `The Claude Code folder ${directory} is unavailable. Reconnect it, or choose another folder in Settings.`
}

export interface ClaudeFolderDependencies {
  home: string
  environment: string | undefined
  isPrimaryInstance: boolean
  store: ThemeStore
  watch: (path: string, onChange: () => void) => void
  // Resolves once no CLI write (plugin or MCP action) is running.
  cliActionsIdle: () => Promise<void>
  stopScans: () => Promise<void>
  suspendScans: () => Promise<void>
  resumeScans: () => void
  relaunch: () => void
  broadcast: (status: ClaudeFolderStatus) => void
  onResume: () => void
}

// One active folder per process: every reader, the scan worker and the per-folder index follow the
// root chosen here at startup, so switching relaunches rather than re-pointing a running app.
export function createClaudeFolder(deps: ClaudeFolderDependencies): {
  readonly root: ConfigRoot
  paused: () => boolean
  // Why a `claude` run must not start now, or null; runClaude asks before every spawn.
  cliRefusal: () => string | null
  status: () => ClaudeFolderStatus
  choose: (id: string) => Promise<ClaudeFolderChoice>
  // The native dialog belongs to the requesting window, so each call brings its own picker.
  pickFolder: (pick: () => Promise<string | null>) => Promise<ClaudeFolderChoice>
} {
  const { home, environment, store } = deps
  const stored: unknown = store.get('claudeConfigDir')
  let saved =
    stored === null ? null : typeof stored === 'string' && stored.trim() !== '' ? stored : undefined
  const startup = activeConfigRoot({ saved, environment }, home)
  let root = startup.root
  // A missing folder is a pause, reported while it lasts; any other issue is a lasting fallback.
  let notice = startup.issue?.reason === 'missing' ? null : (startup.issue ?? null)
  let state: ClaudeFolderStatus['state'] = 'ok'
  let pauseIssue: ClaudeFolderIssue | null = null
  let relaunching = false
  // ~/.claude read as the default never pauses: a fresh install has none until Claude Code runs.
  const canPause = namesConfigFolder(root)
  if (canPause) {
    const directory = configDirectoryKey(root.directory)
    const current = currentConfigDirectory(root.directory)
    const savedBinding = store.get('claudeConfigBinding')
    const lastKnown =
      savedBinding?.directory === directory &&
      typeof savedBinding.canonicalDirectory === 'string' &&
      isAbsolute(savedBinding.canonicalDirectory) &&
      !savedBinding.canonicalDirectory.includes('\0')
        ? savedBinding.canonicalDirectory
        : null
    root = {
      ...root,
      canonicalDirectory: current ?? lastKnown ?? expectedConfigDirectory(root.directory)
    }
    if (current !== null && startup.issue?.reason !== 'missing') rememberBinding(current)
  }
  let suspension: Promise<void> | null = null
  let scansSuspended = false

  function rememberBinding(canonicalDirectory: string): void {
    if (!deps.isPrimaryInstance) return
    const directory = configDirectoryKey(root.directory)
    const savedBinding = store.get('claudeConfigBinding')
    if (
      savedBinding?.directory === directory &&
      savedBinding.canonicalDirectory === canonicalDirectory
    )
      return
    try {
      store.set('claudeConfigBinding', { directory, canonicalDirectory })
    } catch (error) {
      console.error('[config] could not remember the active Claude Code folder', error)
    }
  }

  function suspendScans(): void {
    if (suspension || scansSuspended) return
    suspension = Promise.resolve()
      .then(() => deps.suspendScans())
      .then(
        () => {
          suspension = null
          scansSuspended = true
          paused()
        },
        (error) => {
          suspension = null
          console.error(
            '[ingest] could not suspend scans for unavailable Claude Code folder',
            error
          )
        }
      )
  }

  function status(): ClaudeFolderStatus {
    return {
      path: root.directory,
      source: root.source,
      state,
      issue: state === 'paused' ? pauseIssue : notice,
      options: listConfigFolders({ saved, environment, active: root }, home)
    }
  }

  function pause(issue: ClaudeFolderIssue): void {
    state = 'paused'
    pauseIssue = issue
    suspendScans()
    deps.broadcast(status())
  }

  // Checked on disk at call time, so a scan or CLI run can't start in the gap between two polls.
  function paused(): boolean {
    if (!canPause) return false
    const current = currentConfigDirectory(root.directory)
    const sameTarget = current !== null && current === root.canonicalDirectory
    // Switching keeps its state for the banner and the pending relaunch, but a folder that was
    // paused, or vanished since, still must not be scanned or handed to the CLI.
    if (state === 'switching') return pauseIssue !== null || !sameTarget
    const source = root.source === 'environment' ? 'environment' : 'settings'
    if (state === 'ok' && sameTarget) return false
    const { issue } = resolveConfigRoot(root.directory, home, source)
    if (issue) {
      if (issue.reason !== pauseIssue?.reason) pause(issue)
      return true
    }
    if (current === null) {
      if (pauseIssue?.reason !== 'invalid')
        pause({ value: root.directory, reason: 'invalid', source })
      return true
    }
    if (!sameTarget) {
      state = 'switching'
      suspendScans()
      deps.broadcast(status())
      void relaunch()
      return true
    }
    if (!scansSuspended) {
      suspendScans()
      return true
    }
    state = 'ok'
    pauseIssue = null
    rememberBinding(current)
    scansSuspended = false
    deps.resumeScans()
    deps.onResume()
    deps.broadcast(status())
    return false
  }

  function cliRefusal(): string | null {
    if (relaunching) return RESTARTING_MESSAGE
    return paused() ? unavailableMessage(root.directory) : null
  }

  async function relaunch(): Promise<void> {
    // Waiting first means no plugin or MCP action is killed mid-write; refusing next means none
    // starts.
    await deps.cliActionsIdle()
    relaunching = true
    await deps.stopScans().catch(() => {})
    deps.relaunch()
  }

  async function save(path: string, named: boolean): Promise<ClaudeFolderChoice> {
    const choice = settingsChoice(path, home, named)
    if (choice !== null && typeof choice === 'object')
      return { outcome: 'rejected', path, reason: choice.reason }
    store.set('claudeConfigDir', choice)
    saved = choice
    if (state === 'switching') return { outcome: 'chosen', status: status() }
    const next = activeConfigRoot({ saved, environment }, home).root
    if (sameFolder(next.directory, root.directory) && next.claudeJson === root.claudeJson) {
      root = { ...root, source: next.source }
      notice = null
      paused()
      deps.broadcast(status())
      return { outcome: 'chosen', status: status() }
    }
    state = 'switching'
    deps.broadcast(status())
    void relaunch()
    return { outcome: 'chosen', status: status() }
  }

  if (canPause && deps.isPrimaryInstance) {
    deps.watch(root.directory, () => void paused())
    paused()
  }

  return {
    get root() {
      return root
    },
    paused,
    cliRefusal,
    status,
    async choose(id) {
      if (id === 'default') return save(defaultConfigRoot(home).directory, false)
      const option = listConfigFolders({ saved, environment, active: root }, home).find(
        (candidate) => candidate.id === id
      )
      if (!option) throw new Error('Unknown Claude Code folder')
      return save(option.path, option.id !== 'default')
    },
    async pickFolder(pick) {
      const path = await pick()
      // Picking ~/.claude means the default, the common intent; the named form is its own option.
      return path === null ? { outcome: 'canceled' } : save(path, false)
    }
  }
}

import { statSync } from 'fs'
import type { ClaudeFolderChoice, ClaudeFolderIssue, ClaudeFolderStatus } from '../shared/ipc'
import {
  activeConfigRoot,
  listConfigFolders,
  resolveConfigRoot,
  sameFolder,
  settingsChoice
} from './config-root'
import { namesConfigFolder, type ConfigRoot } from './permissions'
import type { ThemeStore } from './theme'

const RESTARTING_MESSAGE =
  'Megatron is restarting to switch Claude Code folders. Try again after it reopens.'

function unavailableMessage(directory: string): string {
  return `The Claude Code folder ${directory} is unavailable. Reconnect it, or choose another folder in Settings.`
}

export interface ClaudeFolderDependencies {
  home: string
  environment: string | undefined
  store: ThemeStore
  watch: (path: string, onChange: () => void) => void
  hold: (reason: string | null) => void
  pluginActionsIdle: () => Promise<void>
  stopScans: () => Promise<void>
  relaunch: () => void
  broadcast: (status: ClaudeFolderStatus) => void
  onResume: () => void
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// One active folder per process: every reader, the scan worker and the per-folder index follow the
// root chosen here at startup, so switching relaunches rather than re-pointing a running app.
export function createClaudeFolder(deps: ClaudeFolderDependencies): {
  readonly root: ConfigRoot
  paused: () => boolean
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
  // ~/.claude read as the default never pauses: a fresh install has none until Claude Code runs.
  const canPause = namesConfigFolder(root)

  function status(): ClaudeFolderStatus {
    return {
      path: root.directory,
      source: root.source,
      state,
      issue: state === 'paused' ? pauseIssue : notice,
      options: listConfigFolders({ saved, environment, active: root.directory }, home)
    }
  }

  function pause(issue: ClaudeFolderIssue): void {
    const wasPaused = state === 'paused'
    state = 'paused'
    pauseIssue = issue
    if (!wasPaused) deps.hold(unavailableMessage(root.directory))
    deps.broadcast(status())
  }

  // Checked on disk at call time, so a scan can't start in the gap between two polls.
  function paused(): boolean {
    if (!canPause || state === 'switching') return false
    const source = root.source === 'environment' ? 'environment' : 'settings'
    if (state === 'ok') {
      if (isDirectory(root.directory)) return false
      pause({ value: root.directory, reason: 'missing', source })
      return true
    }
    const value = source === 'environment' ? environment : (saved ?? undefined)
    const { issue } = resolveConfigRoot(value, home, source)
    if (issue) {
      if (issue.reason !== pauseIssue?.reason) pause(issue)
      return true
    }
    state = 'ok'
    pauseIssue = null
    deps.hold(null)
    deps.onResume()
    deps.broadcast(status())
    return false
  }

  async function relaunch(): Promise<void> {
    // Waiting first means no plugin action is killed mid-write; holding next means none starts.
    await deps.pluginActionsIdle()
    deps.hold(RESTARTING_MESSAGE)
    await deps.stopScans().catch(() => {})
    deps.relaunch()
  }

  async function save(path: string): Promise<ClaudeFolderChoice> {
    const choice = settingsChoice(path, home)
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

  if (canPause) {
    deps.watch(root.directory, () => void paused())
    paused()
  }

  return {
    get root() {
      return root
    },
    paused,
    status,
    async choose(id) {
      const option = listConfigFolders({ saved, environment, active: root.directory }, home).find(
        (candidate) => candidate.id === id
      )
      if (!option) throw new Error('Unknown Claude Code folder')
      return save(option.path)
    },
    async pickFolder(pick) {
      const path = await pick()
      return path === null ? { outcome: 'canceled' } : save(path)
    }
  }
}

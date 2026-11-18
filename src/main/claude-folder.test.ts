import Store from 'electron-store'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeFolderStatus } from '../shared/ipc'
import { createClaudeFolder } from './claude-folder'
import type { ThemeStore } from './theme'

let home: string
let store: ThemeStore
let onWatch: (() => void) | undefined
let watched: string[]
let events: string[]
let broadcasts: ClaudeFolderStatus[]
let idle: Promise<void>
let suspension: Promise<void>
let suspensionCount: number

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-claude-folder-')))
  store = new Store({ name: 'preferences', cwd: join(home, 'userData') })
  onWatch = undefined
  watched = []
  events = []
  broadcasts = []
  idle = Promise.resolve()
  suspension = Promise.resolve()
  suspensionCount = 0
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function profile(name: string, marker = 'settings.json'): string {
  const directory = join(home, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, marker), '{}')
  return directory
}

function controller(environment?: string): ReturnType<typeof createClaudeFolder> {
  return createClaudeFolder({
    home,
    environment,
    store,
    watch: (path, onChange) => {
      watched.push(path)
      onWatch = onChange
    },
    pluginActionsIdle: () => idle,
    stopScans: async () => {
      events.push('stopScans')
    },
    suspendScans: async () => {
      suspensionCount++
      await suspension
    },
    resumeScans: () => {},
    relaunch: () => events.push('relaunch'),
    broadcast: (status) => broadcasts.push(status),
    onResume: () => events.push('resume')
  })
}

describe('a folder chosen in Settings that goes missing', () => {
  it('keeps the CLI refused when cancellation fails and retries before reconnecting', async () => {
    const work = profile('.claude-work')
    store.set('claudeConfigDir', work)
    suspension = Promise.reject(new Error('worker termination failed'))
    // The dependency consumes this rejection when suspension starts.
    void suspension.catch(() => {})
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const folder = controller()
      rmSync(work, { recursive: true })
      onWatch?.()
      await vi.waitFor(() => expect(errorLog).toHaveBeenCalledOnce())
      profile('.claude-work')
      suspension = Promise.resolve()
      expect(folder.paused()).toBe(true)
      expect(folder.cliRefusal()).toContain(work)
      expect(events).toEqual([])
      await vi.waitFor(() => expect(events).toEqual(['resume']))
      expect(suspensionCount).toBe(2)
    } finally {
      errorLog.mockRestore()
    }
  })

  it('waits for cancellation before resuming and revalidates a second disappearance', async () => {
    const work = profile('.claude-work')
    store.set('claudeConfigDir', work)
    let stopped!: () => void
    suspension = new Promise<void>((resolve) => {
      stopped = resolve
    })
    const folder = controller()
    rmSync(work, { recursive: true })
    onWatch?.()
    await Promise.resolve()
    expect(suspensionCount).toBe(1)
    profile('.claude-work')
    expect(folder.paused()).toBe(true)
    expect(folder.cliRefusal()).toContain(work)
    expect(events).toEqual([])
    rmSync(work, { recursive: true })
    stopped()
    await vi.waitFor(() => expect(suspensionCount).toBe(1))
    expect(folder.paused()).toBe(true)
    profile('.claude-work')
    onWatch?.()
    await vi.waitFor(() => expect(events).toEqual(['resume']))
    onWatch?.()
    expect(suspensionCount).toBe(1)
  })

  it('starts paused with the CLI refused, then resumes when the folder returns', async () => {
    const usb = join(home, '.claude-usb')
    store.set('claudeConfigDir', usb)
    const folder = controller()
    expect(folder.root).toEqual({
      directory: usb,
      claudeJson: join(usb, '.claude.json'),
      source: 'settings'
    })
    expect(folder.paused()).toBe(true)
    expect(folder.cliRefusal()).toContain(usb)
    expect(folder.status()).toMatchObject({
      state: 'paused',
      issue: { value: usb, reason: 'missing', source: 'settings' }
    })
    expect(watched).toEqual([usb])

    profile('.claude-usb')
    onWatch?.()
    await vi.waitFor(() => expect(events).toEqual(['resume']))
    expect(broadcasts.at(-1)).toMatchObject({ state: 'ok', issue: null })
    expect(folder.paused()).toBe(false)
    expect(folder.cliRefusal()).toBeNull()
  })

  it('stays paused when the folder that returns was never used by Claude Code', () => {
    const usb = join(home, '.claude-usb')
    store.set('claudeConfigDir', usb)
    const folder = controller()

    profile('.claude-usb', 'notes.txt')
    onWatch?.()
    expect(folder.paused()).toBe(true)
    expect(folder.cliRefusal()).toContain(usb)
    expect(events).toEqual([])
    expect(broadcasts.at(-1)).toMatchObject({
      state: 'paused',
      issue: { value: usb, reason: 'no-marker', source: 'settings' }
    })
  })

  it('pauses the moment the folder disappears, before any poll fires', () => {
    const work = profile('.claude-work')
    store.set('claudeConfigDir', work)
    const folder = controller()
    expect(folder.paused()).toBe(false)

    rmSync(work, { recursive: true })
    expect(folder.paused()).toBe(true)
    expect(broadcasts.at(-1)).toMatchObject({ state: 'paused' })
  })

  it('refuses the CLI the moment the folder disappears, before any poll fires', () => {
    const work = profile('.claude-work')
    store.set('claudeConfigDir', work)
    const folder = controller()
    expect(folder.cliRefusal()).toBeNull()

    rmSync(work, { recursive: true })
    expect(folder.cliRefusal()).toContain(work)
    expect(broadcasts.at(-1)).toMatchObject({ state: 'paused' })
  })

  it('holds a missing CLAUDE_CONFIG_DIR folder the same way', () => {
    const folder = controller(join(home, '.claude-usb'))
    expect(folder.paused()).toBe(true)
    expect(folder.status().issue).toMatchObject({ reason: 'missing', source: 'environment' })
  })
})

it('never pauses on ~/.claude, even before Claude Code creates it', () => {
  const folder = controller()
  expect(folder.paused()).toBe(false)
  expect(watched).toEqual([])
  expect(events).toEqual([])
})

it.each([
  ['a number', 42],
  ['a blank string', '  ']
])('ignores %s saved in preferences and follows CLAUDE_CONFIG_DIR', (_label, saved) => {
  const work = profile('.claude-work')
  store.set('claudeConfigDir', saved as never)
  expect(controller(work).root.directory).toBe(work)
})

describe('choosing a folder', () => {
  it('resolves Use default after a saved alias changes target and restores default read semantics', async () => {
    const alternate = profile('profiles/work')
    const alias = join(home, '.claude-alias')
    symlinkSync(alternate, alias, process.platform === 'win32' ? 'junction' : 'dir')
    store.set('claudeConfigDir', alias)
    const claude = profile('.claude')
    rmSync(alias)
    symlinkSync(claude, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const folder = controller(alias)
    expect(folder.root.claudeJson).toBe(join(alias, '.claude.json'))
    await expect(folder.choose('default')).resolves.toMatchObject({
      outcome: 'chosen',
      status: { state: 'switching' }
    })
    expect(store.get('claudeConfigDir')).toBeNull()
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))
    expect(folder.cliRefusal()).toContain('restarting')
    expect(controller(alias).root.claudeJson).toBe(join(home, '.claude.json'))
  })

  it('saves nothing when the picker is canceled', async () => {
    await expect(controller().pickFolder(async () => null)).resolves.toEqual({
      outcome: 'canceled'
    })
    expect(store.has('claudeConfigDir')).toBe(false)
  })

  it('saves nothing for a picked folder that fails the checks, and says why', async () => {
    const picked = profile('Documents', 'notes.txt')
    await expect(controller().pickFolder(async () => picked)).resolves.toEqual({
      outcome: 'rejected',
      path: picked,
      reason: 'no-marker'
    })
    expect(store.has('claudeConfigDir')).toBe(false)
    expect(events).toEqual([])
  })

  it('relaunches onto another folder only after running plugin actions finish', async () => {
    const work = profile('.claude-work')
    let finishActions: () => void = () => {}
    idle = new Promise((resolve) => (finishActions = resolve))
    const folder = controller()

    const choice = await folder.choose('home:.claude-work')
    expect(choice).toMatchObject({ outcome: 'chosen', status: { state: 'switching' } })
    expect(store.get('claudeConfigDir')).toBe(work)
    expect(broadcasts.at(-1)).toMatchObject({ state: 'switching' })
    await Promise.resolve()
    expect(events).toEqual([])
    // A running update still has its install step to run.
    expect(folder.cliRefusal()).toBeNull()

    finishActions()
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))
    expect(folder.cliRefusal()).toMatch(/restarting/)
  })

  it('keeps refusing the CLI for a missing folder while switching away from it', async () => {
    store.set('claudeConfigDir', join(home, '.claude-usb'))
    idle = new Promise(() => {})
    const folder = controller()
    await folder.choose('default')
    expect(folder.status().state).toBe('switching')
    expect(folder.cliRefusal()).toContain('.claude-usb')
  })

  it('refuses the CLI when the folder disappears while switching away from it', async () => {
    const work = profile('.claude-work')
    profile('.claude-personal')
    store.set('claudeConfigDir', work)
    idle = new Promise(() => {})
    const folder = controller()
    await folder.choose('home:.claude-personal')
    expect(folder.cliRefusal()).toBeNull()

    rmSync(work, { recursive: true })
    expect(folder.cliRefusal()).toContain(work)
    expect(folder.status().state).toBe('switching')
  })

  it('relaunches even when stopping the scans fails', async () => {
    profile('.claude-work')
    const folder = createClaudeFolder({
      home,
      environment: undefined,
      store,
      watch: () => {},
      pluginActionsIdle: async () => {},
      stopScans: async () => {
        throw new Error('worker would not stop')
      },
      suspendScans: async () => {},
      resumeScans: () => {},
      relaunch: () => events.push('relaunch'),
      broadcast: () => {},
      onResume: () => {}
    })
    await folder.choose('home:.claude-work')
    await vi.waitFor(() => expect(events).toEqual(['relaunch']))
  })

  it('only updates what is saved when a second choice arrives while switching', async () => {
    profile('.claude-work')
    const personal = profile('.claude-personal')
    const folder = controller()
    await folder.choose('home:.claude-work')
    await folder.choose('home:.claude-personal')
    expect(store.get('claudeConfigDir')).toBe(personal)
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))
  })

  it('saves the folder already in use without relaunching', async () => {
    const work = profile('.claude-work')
    const folder = controller(work)
    await expect(folder.choose('environment')).resolves.toMatchObject({
      outcome: 'chosen',
      status: { path: work, source: 'settings', state: 'ok' }
    })
    expect(store.get('claudeConfigDir')).toBe(work)
    expect(events).toEqual([])
  })

  it('lets "Use default" silence the notice about a rejected CLAUDE_CONFIG_DIR', async () => {
    const folder = controller(profile('Documents', 'notes.txt'))
    expect(folder.status().issue).toMatchObject({ reason: 'no-marker', source: 'environment' })
    await expect(folder.choose('default')).resolves.toMatchObject({
      status: { source: 'settings', issue: null, state: 'ok' }
    })
    expect(store.get('claudeConfigDir')).toBeNull()
    expect(events).toEqual([])
  })

  it('relaunches to leave a CLAUDE_CONFIG_DIR that names ~/.claude for the default', async () => {
    const claude = profile('.claude')
    const folder = controller(claude)
    await folder.choose('default')
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))
  })

  it('saves the default for ~/.claude picked in the dialog', async () => {
    const claude = profile('.claude', '.claude.json')
    await controller(claude).pickFolder(async () => claude)
    expect(store.get('claudeConfigDir')).toBeNull()
  })

  it('chooses ~/.claude as a named folder, saving its path so .claude.json is read inside it', async () => {
    const claude = profile('.claude', '.claude.json')
    await controller().choose('named')
    expect(store.get('claudeConfigDir')).toBe(claude)
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))

    const relaunched = controller()
    expect(relaunched.root).toEqual({
      directory: claude,
      claudeJson: join(claude, '.claude.json'),
      source: 'settings'
    })
    expect(relaunched.status().options).toMatchObject([
      { id: 'saved', tags: ['named'], active: true },
      { id: 'default', active: false }
    ])
  })

  it('lets a variable naming ~/.claude be chosen after Settings saved the default', async () => {
    const claude = profile('.claude')
    store.set('claudeConfigDir', null)
    const folder = controller(claude)
    expect(folder.root.claudeJson).toBe(join(home, '.claude.json'))
    await folder.choose('environment')
    expect(store.get('claudeConfigDir')).toBe(claude)
    await vi.waitFor(() => expect(events).toEqual(['stopScans', 'relaunch']))
  })

  it('refuses an id it never offered', async () => {
    await expect(controller().choose('home:../Documents')).rejects.toThrow()
    expect(store.has('claudeConfigDir')).toBe(false)
  })
})

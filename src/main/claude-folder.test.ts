import Store from 'electron-store'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
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

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-claude-folder-')))
  store = new Store({ name: 'preferences', cwd: join(home, 'userData') })
  onWatch = undefined
  watched = []
  events = []
  broadcasts = []
  idle = Promise.resolve()
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
    hold: (reason) => events.push(reason === null ? 'release' : 'hold'),
    pluginActionsIdle: () => idle,
    stopScans: async () => {
      events.push('stopScans')
    },
    relaunch: () => events.push('relaunch'),
    broadcast: (status) => broadcasts.push(status),
    onResume: () => events.push('resume')
  })
}

describe('a folder chosen in Settings that goes missing', () => {
  it('starts paused with the CLI held, then resumes when the folder returns', () => {
    const usb = join(home, '.claude-usb')
    store.set('claudeConfigDir', usb)
    const folder = controller()
    expect(folder.root).toEqual({
      directory: usb,
      claudeJson: join(usb, '.claude.json'),
      source: 'settings'
    })
    expect(folder.paused()).toBe(true)
    expect(events).toEqual(['hold'])
    expect(folder.status()).toMatchObject({
      state: 'paused',
      issue: { value: usb, reason: 'missing', source: 'settings' }
    })
    expect(watched).toEqual([usb])

    profile('.claude-usb')
    onWatch?.()
    expect(events).toEqual(['hold', 'release', 'resume'])
    expect(broadcasts.at(-1)).toMatchObject({ state: 'ok', issue: null })
    expect(folder.paused()).toBe(false)
  })

  it('stays paused when the folder that returns was never used by Claude Code', () => {
    const usb = join(home, '.claude-usb')
    store.set('claudeConfigDir', usb)
    const folder = controller()

    profile('.claude-usb', 'notes.txt')
    onWatch?.()
    expect(folder.paused()).toBe(true)
    expect(events).toEqual(['hold'])
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
    expect(events).toEqual(['hold'])
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

    finishActions()
    await vi.waitFor(() => expect(events).toEqual(['hold', 'stopScans', 'relaunch']))
  })

  it('relaunches even when stopping the scans fails', async () => {
    profile('.claude-work')
    const folder = createClaudeFolder({
      home,
      environment: undefined,
      store,
      watch: () => {},
      hold: () => {},
      pluginActionsIdle: async () => {},
      stopScans: async () => {
        throw new Error('worker would not stop')
      },
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
    await vi.waitFor(() => expect(events).toEqual(['hold', 'stopScans', 'relaunch']))
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
    await vi.waitFor(() => expect(events).toEqual(['hold', 'stopScans', 'relaunch']))
  })

  it('refuses an id it never offered', async () => {
    await expect(controller().choose('home:../Documents')).rejects.toThrow()
    expect(store.has('claudeConfigDir')).toBe(false)
  })
})

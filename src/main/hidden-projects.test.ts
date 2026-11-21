import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hideProject, readHiddenProjects, showProject, unhideForPicks } from './hidden-projects'
import type { ThemeStore } from './theme'

let tempDir: string
let store: ThemeStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'megatron-hidden-test-'))
  store = new Store({ name: 'preferences', cwd: tempDir })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

const staghorn = join(tmpdir(), 'orca', 'staghorn')
const site = join(tmpdir(), 'orca', 'site')

describe('readHiddenProjects', () => {
  it('reads nothing when preferences hold no list', () => {
    expect(readHiddenProjects(store)).toEqual([])
    store.set('hiddenProjects', 'not-a-list' as never)
    expect(readHiddenProjects(store)).toEqual([])
  })

  it('drops entries that are not absolute, contain NUL, run too long, or repeat a spelling', () => {
    store.set('hiddenProjects', [
      staghorn,
      'relative/folder',
      `${site}\0`,
      `/${'x'.repeat(8192)}`,
      42,
      `${staghorn}/`,
      site
    ] as never)
    expect(readHiddenProjects(store)).toEqual([staghorn, site])
  })

  it('keeps at most 1000 folders', () => {
    store.set(
      'hiddenProjects',
      Array.from({ length: 1001 }, (_, i) => join(tmpdir(), `p${i}`))
    )
    const hidden = readHiddenProjects(store)
    expect(hidden).toHaveLength(1000)
    expect(hidden.at(-1)).toBe(join(tmpdir(), 'p999'))
  })
})

describe('hideProject', () => {
  it('saves the folder and returns the new list', () => {
    expect(hideProject(store, staghorn)).toEqual([staghorn])
    expect(hideProject(store, site)).toEqual([staghorn, site])
    expect(store.get('hiddenProjects')).toEqual([staghorn, site])
  })

  it('does not add a second spelling of a hidden folder', () => {
    hideProject(store, staghorn)
    expect(hideProject(store, `${staghorn}/`)).toEqual([staghorn])
  })

  it('refuses a folder past the limit without changing the list', () => {
    const full = Array.from({ length: 1000 }, (_, i) => join(tmpdir(), `p${i}`))
    store.set('hiddenProjects', full)
    expect(() => hideProject(store, staghorn)).toThrow()
    expect(store.get('hiddenProjects')).toEqual(full)
  })
})

describe('showProject', () => {
  it('removes the hidden folder named in any spelling', () => {
    store.set('hiddenProjects', [staghorn, site])
    expect(showProject(store, `${staghorn}/`)).toEqual([site])
    expect(store.get('hiddenProjects')).toEqual([site])
  })

  it('refuses a folder that is not itself hidden, even one inside a hidden folder', () => {
    store.set('hiddenProjects', [staghorn])
    expect(() => showProject(store, join(staghorn, 'web'))).toThrow('not hidden')
    expect(store.get('hiddenProjects')).toEqual([staghorn])
  })
})

describe('unhideForPicks', () => {
  it('shows a hidden folder when the pick is that folder or inside it', () => {
    const inner = join(site, 'packages')
    store.set('hiddenProjects', [staghorn, site, inner])
    expect(unhideForPicks(store, [join(staghorn, 'web'), inner])).toEqual([])
    expect(store.get('hiddenProjects')).toEqual([])
  })

  it('keeps a hidden folder inside a picked parent hidden', () => {
    store.set('hiddenProjects', [staghorn])
    expect(unhideForPicks(store, [join(tmpdir(), 'orca')])).toEqual([staghorn])
  })

  it('leaves preferences alone when no pick touches a hidden folder', () => {
    store.set('hiddenProjects', [staghorn, `${staghorn}/`])
    unhideForPicks(store, [join(tmpdir(), 'elsewhere')])
    expect(store.get('hiddenProjects')).toEqual([staghorn, `${staghorn}/`])
  })
})

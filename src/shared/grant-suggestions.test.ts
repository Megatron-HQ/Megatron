import { describe, expect, it } from 'vitest'
import { isSuggestableFolder, suggestGrantStart } from './grant-suggestions'

describe('isSuggestableFolder', () => {
  it.each([
    ['/Users/sai', '/Users/sai'],
    ['/Users', '/Users/sai'],
    ['/', '/Users/sai'],
    ['/Users/sai/', '/Users/sai'],
    ['C:\\Users\\Sai', 'C:\\Users\\Sai'],
    ['c:\\users', 'C:\\Users\\Sai'],
    ['C:\\', 'C:\\Users\\Sai'],
    ['D:', 'C:\\Users\\Sai'],
    ['\\\\server\\share', 'C:\\Users\\Sai'],
    ['\\\\server', 'C:\\Users\\Sai']
  ])('rejects %s (home, its ancestors, and roots invite a far wider grant)', (path, home) => {
    expect(isSuggestableFolder(path, home)).toBe(false)
  })

  it.each([
    [
      '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-2026-11-06-0f5802',
      '/Users/sai'
    ],
    [
      'C:\\Users\\Sai\\AppData\\Roaming\\Claude\\scratch-workspaces\\a\\b\\scratch-2026-11-06-0f5802',
      'C:\\Users\\Sai'
    ]
  ])('rejects the Claude app chat folder %s, which lives in app data', (path, home) => {
    expect(isSuggestableFolder(path, home)).toBe(false)
  })

  it.each([
    ['/Users/sai/code', '/Users/sai'],
    ['/opt/src', '/Users/sai'],
    ['D:\\src', 'C:\\Users\\Sai'],
    ['\\\\server\\share\\team', 'C:\\Users\\Sai']
  ])('accepts %s', (path, home) => {
    expect(isSuggestableFolder(path, home)).toBe(true)
  })
})

describe('suggestGrantStart', () => {
  const home = '/Users/sai'

  it('never opens the picker inside Claude app data for its chat folders', () => {
    const chats = '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b'
    expect(
      suggestGrantStart(
        [`${chats}/scratch-2026-11-06-0f5802`, `${chats}/scratch-2026-11-07-c3ed3c`],
        [],
        home
      )
    ).toBeUndefined()
  })

  it('opens in the folder that holds sibling repos', () => {
    expect(suggestGrantStart(['/Users/sai/code/a', '/Users/sai/code/b'], [], home)).toBe(
      '/Users/sai/code'
    )
  })

  it('prefers the ancestor holding the most repos over a deeper one holding fewer', () => {
    expect(suggestGrantStart(['/Users/sai/code/a', '/Users/sai/code/sub/b'], [], home)).toBe(
      '/Users/sai/code'
    )
  })

  it('breaks a tie toward the deeper folder', () => {
    expect(suggestGrantStart(['/Users/sai/code/team/a'], [], home)).toBe('/Users/sai/code/team')
    expect(suggestGrantStart(['/opt/src/a', '/opt/src/b'], [], home)).toBe('/opt/src')
  })

  it('opens beside the repo, never inside it', () => {
    expect(suggestGrantStart(['/Users/sai/code/app'], [], home)).toBe('/Users/sai/code')
  })

  it('picks the root with most repos, then the remaining root once that one is granted', () => {
    const detected = ['/Users/sai/work/x', '/Users/sai/Desktop/z', '/Users/sai/work/y']
    expect(suggestGrantStart(detected, [], home)).toBe('/Users/sai/work')
    expect(suggestGrantStart(detected, ['/Users/sai/work'], home)).toBe('/Users/sai/Desktop')
  })

  it('suggests nothing when every detected folder is already granted', () => {
    expect(
      suggestGrantStart(['/Users/sai/code/a', '/Users/sai/code/b'], ['/Users/sai/code'], home)
    ).toBeUndefined()
  })

  it('never suggests home or a root, even when that is the only common ancestor', () => {
    expect(suggestGrantStart(['/Users/sai'], [], home)).toBeUndefined()
    expect(suggestGrantStart(['/Users/sai/app'], [], home)).toBeUndefined()
    expect(suggestGrantStart(['/Users/sai/a', '/Users/sai/b'], [], home)).toBeUndefined()
    expect(suggestGrantStart(['/srv'], [], home)).toBeUndefined()
  })

  it('groups Windows paths case-insensitively and returns them in their recorded form', () => {
    expect(
      suggestGrantStart(
        ['C:\\Users\\Sai\\code\\a', 'c:\\users\\sai\\Code\\b', 'D:\\other\\c'],
        [],
        'C:\\Users\\Sai'
      )
    ).toBe('C:\\Users\\Sai\\code')
  })

  it('treats a UNC share as a root', () => {
    expect(suggestGrantStart(['\\\\server\\share\\repo'], [], 'C:\\Users\\Sai')).toBeUndefined()
    expect(suggestGrantStart(['\\\\server\\share\\team\\repo'], [], 'C:\\Users\\Sai')).toBe(
      '\\\\server\\share\\team'
    )
  })

  it('ignores grants that only share a name prefix with a detected folder', () => {
    expect(suggestGrantStart(['/Users/sai/code/app'], ['/Users/sai/code/ap'], home)).toBe(
      '/Users/sai/code'
    )
  })
})

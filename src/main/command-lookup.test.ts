import { describe, expect, it } from 'vitest'
import { createCommandLookup } from './command-lookup'
import type { ExecutableStatus } from './permissions'

function lookupWith(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  present: string[],
  unreadable: string[] = []
): { lookup: (program: string) => string; checked: string[] } {
  const checked: string[] = []
  const statusOf = (candidate: string): ExecutableStatus => {
    checked.push(candidate)
    if (unreadable.includes(candidate)) return 'unknown'
    return present.includes(candidate) ? 'present' : 'absent'
  }
  return { lookup: createCommandLookup({ environment, platform, statusOf }), checked }
}

describe('createCommandLookup on Windows', () => {
  const environment = { Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs\\' }

  it('finds a program through PATHEXT in any PATH folder, reading Path in any case', () => {
    const { lookup } = lookupWith('win32', environment, ['C:\\Program Files\\nodejs\\npx.cmd'])
    expect(lookup('npx')).toBe('found')
  })

  it('reports a program no PATH folder holds as missing', () => {
    expect(lookupWith('win32', environment, []).lookup('uvx')).toBe('missing')
  })

  it("uses the user's PATHEXT, and a name that already carries one of its extensions as is", () => {
    const { lookup, checked } = lookupWith('win32', { ...environment, PATHEXT: '.EXE;.PS1' }, [
      'C:\\Windows\\System32\\tool.ps1'
    ])
    expect(lookup('tool')).toBe('found')
    expect(checked).not.toContain('C:\\Windows\\System32\\tool.cmd')
    const named = lookupWith('win32', environment, ['C:\\Program Files\\nodejs\\node.exe'])
    expect(named.lookup('node.exe')).toBe('found')
    expect(named.checked).not.toContain('C:\\Program Files\\nodejs\\node.exe.exe')
  })

  it('skips relative and quoted-empty PATH entries rather than resolving them against a folder', () => {
    const { lookup, checked } = lookupWith('win32', { Path: 'bin;"";C:\\Tools' }, [])
    expect(lookup('uvx')).toBe('missing')
    expect(checked.every((candidate) => candidate.startsWith('C:\\Tools\\'))).toBe(true)
  })

  it('reads a quoted PATH entry', () => {
    const { lookup } = lookupWith('win32', { Path: '"C:\\My Tools"' }, ['C:\\My Tools\\uvx.exe'])
    expect(lookup('uvx')).toBe('found')
  })

  it('cannot say when a folder could not be checked and no other holds the program', () => {
    const { lookup } = lookupWith('win32', environment, [], ['C:\\Windows\\System32\\uvx.exe'])
    expect(lookup('uvx')).toBe('unknown')
  })

  it('cannot say with no usable PATH at all', () => {
    expect(lookupWith('win32', {}, []).lookup('npx')).toBe('unknown')
  })

  it('looks each program up once', () => {
    const { lookup, checked } = lookupWith('win32', environment, [])
    lookup('uvx')
    const first = checked.length
    lookup('uvx')
    expect(checked).toHaveLength(first)
  })
})

describe('createCommandLookup on macOS', () => {
  it("cannot say from launchd's default PATH, which a Dock-launched app gets", () => {
    const { lookup, checked } = lookupWith('darwin', { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, [])
    expect(lookup('npx')).toBe('unknown')
    expect(checked).toEqual([])
  })

  it('looks up a program on a PATH that carries the shell setup', () => {
    const environment = { PATH: '/opt/homebrew/bin:/usr/bin:/bin' }
    expect(lookupWith('darwin', environment, ['/opt/homebrew/bin/uvx']).lookup('uvx')).toBe('found')
    expect(lookupWith('darwin', environment, []).lookup('uvx')).toBe('missing')
  })

  it('never adds Windows extensions', () => {
    const { lookup, checked } = lookupWith('darwin', { PATH: '/opt/homebrew/bin' }, [])
    lookup('uvx')
    expect(checked).toEqual(['/opt/homebrew/bin/uvx'])
  })
})

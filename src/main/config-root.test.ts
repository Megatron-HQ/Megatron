import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, parse } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveConfigRoot } from './config-root'

let home: string

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-config-root-')))
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

function defaultRoot(): object {
  return {
    directory: join(home, '.claude'),
    claudeJson: join(home, '.claude.json'),
    source: 'default'
  }
}

describe('resolveConfigRoot', () => {
  it('uses ~/.claude and ~/.claude.json when CLAUDE_CONFIG_DIR is unset', () => {
    expect(resolveConfigRoot(undefined, home)).toEqual({ root: defaultRoot() })
  })

  it('treats a blank value as unset', () => {
    expect(resolveConfigRoot('  ', home)).toEqual({ root: defaultRoot() })
  })

  it('reads a Claude Code profile folder, with .claude.json inside it', () => {
    const work = profile('.claude-work')
    expect(resolveConfigRoot(work, home)).toEqual({
      root: { directory: work, claudeJson: join(work, '.claude.json'), source: 'environment' }
    })
  })

  it('moves .claude.json inside ~/.claude when the variable names ~/.claude explicitly', () => {
    const claude = profile('.claude')
    expect(resolveConfigRoot(claude, home).root.claudeJson).toBe(join(claude, '.claude.json'))
  })

  it.each(['settings.json', '.claude.json', 'projects', 'plugins', 'skills', 'history.jsonl'])(
    'accepts a folder holding only %s',
    (marker) => {
      const work = profile('.claude-work', marker)
      expect(resolveConfigRoot(work, home).root.source).toBe('environment')
    }
  )

  it('normalizes the value to NFC, the form Claude Code records paths in', () => {
    const nfc = profile('café')
    expect(resolveConfigRoot(join(home, 'café'), home).root.directory).toBe(nfc)
  })

  it('falls back to ~/.claude for a relative value, even before checking it exists', () => {
    expect(resolveConfigRoot('.claude-work', home)).toEqual({
      root: defaultRoot(),
      issue: { value: '.claude-work', reason: 'invalid' }
    })
  })

  it.each([
    ['the home folder', (): string => home],
    ['an ancestor of home', (): string => dirname(home)],
    ['a filesystem root', (): string => parse(home).root]
  ])('falls back to ~/.claude for %s', (_label, value) => {
    expect(resolveConfigRoot(value(), home)).toEqual({
      root: defaultRoot(),
      issue: { value: value(), reason: 'invalid' }
    })
  })

  it('falls back to ~/.claude for a link that resolves to the home folder', () => {
    writeFileSync(join(home, 'settings.json'), '{}')
    const link = join(home, 'linked-home')
    symlinkSync(home, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(resolveConfigRoot(link, home)).toEqual({
      root: defaultRoot(),
      issue: { value: link, reason: 'invalid' }
    })
  })

  it('falls back to ~/.claude for a file', () => {
    const file = join(home, 'claude-config')
    writeFileSync(file, '{}')
    expect(resolveConfigRoot(file, home).issue?.reason).toBe('invalid')
  })

  it('keeps a missing folder instead of silently reading ~/.claude', () => {
    const missing = join(home, '.claude-work')
    expect(resolveConfigRoot(missing, home)).toEqual({
      root: {
        directory: missing,
        claudeJson: join(missing, '.claude.json'),
        source: 'environment'
      },
      issue: { value: missing, reason: 'missing' }
    })
  })

  it('falls back to ~/.claude for a folder Claude Code has never used', () => {
    const documents = join(home, 'Documents')
    mkdirSync(documents)
    writeFileSync(join(documents, 'notes.txt'), '')
    expect(resolveConfigRoot(documents, home)).toEqual({
      root: defaultRoot(),
      issue: { value: documents, reason: 'no-marker' }
    })
  })

  it.runIf(process.platform === 'win32')('falls back to ~/.claude for a UNC path', () => {
    expect(resolveConfigRoot('\\\\server\\share\\claude', home).issue?.reason).toBe('invalid')
  })

  it.runIf(process.platform === 'win32')('matches the home folder regardless of case', () => {
    expect(resolveConfigRoot(home.toUpperCase(), home).issue?.reason).toBe('invalid')
  })
})

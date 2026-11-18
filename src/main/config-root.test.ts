import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, parse } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activeConfigRoot,
  listConfigFolders,
  resolveConfigRoot,
  settingsChoice
} from './config-root'
import { defaultConfigRoot, type ConfigRoot } from './permissions'

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

function link(target: string, name: string): string {
  const path = join(home, name)
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
  return path
}

function swapCase(path: string): string {
  return [...path].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
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
      issue: { value: '.claude-work', reason: 'invalid', source: 'environment' }
    })
  })

  it.each([
    ['the home folder', (): string => home],
    ['an ancestor of home', (): string => dirname(home)],
    ['a filesystem root', (): string => parse(home).root]
  ])('falls back to ~/.claude for %s', (_label, value) => {
    expect(resolveConfigRoot(value(), home)).toEqual({
      root: defaultRoot(),
      issue: { value: value(), reason: 'invalid', source: 'environment' }
    })
  })

  // The default macOS and Windows disks open any casing, and neither lexical nor JS realpath
  // comparison sees through it.
  it.for([
    ['the home folder', 'user'],
    ['an ancestor of home', '']
  ])('falls back to ~/.claude for %s spelled in another case', ([, folder], { skip }) => {
    const user = profile('user')
    writeFileSync(join(home, 'settings.json'), '{}')
    const value = swapCase(join(home, folder))
    if (!existsSync(value)) skip('case-sensitive filesystem')
    expect(resolveConfigRoot(value, user).issue?.reason).toBe('invalid')
  })

  it('falls back to ~/.claude for a link that resolves to the home folder', () => {
    writeFileSync(join(home, 'settings.json'), '{}')
    const link = join(home, 'linked-home')
    symlinkSync(home, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(resolveConfigRoot(link, home)).toEqual({
      root: defaultRoot(),
      issue: { value: link, reason: 'invalid', source: 'environment' }
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
      issue: { value: missing, reason: 'missing', source: 'environment' }
    })
  })

  it('falls back to ~/.claude for a folder Claude Code has never used', () => {
    const documents = join(home, 'Documents')
    mkdirSync(documents)
    writeFileSync(join(documents, 'notes.txt'), '')
    expect(resolveConfigRoot(documents, home)).toEqual({
      root: defaultRoot(),
      issue: { value: documents, reason: 'no-marker', source: 'environment' }
    })
  })

  it.runIf(process.platform === 'win32')('falls back to ~/.claude for a UNC path', () => {
    expect(resolveConfigRoot('\\\\server\\share\\claude', home).issue?.reason).toBe('invalid')
  })

  it.runIf(process.platform === 'win32')('matches the home folder regardless of case', () => {
    expect(resolveConfigRoot(home.toUpperCase(), home).issue?.reason).toBe('invalid')
  })
})

describe('activeConfigRoot', () => {
  it('reads the folder chosen in Settings over CLAUDE_CONFIG_DIR', () => {
    const chosen = profile('.claude-chosen')
    const work = profile('.claude-work')
    expect(activeConfigRoot({ saved: chosen, environment: work }, home)).toEqual({
      root: { directory: chosen, claudeJson: join(chosen, '.claude.json'), source: 'settings' }
    })
  })

  it('reads ~/.claude as Claude Code does with no variable when Settings chose the default', () => {
    const work = profile('.claude-work')
    expect(activeConfigRoot({ saved: null, environment: work }, home)).toEqual({
      root: { ...defaultRoot(), source: 'settings' }
    })
  })

  it('follows CLAUDE_CONFIG_DIR when nothing was chosen in Settings', () => {
    const work = profile('.claude-work')
    expect(activeConfigRoot({ saved: undefined, environment: work }, home)).toEqual({
      root: { directory: work, claudeJson: join(work, '.claude.json'), source: 'environment' }
    })
  })

  it('holds a chosen folder that is missing instead of reading another profile', () => {
    const missing = join(home, '.claude-usb')
    const work = profile('.claude-work')
    expect(activeConfigRoot({ saved: missing, environment: work }, home)).toEqual({
      root: { directory: missing, claudeJson: join(missing, '.claude.json'), source: 'settings' },
      issue: { value: missing, reason: 'missing', source: 'settings' }
    })
  })

  it.each([
    [
      'is now a file',
      'invalid',
      (): string => (writeFileSync(join(home, 'gone'), ''), join(home, 'gone'))
    ],
    ['Claude Code never used', 'no-marker', (): string => profile('Documents', 'notes.txt')]
  ])(
    'falls through to CLAUDE_CONFIG_DIR and reports a chosen folder that %s',
    (_label, reason, saved) => {
      const chosen = saved()
      const work = profile('.claude-work')
      expect(activeConfigRoot({ saved: chosen, environment: work }, home)).toEqual({
        root: { directory: work, claudeJson: join(work, '.claude.json'), source: 'environment' },
        issue: { value: chosen, reason, source: 'settings' }
      })
    }
  )

  it('falls through to ~/.claude when the variable is unset too', () => {
    const documents = profile('Documents', 'notes.txt')
    expect(activeConfigRoot({ saved: documents, environment: undefined }, home)).toEqual({
      root: defaultRoot(),
      issue: { value: documents, reason: 'no-marker', source: 'settings' }
    })
  })

  it('restores a chosen link exactly as saved, not as the folder it points to', () => {
    const saved = link(profile('profiles/work'), '.claude-work')
    expect(activeConfigRoot({ saved, environment: undefined }, home).root.directory).toBe(saved)
  })
})

describe('settingsChoice', () => {
  it('saves a Claude Code profile folder', () => {
    const work = profile('.claude-work')
    expect(settingsChoice(work, home)).toBe(work)
  })

  it('saves a link as chosen, not the folder it points to', () => {
    const chosen = link(profile('profiles/work'), '.claude-work')
    expect(settingsChoice(chosen, home)).toBe(chosen)
  })

  it('saves the default for ~/.claude, so Settings reads it as Claude Code does with no variable', () => {
    expect(settingsChoice(profile('.claude'), home)).toBeNull()
  })

  it('saves the default for a link to ~/.claude', () => {
    expect(settingsChoice(link(profile('.claude'), '.claude-main'), home)).toBeNull()
  })

  it('saves ~/.claude itself when chosen as a named folder, so .claude.json moves inside', () => {
    const claude = profile('.claude')
    expect(settingsChoice(claude, home, true)).toBe(claude)
  })

  it('saves the default for ~/.claude spelled in another case', ({ skip }) => {
    profile('.claude')
    const value = join(home, '.CLAUDE')
    if (!existsSync(value)) skip('case-sensitive filesystem')
    expect(settingsChoice(value, home)).toBeNull()
  })

  it.each([
    [
      'the home folder',
      'invalid',
      (): string => (writeFileSync(join(home, 'settings.json'), '{}'), home)
    ],
    [
      'a folder Claude Code never used',
      'no-marker',
      (): string => profile('Documents', 'notes.txt')
    ],
    ['a folder that does not exist', 'missing', (): string => join(home, '.claude-new')]
  ])('refuses %s with the reason', (_label, reason, value) => {
    expect(settingsChoice(value(), home)).toEqual({ reason })
  })
})

describe('listConfigFolders', () => {
  // The alias is read named (.claude.json inside), so it stays its own option; Default, the one
  // unnamed option, is never merged into it and so stays resolvable.
  it('keeps the default action when a saved alias is repointed to the default', () => {
    const saved = link(profile('profiles/work'), '.claude-alias')
    const claude = profile('.claude')
    rmSync(saved)
    symlinkSync(claude, saved, process.platform === 'win32' ? 'junction' : 'dir')
    expect(listConfigFolders({ saved, environment: claude, active: named(saved) }, home)).toEqual([
      option('saved', saved, ['environment', 'named'], true),
      option('default', claude, ['default'])
    ])
  })

  function option(id: string, path: string, tags: string[] = [], active = false): object {
    return { id, path, tags, active }
  }

  function named(directory: string): ConfigRoot {
    return { directory, claudeJson: join(directory, '.claude.json'), source: 'settings' }
  }

  const unnamed = (): ConfigRoot => defaultConfigRoot(home)

  it('lists the saved folder, ~/.claude, the overridden variable, then home profiles', () => {
    profile('.claude')
    const saved = profile('profiles/chosen')
    const environment = profile('profiles/env')
    const work = profile('.claude-work')
    const personal = profile('.Claude_Personal', 'projects')
    expect(listConfigFolders({ saved, environment, active: named(saved) }, home)).toEqual([
      option('saved', saved, [], true),
      option('default', join(home, '.claude'), ['default']),
      option('environment', environment, ['environment']),
      option('home:.Claude_Personal', personal),
      option('home:.claude-work', work)
    ])
  })

  it('always lists ~/.claude, even before Claude Code creates it', () => {
    const claude = join(home, '.claude')
    expect(
      listConfigFolders({ saved: null, environment: undefined, active: unnamed() }, home)
    ).toEqual([option('default', claude, ['default'], true)])
  })

  it('leaves out home folders that are not Claude Code profiles, and a relative variable', () => {
    profile('.claude-notes', 'notes.txt')
    profile('.claude-cache', 'plugins')
    profile('claude-work')
    profile('.clauderc')
    writeFileSync(join(home, '.claude-file'), '')
    const claude = join(home, '.claude')
    expect(
      listConfigFolders({ saved: undefined, environment: '.claude-work', active: unnamed() }, home)
    ).toEqual([option('default', claude, ['default'], true)])
  })

  it('merges a variable naming a home profile into one entry', () => {
    const work = profile('.claude-work')
    expect(
      listConfigFolders({ saved: undefined, environment: work, active: named(work) }, home)
    ).toEqual([
      option('default', join(home, '.claude'), ['default']),
      option('environment', work, ['environment'], true)
    ])
  })

  it('keeps a variable naming ~/.claude apart from the default, which reads ~/.claude.json', () => {
    const claude = profile('.claude')
    expect(
      listConfigFolders({ saved: undefined, environment: claude, active: named(claude) }, home)
    ).toEqual([
      option('default', claude, ['default']),
      option('environment', claude, ['environment', 'named'], true)
    ])
  })

  it('marks the default active, not the variable, when Settings chose the default', () => {
    const claude = profile('.claude')
    expect(
      listConfigFolders({ saved: null, environment: claude, active: unnamed() }, home)
    ).toEqual([
      option('default', claude, ['default'], true),
      option('environment', claude, ['environment', 'named'])
    ])
  })

  // Claude Code writes .claude.json there only when run with CLAUDE_CONFIG_DIR naming ~/.claude, so
  // an app launched from Finder, without the variable, can still offer that form.
  it('offers ~/.claude as a named folder when .claude.json is inside it', () => {
    const claude = profile('.claude', '.claude.json')
    expect(
      listConfigFolders({ saved: undefined, environment: undefined, active: unnamed() }, home)
    ).toEqual([option('default', claude, ['default'], true), option('named', claude, ['named'])])
  })

  it('marks a named ~/.claude saved in Settings active, not the default', () => {
    const claude = profile('.claude', '.claude.json')
    expect(
      listConfigFolders({ saved: claude, environment: undefined, active: named(claude) }, home)
    ).toEqual([option('saved', claude, ['named'], true), option('default', claude, ['default'])])
  })

  it('merges a home profile linked to ~/.claude into the named entry, not the default', () => {
    const claude = profile('.claude', '.claude.json')
    link(claude, '.claude-main')
    expect(
      listConfigFolders({ saved: undefined, environment: undefined, active: unnamed() }, home)
    ).toEqual([option('default', claude, ['default'], true), option('named', claude, ['named'])])
  })

  it('combines tags when the saved folder is also the variable', () => {
    const work = profile('.claude-work')
    expect(
      listConfigFolders({ saved: work, environment: work, active: named(work) }, home)
    ).toEqual([
      option('saved', work, ['environment'], true),
      option('default', join(home, '.claude'), ['default'])
    ])
  })

  it.runIf(process.platform === 'win32')(
    'merges missing folders whose paths differ only in letter case on Windows',
    () => {
      const saved = join(home, '.claude-usb')
      const claude = join(home, '.claude')
      expect(
        listConfigFolders({ saved, environment: saved.toUpperCase(), active: named(saved) }, home)
      ).toEqual([
        option('saved', saved, ['environment'], true),
        option('default', claude, ['default'])
      ])
    }
  )
})

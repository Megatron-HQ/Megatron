import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest'
import {
  allowedLinkTargetSync,
  allowedStatSync,
  grantPath,
  readAllowedDirectory,
  readAllowedFile,
  resetGrantedPaths,
  visitAllowedUtf8LinesSync,
  watchAllowedPath
} from './permissions'

// Tier 1 roots are fixed from homedir() at module load, so the whole file runs against one fake
// home. The real home stays untouched, and permissions.test.ts keeps asserting real-home paths.
vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>()
  const { mkdtempSync, realpathSync } = await import('fs')
  const { join } = await import('path')
  const home = realpathSync(mkdtempSync(join(os.tmpdir(), 'megatron-setup-links-home-')))
  const mocked = { ...os, homedir: () => home }
  return { ...mocked, default: mocked }
})

const home = homedir()
const claude = join(home, '.claude')

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function linkDirectory(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

// Windows file links need Developer Mode or admin rights; directory junctions don't.
function linkFileOrSkip(context: TestContext, target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  try {
    symlinkSync(target, path, 'file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip()
    throw error
  }
}

function text(path: string): string | null {
  return readAllowedFile(path).contents?.toString() ?? null
}

beforeEach(() => {
  resetGrantedPaths()
})

afterEach(() => {
  for (const entry of ['.claude', '.claude.json', '.agents', 'dotfiles', 'private', 'repo'])
    rmSync(join(home, entry), { recursive: true, force: true })
})

describe('links that make up the Claude Code setup', () => {
  it('reads a top-level skill linked out of ~/.claude/skills, as Orca and npx skills install them', () => {
    const store = join(home, '.agents', 'skills', 'orca-cli')
    writeFile(join(store, 'SKILL.md'), '---\nname: orca-cli\n---\nBody')
    writeFile(join(store, 'references', 'cli.md'), 'Reference')
    linkDirectory(store, join(claude, 'skills', 'orca-cli'))

    const link = join(claude, 'skills', 'orca-cli')
    expect(text(join(link, 'SKILL.md'))).toBe('---\nname: orca-cli\n---\nBody')
    expect(readAllowedDirectory(link)).toEqual({
      status: 'ok',
      entries: ['SKILL.md', 'references']
    })
    expect(text(join(link, 'references', 'cli.md'))).toBe('Reference')
    expect(allowedStatSync(join(link, 'references'))?.isDirectory()).toBe(true)
  })

  it('reads a linked skill inside synced/, which Claude Code scans one level deeper', () => {
    const store = join(home, '.agents', 'skills', 'synced-skill')
    writeFile(join(store, 'SKILL.md'), 'Synced')
    linkDirectory(store, join(claude, 'skills', 'Synced', 'synced-skill'))

    expect(text(join(claude, 'skills', 'Synced', 'synced-skill', 'SKILL.md'))).toBe('Synced')
  })

  it('still denies the link target when it is read by its own path', () => {
    const store = join(home, '.agents', 'skills', 'orca-cli')
    writeFile(join(store, 'SKILL.md'), 'Body')
    linkDirectory(store, join(claude, 'skills', 'orca-cli'))

    expect(readAllowedFile(join(store, 'SKILL.md')).status).toBe('unavailable')
    expect(readAllowedDirectory(store).status).toBe('unavailable')
  })

  it('denies a link nested inside a linked skill that points outside that skill', () => {
    const store = join(home, '.agents', 'skills', 'orca-cli')
    writeFile(join(store, 'SKILL.md'), 'Body')
    writeFile(join(home, 'private', 'key'), 'secret')
    linkDirectory(join(home, 'private'), join(store, 'notes'))
    linkDirectory(store, join(claude, 'skills', 'orca-cli'))

    const nested = join(claude, 'skills', 'orca-cli', 'notes')
    expect(readAllowedFile(join(nested, 'key')).status).toBe('unavailable')
    expect(allowedStatSync(nested)).toBeNull()
    expect(readAllowedDirectory(nested).status).toBe('unavailable')
  })

  it('denies a link nested inside a real global skill folder that points outside it', () => {
    writeFile(join(claude, 'skills', 'real', 'SKILL.md'), 'Body')
    writeFile(join(home, 'private', 'key'), 'secret')
    linkDirectory(join(home, 'private'), join(claude, 'skills', 'real', 'notes'))

    expect(readAllowedFile(join(claude, 'skills', 'real', 'notes', 'key')).status).toBe(
      'unavailable'
    )
  })

  it('denies a link inside plugin content that points outside ~/.claude/plugins', () => {
    writeFile(join(home, 'private', 'SKILL.md'), 'secret')
    linkDirectory(join(home, 'private'), join(claude, 'plugins', 'cache', 'm', 'p', 'skills', 's'))

    expect(
      readAllowedFile(join(claude, 'plugins', 'cache', 'm', 'p', 'skills', 's', 'SKILL.md')).status
    ).toBe('unavailable')
  })

  it('reads skills, plugins, transcripts, and config when all of ~/.claude is a dotfiles link', () => {
    const real = join(home, 'dotfiles', 'claude')
    writeFile(join(real, 'skills', 'mine', 'SKILL.md'), 'Mine')
    writeFile(join(real, 'plugins', 'installed_plugins.json'), '{}')
    writeFile(join(real, 'projects', 'p', 'session.jsonl'), '{"a":1}\n{"b":2}\n')
    writeFile(join(real, 'settings.json'), '{"enabledPlugins":{}}')
    writeFile(join(real, 'history.jsonl'), '{}\n')
    linkDirectory(real, claude)

    expect(text(join(claude, 'skills', 'mine', 'SKILL.md'))).toBe('Mine')
    expect(readAllowedDirectory(join(claude, 'skills')).entries).toEqual(['mine'])
    expect(text(join(claude, 'plugins', 'installed_plugins.json'))).toBe('{}')
    const lines: string[] = []
    expect(
      visitAllowedUtf8LinesSync(join(claude, 'projects', 'p', 'session.jsonl'), (line) =>
        lines.push(line)
      )
    ).toBe('ok')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(text(join(claude, 'settings.json'))).toBe('{"enabledPlugins":{}}')
    expect(text(join(claude, 'history.jsonl'))).toBe('{}\n')
    watchAllowedPath(
      join(claude, 'skills'),
      () => undefined,
      () => undefined
    ).close()
  })

  it('denies ~/.claude files outside the Tier 1 set even when ~/.claude is a link', () => {
    const real = join(home, 'dotfiles', 'claude')
    writeFile(join(real, 'CLAUDE.md'), 'instructions')
    linkDirectory(real, claude)

    expect(readAllowedFile(join(claude, 'CLAUDE.md')).status).toBe('unavailable')
  })

  it('reads settings.json and ~/.claude.json when each alone is a linked file', (context) => {
    writeFile(join(home, 'dotfiles', 'settings.json'), '{"skillOverrides":{}}')
    writeFile(join(home, 'dotfiles', 'claude.json'), '{"mcpServers":{}}')
    linkFileOrSkip(context, join(home, 'dotfiles', 'settings.json'), join(claude, 'settings.json'))
    linkFileOrSkip(context, join(home, 'dotfiles', 'claude.json'), join(home, '.claude.json'))

    expect(text(join(claude, 'settings.json'))).toBe('{"skillOverrides":{}}')
    expect(text(join(home, '.claude.json'))).toBe('{"mcpServers":{}}')
  })
})

describe('unapproved link targets', () => {
  it('tags a granted repo link that points outside the repo as unapproved', () => {
    const repo = join(home, 'repo')
    writeFile(join(home, 'private', 'shared', 'SKILL.md'), 'Shared')
    linkDirectory(join(home, 'private', 'shared'), join(repo, '.claude', 'skills', 'shared'))
    grantPath(repo)

    expect(readAllowedFile(join(repo, '.claude', 'skills', 'shared', 'SKILL.md'))).toEqual({
      status: 'unavailable',
      reason: 'unapproved',
      target: join(home, 'private', 'shared', 'SKILL.md'),
      contents: null
    })
  })

  it('leaves a path outside every approved folder untagged', () => {
    writeFile(join(home, 'private', 'SKILL.md'), 'Body')

    expect(readAllowedFile(join(home, 'private', 'SKILL.md'))).toEqual({
      status: 'unavailable',
      contents: null
    })
  })
})

describe('allowedLinkTargetSync', () => {
  it('returns the resolved target of a linked skill folder', () => {
    const store = join(home, '.agents', 'skills', 'orca-cli')
    writeFile(join(store, 'SKILL.md'), 'Body')
    linkDirectory(store, join(claude, 'skills', 'orca-cli'))

    expect(allowedLinkTargetSync(join(claude, 'skills', 'orca-cli'))).toBe(store)
  })

  it('returns null for a real folder, even when ~/.claude above it is a link', () => {
    const real = join(home, 'dotfiles', 'claude')
    writeFile(join(real, 'skills', 'mine', 'SKILL.md'), 'Mine')
    linkDirectory(real, claude)

    expect(allowedLinkTargetSync(join(claude, 'skills', 'mine'))).toBeNull()
  })

  it('returns null for a link outside every approved folder', () => {
    mkdirSync(join(home, 'private', 'target'), { recursive: true })
    linkDirectory(join(home, 'private', 'target'), join(home, 'private', 'link'))

    expect(allowedLinkTargetSync(join(home, 'private', 'link'))).toBeNull()
  })
})

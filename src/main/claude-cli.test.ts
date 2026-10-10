import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClaudeCommand } from './claude-cli'

let root: string
let prefix: string
let project: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-resolve-cli-')))
  prefix = join(root, 'trusted prefix')
  project = join(root, 'project')
  mkdirSync(prefix)
  mkdirSync(project)
  vi.stubEnv('PATH', prefix)
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('trusted CLI discovery', () => {
  it('selects an absolute native executable and removes Node startup injection', () => {
    const binary = join(prefix, process.platform === 'win32' ? 'claude.exe' : 'claude')
    writeFileSync(binary, 'synthetic native executable')
    vi.stubEnv('NODE_OPTIONS', '--require=hostile.js')
    vi.stubEnv('NODE_PATH', 'hostile-modules')
    vi.stubEnv('NODE_EXTRA_CA_CERTS', 'hostile.pem')
    expect(resolveClaudeCommand(project)).toMatchObject({ executable: binary, prefixArguments: [] })
    expect(resolveClaudeCommand(project)?.environment.NODE_OPTIONS).toBeUndefined()
    expect(resolveClaudeCommand(project)?.environment.NODE_PATH).toBeUndefined()
    expect(resolveClaudeCommand(project)?.environment.NODE_EXTRA_CA_CERTS).toBeUndefined()
  })

  it('does not discover an executable from empty, relative, or project PATH entries', () => {
    const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
    writeFileSync(join(prefix, binaryName), 'trusted')
    writeFileSync(join(project, binaryName), 'hostile')
    vi.stubEnv('PATH', ['', '.', project, prefix].join(delimiter))
    expect(resolveClaudeCommand(project)?.executable).toBe(join(prefix, binaryName))
    expect(resolveClaudeCommand(project)?.environment.PATH).toBe(prefix)
  })

  it('rejects a PATH directory whose executable resolves into the project', () => {
    const nested = join(project, 'bin')
    mkdirSync(nested)
    writeFileSync(join(nested, process.platform === 'win32' ? 'claude.exe' : 'claude'), 'hostile')
    const link = join(prefix, 'alias')
    symlinkSync(nested, link, process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('PATH', [link, prefix].join(delimiter))
    const binary = join(prefix, process.platform === 'win32' ? 'claude.exe' : 'claude')
    writeFileSync(binary, 'trusted')
    expect(resolveClaudeCommand(project)?.executable).toBe(binary)
    expect(resolveClaudeCommand(project)?.environment.PATH).toBe(prefix)
  })

  it('supports a trusted npm installation without evaluating its shell wrapper', () => {
    copyFileSync(process.execPath, join(prefix, process.platform === 'win32' ? 'node.exe' : 'node'))
    const packageRoot = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code')
    mkdirSync(packageRoot, { recursive: true })
    const entry = join(packageRoot, 'cli.js')
    writeFileSync(entry, 'synthetic CLI entry')
    expect(resolveClaudeCommand(project)).toMatchObject({
      executable: join(prefix, process.platform === 'win32' ? 'node.exe' : 'node'),
      prefixArguments: [entry]
    })
  })
})

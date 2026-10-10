import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enablePlugin } from './plugin-actions'
import { grantPath, resetGrantedPaths } from './permissions'

let fixtureRoot: string | undefined

afterEach(() => {
  vi.unstubAllEnvs()
  resetGrantedPaths()
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

describe.runIf(process.platform === 'win32')('Windows CLI execution boundary', () => {
  it('launches a trusted native executable with scoped names and paths containing spaces', async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'megatron-native-cli-security-'))
    const prefix = join(fixtureRoot, 'trusted native prefix')
    const project = join(fixtureRoot, 'project with spaces')
    mkdirSync(prefix)
    mkdirSync(project)
    const source = join(prefix, 'fixture.cs')
    writeFileSync(
      source,
      'using System; using System.IO; class Fixture { static void Main(string[] args) { File.WriteAllText("native-marker.txt", string.Join("|", args)); } }'
    )
    const compiler = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe'
    )
    execFileSync(compiler, ['/nologo', '/target:exe', `/out:${join(prefix, 'claude.exe')}`, source])
    writeFileSync(
      join(project, 'claude.cmd'),
      '@echo off\r\n>"%~dp0hostile-marker.txt" echo PROJECT_EXECUTED\r\n'
    )
    vi.stubEnv('PATH', prefix)
    grantPath(project)
    const result = await enablePlugin({
      name: '@scope/fixture',
      marketplace: 'fixture-market',
      scope: 'project',
      projectPath: project
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(project, 'hostile-marker.txt'))).toBe(false)
    expect(readFileSync(join(project, 'native-marker.txt'), 'utf8')).toBe(
      'plugin|enable|@scope/fixture@fixture-market|--scope|project'
    )
  })
  it('runs the trusted npm entry instead of a project-owned claude.cmd', async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'megatron-cli-security-'))
    const prefix = join(fixtureRoot, 'trusted prefix')
    const project = join(fixtureRoot, 'project')
    const packageRoot = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code')
    mkdirSync(packageRoot, { recursive: true })
    mkdirSync(project)
    copyFileSync(process.execPath, join(prefix, 'node.exe'))
    writeFileSync(
      join(packageRoot, 'package.json'),
      '{"name":"@anthropic-ai/claude-code","type":"module"}'
    )
    writeFileSync(
      join(packageRoot, 'cli.js'),
      'import fs from "node:fs"; fs.writeFileSync("trusted-marker.txt", JSON.stringify(process.argv.slice(2)))'
    )
    writeFileSync(join(prefix, 'claude.cmd'), '@echo off\r\nexit /b 99\r\n')
    writeFileSync(
      join(project, 'claude.cmd'),
      '@echo off\r\n>"%~dp0hostile-marker.txt" echo PROJECT_EXECUTED\r\nexit /b 0\r\n'
    )
    vi.stubEnv('PATH', prefix)
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe')
    vi.stubEnv('PATHEXT', '.EXE;.COM;.BAT;.CMD')
    vi.stubEnv('NODE_OPTIONS', '')
    grantPath(project)
    const result = await enablePlugin({
      name: 'fixture',
      marketplace: 'fixture',
      scope: 'project',
      projectPath: project
    })
    expect(existsSync(join(project, 'hostile-marker.txt'))).toBe(false)
    expect(result.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(project, 'trusted-marker.txt'), 'utf8'))).toEqual([
      'plugin',
      'enable',
      'fixture@fixture',
      '--scope',
      'project'
    ])
  })
})

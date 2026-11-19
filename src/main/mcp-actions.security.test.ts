import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpRemoveArgs, runMcpAction } from './mcp-actions'

let fixtureRoot: string | undefined

afterEach(() => {
  vi.unstubAllEnvs()
  // Windows can keep a just-run executable locked briefly (see plugin-actions.security.test.ts).
  if (fixtureRoot)
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  fixtureRoot = undefined
})

describe.runIf(process.platform === 'win32')(
  'Windows CLI execution boundary for MCP actions',
  () => {
    it('runs the trusted claude from the project, with a free-text name as one argument', async () => {
      fixtureRoot = mkdtempSync(join(tmpdir(), 'megatron-mcp-cli-security-'))
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
      execFileSync(compiler, [
        '/nologo',
        '/target:exe',
        `/out:${join(prefix, 'claude.exe')}`,
        source
      ])
      writeFileSync(
        join(project, 'claude.cmd'),
        '@echo off\r\n>"%~dp0hostile-marker.txt" echo PROJECT_EXECUTED\r\n'
      )
      vi.stubEnv('PATH', prefix)

      const result = await runMcpAction(
        mcpRemoveArgs('-my server & echo pwned', 'project'),
        project
      )

      expect(result.ok).toBe(true)
      expect(existsSync(join(project, 'hostile-marker.txt'))).toBe(false)
      expect(readFileSync(join(project, 'native-marker.txt'), 'utf8')).toBe(
        'mcp|remove|--scope|project|--|-my server & echo pwned'
      )
    })
  }
)

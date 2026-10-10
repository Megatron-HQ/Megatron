import { linkSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as permissions from './permissions'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'megatron-private-test-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
const api = permissions as typeof permissions & {
  securePrivateDataDirectory: (directory: string) => void
}
describe('private application cache', () => {
  it('rejects hardlinked cache files before changing another file permissions', () => {
    const directory = join(root, 'profile')
    mkdirSync(directory)
    const original = join(root, 'original')
    writeFileSync(original, 'fixture')
    linkSync(original, join(directory, 'megatron.db'))
    expect(() => api.securePrivateDataDirectory(directory)).toThrow(/linked/)
  })
  it.runIf(process.platform !== 'win32')(
    'preserves permissions on an existing custom profile parent',
    () => {
      const directory = join(root, 'existing')
      mkdirSync(directory, { mode: 0o755 })
      const before = statSync(directory).mode & 0o777
      api.securePrivateDataDirectory(directory)
      expect(statSync(directory).mode & 0o777).toBe(before)
    }
  )
  it.runIf(process.platform === 'win32')(
    'protects the cache directory ACL from inherited broad access',
    () => {
      const directory = join(root, 'private-profile')
      api.securePrivateDataDirectory(directory)
      const command = Buffer.from(
        '[System.IO.Directory]::GetAccessControl($env:MEGATRON_TEST_DIRECTORY).AreAccessRulesProtected',
        'utf16le'
      ).toString('base64')
      const powershell = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
      const result = execFileSync(
        powershell,
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', command],
        {
          env: { ...process.env, MEGATRON_TEST_DIRECTORY: directory },
          windowsHide: true,
          encoding: 'utf8'
        }
      )
      expect(result.trim()).toBe('True')
    }
  )
  it('creates the application data directory and retains existing cache contents', () => {
    const directory = join(root, 'profile')
    api.securePrivateDataDirectory(directory)
    writeFileSync(join(directory, 'megatron.db'), 'fixture')
    api.securePrivateDataDirectory(directory)
    expect(statSync(join(directory, 'megatron.db')).size).toBe(7)
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(join(directory, 'megatron.db')).mode & 0o777).toBe(0o600)
    }
  })
  it('refuses a linked data directory before opening or changing a database', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const link = join(root, 'profile')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => api.securePrivateDataDirectory(link)).toThrow(/linked/)
  })
})

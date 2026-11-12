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

// .NET rather than Get-Acl: Windows PowerShell 5.1 launched from PowerShell 7 inherits a
// PSModulePath that can't autoload Get-Acl.
function isAclProtected(path: string, kind: 'File' | 'Directory' = 'File'): boolean {
  const command = Buffer.from(
    `[System.IO.${kind}]::GetAccessControl($env:MEGATRON_TEST_PATH).AreAccessRulesProtected`,
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
      env: { ...process.env, MEGATRON_TEST_PATH: path },
      windowsHide: true,
      encoding: 'utf8'
    }
  )
  return result.trim() === 'True'
}
describe('private application cache', () => {
  it.each(['usage-history.db', 'usage-history.db-wal', 'usage-history.db-shm'])(
    'rejects a special persistent archive path %s before opening it',
    (name) => {
      const directory = join(root, 'archive-profile')
      mkdirSync(directory)
      mkdirSync(join(directory, name))
      expect(() => api.securePrivateDataDirectory(directory)).toThrow(/linked/)
    }
  )
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
      expect(isAclProtected(directory, 'Directory')).toBe(true)
    },
    20_000
  )
  // SQLite deletes a -wal/-shm sidecar when its last connection closes, which can land between
  // inspecting the directory and the PowerShell ACL change. Position matters: Windows PowerShell's
  // -EncodedCommand exit code follows the last statement, so a vanished file listed last once
  // failed the whole change even though it was caught.
  it.runIf(process.platform === 'win32').each(['first', 'last'] as const)(
    'skips a SQLite sidecar that vanished before its ACL change (listed %s) and still protects the rest',
    (position) => {
      const directory = join(root, 'vanished-sidecar')
      mkdirSync(directory)
      const present = join(directory, 'usage-history.db')
      writeFileSync(present, 'fixture')
      const vanished = join(directory, 'usage-history.db-wal')
      permissions.applyWindowsPrivateDataAcl({
        directory,
        restrictDirectory: false,
        files: position === 'first' ? [vanished, present] : [present, vanished]
      })
      expect(isAclProtected(present)).toBe(true)
    },
    20_000
  )
  it.runIf(process.platform === 'win32')(
    'still reports an ACL change that genuinely failed',
    () => {
      expect(() =>
        permissions.applyWindowsPrivateDataAcl({
          directory: join(root, 'never-created'),
          restrictDirectory: true,
          files: []
        })
      ).toThrow()
    },
    20_000
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
  }, 20_000)
  it('refuses a linked data directory before opening or changing a database', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const link = join(root, 'profile')
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => api.securePrivateDataDirectory(link)).toThrow(/linked/)
  })
})

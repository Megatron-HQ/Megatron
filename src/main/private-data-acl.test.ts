import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Only the PowerShell launch is replaced: it is the slow, external step. Directory creation and the
// linked/special-file inspection stay real, because they are the security checks under test.
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('child_process', async (original) => ({
  ...(await original<typeof import('child_process')>()),
  execFileSync
}))

type SecurePrivateDataDirectory = (directory: string, ownedRoot?: string) => void
let securePrivateDataDirectory: SecurePrivateDataDirectory
let root: string
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

beforeEach(async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  execFileSync.mockReset()
  // The once-per-process record is module state, so each test gets a fresh process's worth.
  vi.resetModules()
  ;({ securePrivateDataDirectory } = await import('./permissions'))
  root = mkdtempSync(join(tmpdir(), 'megatron-private-acl-test-'))
})
afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function aclRequests(): { restrictDirectory: boolean; files: string[] }[] {
  return execFileSync.mock.calls.map(([, , options]) => ({
    restrictDirectory: options.env.MEGATRON_PRIVATE_DATA_RESTRICT_DIRECTORY === '1',
    files: options.env.MEGATRON_PRIVATE_DATA_FILES.split('|')
      .filter(Boolean)
      .map((file: string) => basename(file))
  }))
}

describe('Windows private data ACL changes', () => {
  it('locks down an owned data directory once per process', () => {
    const directory = join(root, 'megatron')
    securePrivateDataDirectory(directory, directory)
    securePrivateDataDirectory(directory, directory)
    expect(aclRequests()).toEqual([{ restrictDirectory: true, files: [] }])
  })

  it('protects files already present when it locks down the directory', () => {
    const directory = join(root, 'megatron')
    mkdirSync(directory)
    writeFileSync(join(directory, 'preferences.json'), '{}')
    securePrivateDataDirectory(directory, directory)
    expect(aclRequests()).toEqual([{ restrictDirectory: true, files: ['preferences.json'] }])
  })

  // The directory ACL is inheritable, so anything created inside it afterwards is born private.
  it('needs no ACL change for files created after this process locked the directory', () => {
    const directory = join(root, 'megatron')
    securePrivateDataDirectory(directory, directory)
    writeFileSync(join(directory, 'megatron.db'), '')
    writeFileSync(join(directory, 'megatron.db-wal'), '')
    securePrivateDataDirectory(directory, directory)
    expect(aclRequests()).toEqual([{ restrictDirectory: true, files: [] }])
  })

  it('protects each newly appearing file once in an existing custom directory it does not own', () => {
    const custom = join(root, 'custom-profile')
    mkdirSync(custom)
    securePrivateDataDirectory(custom)
    writeFileSync(join(custom, 'megatron.db'), '')
    securePrivateDataDirectory(custom)
    writeFileSync(join(custom, 'megatron.db-wal'), '')
    securePrivateDataDirectory(custom)
    expect(aclRequests()).toEqual([
      { restrictDirectory: false, files: ['megatron.db'] },
      { restrictDirectory: false, files: ['megatron.db-wal'] }
    ])
  })

  it('keeps the app running with a warning when the ACL change cannot run', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('PowerShell is blocked by policy')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const directory = join(root, 'megatron')
    expect(() => securePrivateDataDirectory(directory, directory)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('retries a failed ACL change on the next call and stops once it succeeds', () => {
    execFileSync.mockImplementationOnce(() => {
      throw new Error('PowerShell timed out')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const directory = join(root, 'megatron')
    securePrivateDataDirectory(directory, directory)
    securePrivateDataDirectory(directory, directory)
    securePrivateDataDirectory(directory, directory)
    expect(execFileSync).toHaveBeenCalledTimes(2)
  })

  it('still refuses a special file planted at a sidecar path after the directory was secured', () => {
    const directory = join(root, 'megatron')
    securePrivateDataDirectory(directory, directory)
    mkdirSync(join(directory, 'megatron.db-wal'))
    expect(() => securePrivateDataDirectory(directory, directory)).toThrow(/linked/)
  })
})

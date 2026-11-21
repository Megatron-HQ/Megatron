import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { goneRecordedFolders, isExistingDirectory } from './folder-existence'

let root: string
const ungranted = (): boolean => false

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'folder-existence-'))
  mkdirSync(join(root, 'present'))
  writeFileSync(join(root, 'file.txt'), 'x')
})
afterEach(() => {
  chmodSync(root, 0o755)
  rmSync(root, { recursive: true, force: true })
})

describe('goneRecordedFolders', () => {
  it('reports a folder only on proof it is gone', () => {
    const paths = [
      join(root, 'present'),
      join(root, 'deleted'),
      join(root, 'file.txt'),
      join(root, 'file.txt', 'child')
    ]
    expect(goneRecordedFolders(paths, '/home/someone', ungranted)).toEqual([
      join(root, 'deleted'),
      join(root, 'file.txt'),
      join(root, 'file.txt', 'child')
    ])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps a folder it is not allowed to look up',
    () => {
      const locked = join(root, 'locked')
      mkdirSync(locked)
      chmodSync(locked, 0o000)
      try {
        expect(goneRecordedFolders([join(locked, 'inside')], '/home/someone', ungranted)).toEqual(
          []
        )
      } finally {
        chmodSync(locked, 0o755)
      }
    }
  )

  it('never probes a granted folder, home or above, or a Claude app chat folder', () => {
    const home = join(root, 'home')
    const granted = join(root, 'granted')
    const scratch = join(
      root,
      'Claude',
      'scratch-workspaces',
      'a',
      'b',
      'scratch-2026-11-21-0123abcd'
    )
    expect(
      goneRecordedFolders([home, root, granted, scratch], home, (path) => path === granted)
    ).toEqual([])
  })
})

describe('isExistingDirectory', () => {
  it('is true only for a folder that exists', () => {
    expect(isExistingDirectory(join(root, 'present'))).toBe(true)
    expect(isExistingDirectory(join(root, 'file.txt'))).toBe(false)
    expect(isExistingDirectory(join(root, 'deleted'))).toBe(false)
  })
})

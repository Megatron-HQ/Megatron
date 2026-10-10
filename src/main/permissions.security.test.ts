import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowedRealpathSync,
  grantPath,
  readAllowedDirectory,
  readAllowedFile,
  resetGrantedPaths,
  revokePath
} from './permissions'
import { readSkillFiles } from './skill-files'
import * as permissions from './permissions'

let root: string
let project: string
let external: string
let linked: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'megatron-canonical-permissions-'))
  project = join(root, 'project')
  external = join(root, 'external')
  mkdirSync(project)
  mkdirSync(external)
  writeFileSync(join(external, 'SKILL.md'), '---\nname: linked\n---\nBody')
  writeFileSync(join(external, 'private.txt'), 'SYNTHETIC_SECRET')
  linked = join(project, 'linked')
  symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir')
  grantPath(project)
})
afterEach(() => {
  resetGrantedPaths()
  rmSync(root, { recursive: true, force: true })
})

describe('canonical file permissions', () => {
  it('keeps the selected alias usable while anchoring its approved target', () => {
    const alias = join(root, 'selected')
    symlinkSync(external, alias, process.platform === 'win32' ? 'junction' : 'dir')
    grantPath(alias)
    expect(readAllowedFile(join(alias, 'private.txt')).contents?.toString()).toBe(
      'SYNTHETIC_SECRET'
    )
  })

  it('does not reapprove a retargeted saved root when grants are restored', () => {
    const saved = grantPath(project)
    resetGrantedPaths()
    renameSync(project, join(root, 'original'))
    symlinkSync(external, project, process.platform === 'win32' ? 'junction' : 'dir')
    const api = permissions as typeof permissions & { restoreGrantedPath: (path: string) => void }
    api.restoreGrantedPath(saved)
    expect(readAllowedFile(join(project, 'private.txt')).contents).toBeNull()
  })
  it('denies an ungranted junction target for reads, directory discovery, and previews', () => {
    expect(readAllowedFile(join(linked, 'private.txt')).status).toBe('unavailable')
    expect(readAllowedDirectory(linked).status).toBe('unavailable')
    expect(allowedRealpathSync(linked)).toBeNull()
    expect(readSkillFiles(linked)).toEqual([])
  })

  it('supports linked skills only while their target is explicitly granted', () => {
    grantPath(external)
    expect(readAllowedFile(join(linked, 'private.txt')).contents?.toString()).toBe(
      'SYNTHETIC_SECRET'
    )
    revokePath(external)
    expect(readAllowedFile(join(linked, 'private.txt')).contents).toBeNull()
  })

  it('does not grant a new target when an approved junction is retargeted', () => {
    grantPath(external)
    const other = join(root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'private.txt'), 'OTHER_SECRET')
    rmSync(linked)
    symlinkSync(other, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(readAllowedFile(join(linked, 'private.txt')).contents).toBeNull()
  })
})

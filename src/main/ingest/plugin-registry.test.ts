import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths } from '../permissions'
import { scanPluginRegistry } from './plugin-registry'

let db: Database.Database
let tmpDir: string
let pluginsDir: string

interface RegistryRow {
  name: string
  marketplace: string
  marketplace_repo: string | null
  installed_version: string
  scope: string
  install_path: string
  last_scanned_at: string
}

interface SkillRow {
  id: number
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
}

function allRegistry(): RegistryRow[] {
  return db.prepare('SELECT * FROM plugin_registry ORDER BY name').all() as RegistryRow[]
}

function pluginSkills(): SkillRow[] {
  return db
    .prepare("SELECT * FROM skills WHERE source_type = 'plugin' ORDER BY source_path")
    .all() as SkillRow[]
}

function writeInstalledPlugins(content: unknown): void {
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify(content))
}

function writeMarketplaces(content: unknown): void {
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify(content))
}

function writePluginSkill(installPath: string, skillName: string, frontmatter: string): void {
  const dirPath = join(installPath, 'skills', skillName)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'SKILL.md'), frontmatter)
}

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
  pluginsDir = join(tmpDir, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('scanPluginRegistry', () => {
  it('inserts two plugins across two marketplaces with repos resolved', () => {
    const installPathA = join(tmpDir, 'install-a')
    const installPathB = join(tmpDir, 'install-b')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath: installPathA, version: '1.0.0' }],
        'plugin-b@market-2': [{ scope: 'user', installPath: installPathB, version: '2.0.0' }]
      }
    })
    writeMarketplaces({
      'market-1': { source: { repo: 'org/repo1' } },
      'market-2': { source: { repo: 'org/repo2' } }
    })

    scanPluginRegistry(db, pluginsDir)

    const rows = allRegistry()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      name: 'plugin-a',
      marketplace: 'market-1',
      marketplace_repo: 'org/repo1',
      installed_version: '1.0.0'
    })
    expect(rows[1]).toMatchObject({
      name: 'plugin-b',
      marketplace: 'market-2',
      marketplace_repo: 'org/repo2',
      installed_version: '2.0.0'
    })
  })

  it('sets repo to NULL when the marketplace is missing from known_marketplaces.json', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@unknown-market': [
          { scope: 'user', installPath: join(tmpDir, 'install-a'), version: '1.0.0' }
        ]
      }
    })
    writeMarketplaces({})

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()[0].marketplace_repo).toBeNull()
  })

  it('writes rows with NULL repos when known_marketplaces.json is missing entirely', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [
          { scope: 'user', installPath: join(tmpDir, 'install-a'), version: '1.0.0' }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    const rows = allRegistry()
    expect(rows).toHaveLength(1)
    expect(rows[0].marketplace_repo).toBeNull()
  })

  it('stores the literal "unknown" version string as-is', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [
          { scope: 'user', installPath: join(tmpDir, 'install-a'), version: 'unknown' }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()[0].installed_version).toBe('unknown')
  })

  it('produces zero rows without throwing when the top level has no .plugins wrapper', () => {
    writeInstalledPlugins({
      'plugin-a@market-1': [
        { scope: 'user', installPath: join(tmpDir, 'install-a'), version: '1.0.0' }
      ]
    })

    expect(() => scanPluginRegistry(db, pluginsDir)).not.toThrow()
    expect(allRegistry()).toHaveLength(0)
  })

  it('does not throw and inserts no rows when installed_plugins.json is missing', () => {
    expect(() => scanPluginRegistry(db, pluginsDir)).not.toThrow()
    expect(allRegistry()).toHaveLength(0)
  })

  it('does not throw and inserts no rows when installed_plugins.json is malformed', () => {
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), '{ not valid json')

    expect(() => scanPluginRegistry(db, pluginsDir)).not.toThrow()
    expect(allRegistry()).toHaveLength(0)
  })

  it('splits a scoped plugin name with an extra @ correctly', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        '@acme/tools@market-1': [
          { scope: 'user', installPath: join(tmpDir, 'install-a'), version: '1.0.0' }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    const rows = allRegistry()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('@acme/tools')
    expect(rows[0].marketplace).toBe('market-1')
  })

  it("produces skills rows from the plugin's installPath/skills/* via the shared parser", () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(
      installPath,
      'sub-skill',
      '---\nname: sub-skill\ndescription: A plugin skill\n---\nBody'
    )
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    const skills = pluginSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      name: 'sub-skill',
      description: 'A plugin skill',
      plugin_name: 'plugin-a@market-1'
    })
  })

  it('inserts only a registry row when the plugin has no skills/ dir', () => {
    const installPath = join(tmpDir, 'install-a')
    mkdirSync(installPath, { recursive: true })
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()).toHaveLength(1)
    expect(pluginSkills()).toHaveLength(0)
  })

  it('skips an entry with an out-of-enum scope without aborting the rest of the batch', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'bad-plugin@market-1': [
          { scope: 'weird', installPath: join(tmpDir, 'install-bad'), version: '1.0.0' }
        ],
        'good-plugin@market-1': [
          { scope: 'user', installPath: join(tmpDir, 'install-good'), version: '1.0.0' }
        ]
      }
    })

    expect(() => scanPluginRegistry(db, pluginsDir)).not.toThrow()

    const rows = allRegistry()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('good-plugin')
  })

  it('is idempotent across two scans in a row', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(
      installPath,
      'sub-skill',
      '---\nname: sub-skill\ndescription: A skill\n---\nBody'
    )
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)
    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()).toHaveLength(1)
    expect(pluginSkills()).toHaveLength(1)
  })

  it('records the registry row but reads no skills for an installPath outside any granted or Tier-1 root', () => {
    const evilInstallPath = mkdtempSync(join(tmpdir(), 'megatron-evil-install-'))
    writePluginSkill(
      evilInstallPath,
      'sub-skill',
      '---\nname: sub-skill\ndescription: Should not be read\n---\nBody'
    )
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath: evilInstallPath, version: '1.0.0' }]
      }
    })

    try {
      scanPluginRegistry(db, pluginsDir)

      expect(allRegistry()).toHaveLength(1)
      expect(pluginSkills()).toHaveLength(0)
    } finally {
      rmSync(evilInstallPath, { recursive: true, force: true })
    }
  })

  it('removes the registry row and plugin-tagged skills rows when a plugin is removed', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(
      installPath,
      'sub-skill',
      '---\nname: sub-skill\ndescription: A skill\n---\nBody'
    )
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)
    expect(allRegistry()).toHaveLength(1)
    expect(pluginSkills()).toHaveLength(1)

    writeInstalledPlugins({ version: 2, plugins: {} })
    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()).toHaveLength(0)
    expect(pluginSkills()).toHaveLength(0)
  })

  it('correctly tracks and prunes multiple plugins including scoped names across marketplaces', () => {
    const installPathA = join(tmpDir, 'install-a')
    const installPathB = join(tmpDir, 'install-b')
    const installPathC = join(tmpDir, 'install-c')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        '@scope/pkg@market-1': [{ scope: 'user', installPath: installPathA, version: '1.0.0' }],
        '@scope/pkg@market-2': [{ scope: 'user', installPath: installPathB, version: '1.0.0' }],
        'pkg@market-1': [{ scope: 'user', installPath: installPathC, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)
    expect(allRegistry()).toHaveLength(3)

    // Remove one scoped package in market-1
    writeInstalledPlugins({
      version: 2,
      plugins: {
        '@scope/pkg@market-2': [{ scope: 'user', installPath: installPathB, version: '1.0.0' }],
        'pkg@market-1': [{ scope: 'user', installPath: installPathC, version: '1.0.0' }]
      }
    })
    scanPluginRegistry(db, pluginsDir)

    const remaining = allRegistry()
    expect(remaining).toHaveLength(2)
    expect(remaining.map((r) => `${r.name}@${r.marketplace}`)).toEqual([
      '@scope/pkg@market-2',
      'pkg@market-1'
    ])
  })

  it('does not contain NUL bytes in plugin-registry.ts source code', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'plugin-registry.ts'))
    expect(source.includes(0)).toBe(false)
  })
})

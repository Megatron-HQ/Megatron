import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths, revokePath } from '../permissions'
import { scanPluginRegistry } from './plugin-registry'

let db: Database.Database
let tmpDir: string
let pluginsDir: string
let userSettingsPath: string

interface RegistryRow {
  name: string
  marketplace: string
  marketplace_repo: string | null
  installed_version: string
  scope: string
  install_path: string
  last_scanned_at: string
  installed_at: string | null
  last_updated: string | null
  git_commit_sha: string | null
}

interface SkillRow {
  id: number
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
  license: string | null
  metadata_json: string | null
  created_at: string | null
  modified_at: string | null
  hook_events: string | null
  disabled_reason: string | null
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

function writeUserSettings(content: unknown): void {
  writeFileSync(userSettingsPath, JSON.stringify(content))
}

function writePluginSkill(installPath: string, skillName: string, frontmatter: string): void {
  const dirPath = join(installPath, 'skills', skillName)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'SKILL.md'), frontmatter)
}

// Mirrors a real installed plugin's `.claude-plugin/plugin.json` declaring a hooks manifest
// (e.g. ponytail's `"hooks": "./hooks/claude-codex-hooks.json"`) plus the manifest file itself.
function writePluginManifestWithHooks(
  installPath: string,
  hooksRelPath: string,
  hookEvents: Record<string, unknown>
): void {
  const manifestDir = join(installPath, '.claude-plugin')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(
    join(manifestDir, 'plugin.json'),
    JSON.stringify({ name: 'plugin-a', hooks: hooksRelPath })
  )
  const hooksPath = join(installPath, hooksRelPath)
  mkdirSync(join(hooksPath, '..'), { recursive: true })
  writeFileSync(hooksPath, JSON.stringify({ hooks: hookEvents }))
}

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
  pluginsDir = join(tmpDir, 'plugins')
  userSettingsPath = join(tmpDir, 'user-settings.json')
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

  it('preserves every installation listed for one plugin key', () => {
    const userInstallPath = join(tmpDir, 'user-install')
    const projectInstallPath = join(tmpDir, 'project-install')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [
          { scope: 'user', installPath: userInstallPath, version: '1.0.0' },
          { scope: 'project', installPath: projectInstallPath, version: '2.0.0' }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'user', install_path: userInstallPath }),
        expect.objectContaining({ scope: 'project', install_path: projectInstallPath })
      ])
    )
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

  it('preserves the last-known-good registry when installed_plugins.json becomes malformed', () => {
    const installPath = join(tmpDir, 'install-a')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })
    writePluginSkill(installPath, 'plugin-skill', '---\nname: plugin-skill\n---\nBody')
    scanPluginRegistry(db, pluginsDir)

    writeFileSync(join(pluginsDir, 'installed_plugins.json'), '{ not valid json')
    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()).toHaveLength(1)
    expect(pluginSkills().map((skill) => skill.name)).toEqual(['plugin-a:plugin-skill'])
  })

  it('sets disabled_reason to plugin for a skill whose plugin is disabled in enabledPlugins', () => {
    const installPath = join(tmpDir, 'install-a')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })
    writePluginSkill(installPath, 'plugin-skill', '---\nname: plugin-skill\n---\nBody')
    writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': false } })

    scanPluginRegistry(db, pluginsDir, userSettingsPath)

    expect(pluginSkills()[0].disabled_reason).toBe('plugin')
  })

  it('leaves disabled_reason NULL for a skill whose plugin is enabled', () => {
    const installPath = join(tmpDir, 'install-a')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })
    writePluginSkill(installPath, 'plugin-skill', '---\nname: plugin-skill\n---\nBody')
    writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': true } })

    scanPluginRegistry(db, pluginsDir, userSettingsPath)

    expect(pluginSkills()[0].disabled_reason).toBeNull()
  })

  it('leaves disabled_reason NULL when the user settings file is absent', () => {
    const installPath = join(tmpDir, 'install-a')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })
    writePluginSkill(installPath, 'plugin-skill', '---\nname: plugin-skill\n---\nBody')

    scanPluginRegistry(db, pluginsDir, userSettingsPath)

    expect(pluginSkills()[0].disabled_reason).toBeNull()
  })

  it('preserves plugin skills whose install directory becomes unavailable', () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'megatron-plugin-install-'))
    try {
      grantPath(installRoot)
      writeInstalledPlugins({
        version: 2,
        plugins: {
          'plugin-a@market-1': [{ scope: 'user', installPath: installRoot, version: '1.0.0' }]
        }
      })
      writePluginSkill(installRoot, 'plugin-skill', '---\nname: plugin-skill\n---\nBody')
      scanPluginRegistry(db, pluginsDir)

      revokePath(installRoot)
      scanPluginRegistry(db, pluginsDir)

      expect(pluginSkills().map((skill) => skill.name)).toEqual(['plugin-a:plugin-skill'])
    } finally {
      rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it('preserves a marketplace repo when known_marketplaces.json becomes malformed', () => {
    const installPath = join(tmpDir, 'install-a')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })
    writeMarketplaces({ 'market-1': { source: { repo: 'org/repo' } } })
    scanPluginRegistry(db, pluginsDir)

    writeFileSync(join(pluginsDir, 'known_marketplaces.json'), '{ not valid json')
    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()[0]?.marketplace_repo).toBe('org/repo')
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
      '---\nname: sub-skill\ndescription: A plugin skill\nlicense: MIT\nmetadata:\n  author: jane\n---\nBody'
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
      name: 'plugin-a:sub-skill',
      description: 'A plugin skill',
      plugin_name: 'plugin-a@market-1',
      license: 'MIT',
      metadata_json: JSON.stringify({ author: 'jane' })
    })
  })

  it('namespaces a plugin skill row name as "plugin-name:skill-name", matching how Claude Code records its invocations', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(installPath, 'sub-skill', '---\nname: sub-skill\n---\nBody')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(pluginSkills().map((skill) => skill.name)).toEqual(['plugin-a:sub-skill'])
  })

  it('always leaves created_at and modified_at NULL for a plugin skill row', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(installPath, 'sub-skill', '---\nname: sub-skill\n---\nBody')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    const skills = pluginSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0].created_at).toBeNull()
    expect(skills[0].modified_at).toBeNull()
  })

  it("captures the plugin's declared hook event names onto its skill rows", () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(installPath, 'sub-skill', '---\nname: sub-skill\n---\nBody')
    writePluginManifestWithHooks(installPath, './hooks/claude-codex-hooks.json', {
      SessionStart: [{ hooks: [{ type: 'command', command: 'noop' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'noop' }] }]
    })
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(pluginSkills()[0].hook_events).toBe(JSON.stringify(['SessionStart', 'UserPromptSubmit']))
  })

  it('leaves hook_events NULL for a plugin with no hooks manifest declared', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(installPath, 'sub-skill', '---\nname: sub-skill\n---\nBody')
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(pluginSkills()[0].hook_events).toBeNull()
  })

  it('leaves hook_events NULL without throwing when the declared hooks file is missing', () => {
    const installPath = join(tmpDir, 'install-a')
    writePluginSkill(installPath, 'sub-skill', '---\nname: sub-skill\n---\nBody')
    const manifestDir = join(installPath, '.claude-plugin')
    mkdirSync(manifestDir, { recursive: true })
    writeFileSync(
      join(manifestDir, 'plugin.json'),
      JSON.stringify({ name: 'plugin-a', hooks: './hooks/missing.json' })
    )
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [{ scope: 'user', installPath, version: '1.0.0' }]
      }
    })

    expect(() => scanPluginRegistry(db, pluginsDir)).not.toThrow()
    expect(pluginSkills()[0].hook_events).toBeNull()
  })

  it('captures installedAt, lastUpdated, and gitCommitSha when present in the entry', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [
          {
            scope: 'user',
            installPath: join(tmpDir, 'install-a'),
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            lastUpdated: '2026-02-01T00:00:00.000Z',
            gitCommitSha: 'abc123'
          }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()[0]).toMatchObject({
      installed_at: '2026-01-01T00:00:00.000Z',
      last_updated: '2026-02-01T00:00:00.000Z',
      git_commit_sha: 'abc123'
    })
  })

  it('sets git_commit_sha to NULL when the entry omits it (a semver-pinned install)', () => {
    writeInstalledPlugins({
      version: 2,
      plugins: {
        'plugin-a@market-1': [
          {
            scope: 'user',
            installPath: join(tmpDir, 'install-a'),
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
            lastUpdated: '2026-02-01T00:00:00.000Z'
          }
        ]
      }
    })

    scanPluginRegistry(db, pluginsDir)

    expect(allRegistry()[0].git_commit_sha).toBeNull()
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

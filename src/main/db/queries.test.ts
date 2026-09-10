// Pinned before any import so getActivityStats' JS-side .getHours()/.getDay() bucketing is
// deterministic. Etc/GMT+5 is UTC-5 with no DST, so a UTC instant maps to one fixed local hour.
process.env.TZ = 'Etc/GMT+5'

import Database from 'better-sqlite3'
import { resolve } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import {
  addAllowedPath,
  deleteSkillsForProjectRoot,
  getActivityStats,
  getContextBudget,
  getCostStats,
  getPluginDetail,
  getSkillById,
  getSkillInvocationLog,
  getSkillStats,
  getSkillUsageDetail,
  insertLintFindings,
  listAllowedPaths,
  listPlugins,
  listSkills,
  removeAllowedPath,
  writeSkillScan,
  writeSkillScanAuthoritative
} from './queries'

let db: Database.Database

function allSkills(): {
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
  est_listing_tokens: number
  est_body_tokens: number
  project_root: string | null
}[] {
  return db.prepare('SELECT * FROM skills ORDER BY source_path').all() as ReturnType<
    typeof allSkills
  >
}

function insertSkill(
  name: string,
  overrides: {
    source_type?: string
    est_listing_tokens?: number
    source_path?: string
    project_root?: string | null
    is_synced?: number
    disabled_reason?: string | null
    model_invocable?: number
  } = {}
): number {
  db.prepare(
    `INSERT INTO skills
       (name, source_type, source_path, plugin_name, description, last_scanned_at,
        est_listing_tokens, est_body_tokens, project_root, is_synced, disabled_reason,
        model_invocable)
     VALUES (?, ?, ?, NULL, NULL, '2026-08-14T00:00:00.000Z', ?, 0, ?, ?, ?, ?)`
  ).run(
    name,
    overrides.source_type ?? 'global',
    overrides.source_path ?? `/skills/${name}`,
    overrides.est_listing_tokens ?? 0,
    overrides.project_root ?? null,
    overrides.is_synced ?? 0,
    overrides.disabled_reason ?? null,
    overrides.model_invocable ?? 1
  )
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
}

function insertPluginRegistry(overrides: {
  name: string
  marketplace: string
  marketplace_repo?: string | null
  installed_version?: string
  scope?: 'user' | 'project' | 'local'
  install_path?: string
  installed_at?: string | null
  last_updated?: string | null
  git_commit_sha?: string | null
  disabled_reason?: string | null
  available_version?: string | null
  project_path?: string
}): void {
  db.prepare(
    `INSERT INTO plugin_registry
       (name, marketplace, marketplace_repo, installed_version, scope, install_path,
        last_scanned_at, installed_at, last_updated, git_commit_sha, disabled_reason, available_version, project_path)
     VALUES (@name, @marketplace, @marketplace_repo, @installed_version, @scope, @install_path,
        '2026-08-14T00:00:00.000Z', @installed_at, @last_updated, @git_commit_sha, @disabled_reason, @available_version,
        @project_path)`
  ).run({
    name: overrides.name,
    marketplace: overrides.marketplace,
    marketplace_repo: overrides.marketplace_repo ?? null,
    installed_version: overrides.installed_version ?? '1.0.0',
    scope: overrides.scope ?? 'user',
    install_path: overrides.install_path ?? `/plugins/${overrides.name}`,
    installed_at: overrides.installed_at ?? null,
    last_updated: overrides.last_updated ?? null,
    git_commit_sha: overrides.git_commit_sha ?? null,
    disabled_reason: overrides.disabled_reason ?? null,
    available_version: overrides.available_version ?? null,
    project_path: overrides.project_path ?? ''
  })
}

function insertSession(
  sessionId: string,
  cwd = '/repo',
  overrides: { git_branch?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
     VALUES (?, ?, ?, '2026-08-14T00:00:00.000Z', 0, 0)`
  ).run(sessionId, cwd, overrides.git_branch ?? null)
}

function insertInvocation(overrides: {
  source_uuid: string
  session_id: string
  skill_name: string
  args_text?: string | null
  invoked_at?: string
  trigger_type?: string
  agent_id?: string | null
  preceding_user_text?: string | null
}): void {
  db.prepare(
    `INSERT INTO skill_invocations
       (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id, preceding_user_text)
     VALUES (@source_uuid, @session_id, @skill_name, @args_text, @invoked_at, @trigger_type, @agent_id, @preceding_user_text)`
  ).run({
    source_uuid: overrides.source_uuid,
    session_id: overrides.session_id,
    skill_name: overrides.skill_name,
    args_text: overrides.args_text ?? null,
    invoked_at: overrides.invoked_at ?? '2026-08-14T00:00:00.000Z',
    trigger_type: overrides.trigger_type ?? 'autonomous',
    agent_id: overrides.agent_id ?? null,
    preceding_user_text: overrides.preceding_user_text ?? null
  })
}

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
})

describe('listSkills', () => {
  it('returns an empty array when no skills are indexed', () => {
    expect(listSkills(db)).toEqual([])
  })

  it('returns every skill row with all columns and lint summary intact', () => {
    db.prepare(
      `INSERT INTO skills
         (name, source_type, source_path, plugin_name, description, last_scanned_at, metadata_json)
       VALUES ('grill-me', 'plugin', '/plugins/grill-me', 'taste@leonxlnx', 'Interview the user', '2026-08-14T00:00:00.000Z', '{"author":"anthropic"}')`
    ).run()
    db.prepare(
      `INSERT INTO skills
         (name, source_type, source_path, plugin_name, description, last_scanned_at, modified_at)
       VALUES ('frontend-design', 'global', '/global/frontend-design', NULL, NULL, '2026-08-14T00:00:00.000Z', '2026-08-15T12:00:00.000Z')`
    ).run()

    const grillSkill = db.prepare('SELECT id FROM skills WHERE name = ?').get('grill-me') as {
      id: number
    }
    db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'missing-description', 'error', 'Description missing', NULL, NULL, NULL, ?)`
    ).run(grillSkill.id, '2026-08-14T00:00:00.000Z')
    db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'name-collision', 'warning', 'Collision found', NULL, NULL, NULL, ?)`
    ).run(grillSkill.id, '2026-08-14T00:00:00.000Z')

    const rows = listSkills(db)

    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'grill-me',
          source_type: 'plugin',
          source_path: '/plugins/grill-me',
          plugin_name: 'taste@leonxlnx',
          description: 'Interview the user',
          last_scanned_at: '2026-08-14T00:00:00.000Z',
          metadata_json: '{"author":"anthropic"}',
          modified_at: null,
          lint_status: 'error',
          error_count: 1,
          warning_count: 1
        }),
        expect.objectContaining({
          name: 'frontend-design',
          source_type: 'global',
          source_path: '/global/frontend-design',
          plugin_name: null,
          description: null,
          metadata_json: null,
          modified_at: '2026-08-15T12:00:00.000Z',
          lint_status: 'clean',
          error_count: 0,
          warning_count: 0
        })
      ])
    )
  })
})

describe('getSkillById', () => {
  it('returns null when no skill has that id', () => {
    expect(getSkillById(db, 1)).toBeNull()
  })

  it('returns the matching skill row with lint status', () => {
    db.prepare(
      `INSERT INTO skills
         (name, source_type, source_path, plugin_name, description, last_scanned_at,
          metadata_json, modified_at)
       VALUES ('grill-me', 'global', '/global/grill-me', NULL, 'Interview the user', '2026-08-14T00:00:00.000Z',
               '{"version":"1.0.0"}', '2026-08-15T12:00:00.000Z')`
    ).run()
    const { id } = db.prepare('SELECT id FROM skills WHERE name = ?').get('grill-me') as {
      id: number
    }
    db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'missing-mcp-server', 'warning', 'Server missing', NULL, NULL, NULL, ?)`
    ).run(id, '2026-08-14T00:00:00.000Z')

    expect(getSkillById(db, id)).toEqual(
      expect.objectContaining({
        id,
        name: 'grill-me',
        source_path: '/global/grill-me',
        metadata_json: '{"version":"1.0.0"}',
        modified_at: '2026-08-15T12:00:00.000Z',
        lint_status: 'warning',
        error_count: 0,
        warning_count: 1
      })
    )
  })

  it('returns null metadata_json and modified_at when the columns are unset', () => {
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('deploy', 'plugin', '/plugins/deploy', 'ops@marketplace', NULL, '2026-08-14T00:00:00.000Z')`
    ).run()
    const { id } = db.prepare('SELECT id FROM skills WHERE name = ?').get('deploy') as {
      id: number
    }

    expect(getSkillById(db, id)).toEqual(
      expect.objectContaining({ metadata_json: null, modified_at: null })
    )
  })
})

describe('lint findings queries', () => {
  it('inserts and retrieves lint findings for a skill', async () => {
    const { insertLintFindings, getLintFindingsForSkill } = await import('./queries')
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('skill-1', 'global', '/path/1', NULL, 'desc', ?)`
    ).run(new Date().toISOString())
    const { id } = db.prepare('SELECT id FROM skills WHERE name = ?').get('skill-1') as {
      id: number
    }

    insertLintFindings(db, id, [
      {
        rule_id: 'yaml-frontmatter',
        severity: 'error',
        message: 'Invalid frontmatter syntax',
        detail: 'YAML Exception on line 2',
        file_path: '/path/1/SKILL.md',
        line_number: 2
      }
    ])

    const findings = getLintFindingsForSkill(db, id)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      skill_id: id,
      rule_id: 'yaml-frontmatter',
      severity: 'error',
      message: 'Invalid frontmatter syntax',
      detail: 'YAML Exception on line 2',
      file_path: '/path/1/SKILL.md',
      line_number: 2
    })
  })

  it('replaces lint findings for all skills atomically', async () => {
    const { replaceAllLintFindings, getLintFindingsForSkill } = await import('./queries')
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('skill-1', 'global', '/path/1', NULL, 'desc', ?)`
    ).run(new Date().toISOString())
    const { id } = db.prepare('SELECT id FROM skills WHERE name = ?').get('skill-1') as {
      id: number
    }

    replaceAllLintFindings(db, [
      {
        skill_id: id,
        rule_id: 'broken-file-paths',
        severity: 'error',
        message: 'File not found',
        detail: null,
        file_path: 'helper.sh',
        line_number: 10
      }
    ])

    const findings = getLintFindingsForSkill(db, id)
    expect(findings).toHaveLength(1)
    expect(findings[0].rule_id).toBe('broken-file-paths')

    replaceAllLintFindings(db, [])
    expect(getLintFindingsForSkill(db, id)).toHaveLength(0)
  })
})

describe('writeSkillScanAuthoritative', () => {
  it('inserts rows for a fresh scan', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'Interview the user',
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'grill-me',
      source_type: 'plugin',
      source_path: '/plugins/grill-me',
      plugin_name: 'taste@leonxlnx',
      description: 'Interview the user'
    })
    expect(new Date(rows[0].last_scanned_at).toISOString()).toBe(rows[0].last_scanned_at)
  })

  it('updates an existing row on conflict instead of duplicating it', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'Old',
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'New',
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('New')
  })

  it('clears plugin_name on conflict when the new row has none', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/shared/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'A',
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])
    // Same source_path re-appears from a different source_type's scan (tier changed).
    writeSkillScanAuthoritative(db, 'global', [
      {
        name: 'grill-me',
        source_path: '/shared/grill-me',
        plugin_name: null,
        description: 'A',
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_type: 'global', plugin_name: null })
  })

  it('deletes every row of that source_type not present in this scan', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'a',
        source_path: '/plugins/a',
        plugin_name: 'a@m',
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      },
      {
        name: 'b',
        source_path: '/plugins/b',
        plugin_name: 'b@m',
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'a',
        source_path: '/plugins/a',
        plugin_name: 'a@m',
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].source_path).toBe('/plugins/a')
  })

  it('leaves rows of other source_types untouched', () => {
    writeSkillScanAuthoritative(db, 'global', [
      {
        name: 'g',
        source_path: '/global/g',
        plugin_name: null,
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].source_path).toBe('/global/g')
  })
})

describe('writeSkillScan', () => {
  it('deletes a stale row under a scanned root while keeping a still-seen sibling', () => {
    writeSkillScan(
      db,
      'global',
      [
        {
          name: 'a',
          source_path: '/roots/global/a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        },
        {
          name: 'b',
          source_path: '/roots/global/b',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/roots/global']
    )
    writeSkillScan(
      db,
      'global',
      [
        {
          name: 'a',
          source_path: '/roots/global/a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/roots/global']
    )

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].source_path).toBe('/roots/global/a')
  })

  it("does not delete another un-scanned root's rows", () => {
    writeSkillScan(
      db,
      'project',
      [
        {
          name: 'other',
          source_path: '/roots/project-b/other',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/roots/project-b']
    )

    // A separate scan call that only covers project-a's root.
    writeSkillScan(
      db,
      'project',
      [
        {
          name: 'a',
          source_path: '/roots/project-a/a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/roots/project-a']
    )

    const rows = allSkills()
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.source_path === '/roots/project-b/other')).toBe(true)
  })

  it('deletes stale rows under a scanned root even when rows is empty', () => {
    writeSkillScan(
      db,
      'global',
      [
        {
          name: 'a',
          source_path: '/roots/global/a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/roots/global']
    )
    writeSkillScan(db, 'global', [], ['/roots/global'])

    expect(allSkills()).toHaveLength(0)
  })
})

describe('listAllowedPaths', () => {
  it('returns an empty array when no paths are allowed', () => {
    expect(listAllowedPaths(db)).toEqual([])
  })

  it('returns allowed paths with path and granted_at', () => {
    const now = new Date().toISOString()
    const p = resolve('/path/to/repo')
    db.prepare('INSERT INTO allowed_paths (path, granted_at) VALUES (?, ?)').run(p, now)

    const rows = listAllowedPaths(db)
    expect(rows).toEqual([{ path: p, granted_at: now }])
  })
})

describe('addAllowedPath', () => {
  it('inserts a new path with an ISO8601 timestamp', () => {
    const p = resolve('/path/to/repo')
    addAllowedPath(db, p)
    const rows = listAllowedPaths(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe(p)
    expect(new Date(rows[0].granted_at).toISOString()).toBe(rows[0].granted_at)
  })

  it('is idempotent on conflict', () => {
    const p = resolve('/path/to/repo')
    addAllowedPath(db, p)
    expect(() => addAllowedPath(db, p)).not.toThrow()
    expect(listAllowedPaths(db)).toHaveLength(1)
  })
})

describe('removeAllowedPath', () => {
  it('deletes a path from allowed_paths', () => {
    const pA = resolve('/path/to/repo-a')
    const pB = resolve('/path/to/repo-b')
    addAllowedPath(db, pA)
    addAllowedPath(db, pB)

    removeAllowedPath(db, pA)
    const paths = listAllowedPaths(db).map((r) => r.path)
    expect(paths).toEqual([pB])
  })

  it('no-ops when removing a path not in allowed_paths', () => {
    const pA = resolve('/path/to/repo-a')
    const pB = resolve('/path/to/repo-b')
    addAllowedPath(db, pA)
    expect(() => removeAllowedPath(db, pB)).not.toThrow()
    expect(listAllowedPaths(db)).toHaveLength(1)
  })
})

describe('deleteSkillsForProjectRoot', () => {
  it('deletes project skills originating from that project root', () => {
    const rootA = '/repos/project-a'
    writeSkillScan(
      db,
      'project',
      [
        {
          name: 'skill-a',
          source_path: '/repos/project-a/.claude/skills/skill-a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/repos/project-a/.claude/skills']
    )
    writeSkillScan(
      db,
      'project',
      [
        {
          name: 'skill-b',
          source_path: '/repos/project-b/.claude/skills/skill-b',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0
        }
      ],
      ['/repos/project-b/.claude/skills']
    )

    deleteSkillsForProjectRoot(db, rootA)

    const remaining = allSkills()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe('skill-b')
  })

  it('does not touch global or plugin skills even if paths collide', () => {
    writeSkillScanAuthoritative(db, 'global', [
      {
        name: 'global-skill',
        source_path: '/repos/project-a/.claude/skills/global-skill',
        plugin_name: null,
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    deleteSkillsForProjectRoot(db, '/repos/project-a')

    expect(allSkills()).toHaveLength(1)
    expect(allSkills()[0].name).toBe('global-skill')
  })
})

describe('project_root persistence', () => {
  it('writeSkillScan persists project_root for a project-tier row', () => {
    writeSkillScan(
      db,
      'project',
      [
        {
          name: 'visual-verify',
          source_path: '/repo/.claude/skills/visual-verify',
          plugin_name: null,
          description: null,
          est_listing_tokens: 0,
          est_body_tokens: 0,
          project_root: '/repo'
        }
      ],
      ['/repo/.claude/skills']
    )

    expect(allSkills()[0]).toMatchObject({ project_root: '/repo' })
  })

  it('defaults project_root to null when not provided', () => {
    writeSkillScanAuthoritative(db, 'global', [
      {
        name: 'a',
        source_path: '/global/a',
        plugin_name: null,
        description: null,
        est_listing_tokens: 0,
        est_body_tokens: 0
      }
    ])

    expect(allSkills()[0].project_root).toBeNull()
  })

  it('updates project_root on conflict', () => {
    const row = {
      name: 'a',
      source_path: '/repo/.claude/skills/a',
      plugin_name: null,
      description: null,
      est_listing_tokens: 0,
      est_body_tokens: 0
    }
    writeSkillScan(db, 'project', [{ ...row, project_root: '/old-repo' }], ['/repo/.claude/skills'])
    writeSkillScan(db, 'project', [{ ...row, project_root: '/repo' }], ['/repo/.claude/skills'])

    expect(allSkills()[0]).toMatchObject({ project_root: '/repo' })
  })
})

describe('token estimate persistence', () => {
  it('writeSkillScanAuthoritative persists est_listing_tokens and est_body_tokens', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'Interview the user',
        est_listing_tokens: 12,
        est_body_tokens: 340
      }
    ])

    expect(allSkills()[0]).toMatchObject({ est_listing_tokens: 12, est_body_tokens: 340 })
  })

  it('writeSkillScanAuthoritative updates token estimates on conflict', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'Old',
        est_listing_tokens: 10,
        est_body_tokens: 100
      }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'New',
        est_listing_tokens: 20,
        est_body_tokens: 200
      }
    ])

    expect(allSkills()[0]).toMatchObject({ est_listing_tokens: 20, est_body_tokens: 200 })
  })

  it('writeSkillScan persists est_listing_tokens and est_body_tokens', () => {
    writeSkillScan(
      db,
      'global',
      [
        {
          name: 'a',
          source_path: '/roots/global/a',
          plugin_name: null,
          description: null,
          est_listing_tokens: 5,
          est_body_tokens: 50
        }
      ],
      ['/roots/global']
    )

    expect(allSkills()[0]).toMatchObject({ est_listing_tokens: 5, est_body_tokens: 50 })
  })
})

describe('listSkills usage aggregation', () => {
  it('returns 0 invocations and a null last_invoked_at for a skill never invoked', () => {
    insertSkill('never-used')

    const rows = listSkills(db)

    expect(rows[0]).toMatchObject({ total_invocations: 0, last_invoked_at: null })
  })

  it('counts invocations and reports the most recent invoked_at', () => {
    insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-01T00:00:00.000Z'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-10T00:00:00.000Z'
    })

    const rows = listSkills(db)

    expect(rows[0]).toMatchObject({
      total_invocations: 2,
      last_invoked_at: '2026-08-10T00:00:00.000Z'
    })
  })

  it('only counts invocations matching this skill by name, not another skill', () => {
    insertSkill('skill-a')
    insertSkill('skill-b')
    insertSession('sess-1')
    insertInvocation({ source_uuid: 'uuid-1', session_id: 'sess-1', skill_name: 'skill-a' })

    const rows = listSkills(db)

    const a = rows.find((r) => r.name === 'skill-a')
    const b = rows.find((r) => r.name === 'skill-b')
    expect(a).toMatchObject({ total_invocations: 1 })
    expect(b).toMatchObject({ total_invocations: 0 })
  })

  it("scopes a project skill's count to sessions whose cwd is under its own project_root", () => {
    insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-a',
      source_path: '/repo-a/.claude/skills/visual-verify'
    })
    insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-b',
      source_path: '/repo-b/.claude/skills/visual-verify'
    })
    insertSession('sess-a', '/repo-a')
    insertSession('sess-b', '/repo-b')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-a', skill_name: 'visual-verify' })
    insertInvocation({ source_uuid: 'u2', session_id: 'sess-b', skill_name: 'visual-verify' })
    insertInvocation({ source_uuid: 'u3', session_id: 'sess-b', skill_name: 'visual-verify' })

    const rows = listSkills(db)
    const a = rows.find((r) => r.source_path === '/repo-a/.claude/skills/visual-verify')
    const b = rows.find((r) => r.source_path === '/repo-b/.claude/skills/visual-verify')
    expect(a).toMatchObject({ total_invocations: 1 })
    expect(b).toMatchObject({ total_invocations: 2 })
  })

  it('counts a session whose cwd is nested below the project root', () => {
    insertSkill('deploy', { source_type: 'project', project_root: '/repo' })
    insertSession('sess-1', '/repo/packages/web')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(listSkills(db)[0]).toMatchObject({ total_invocations: 1 })
  })

  it('counts a Windows session whose cwd is nested below the project root', () => {
    insertSkill('deploy', {
      source_type: 'project',
      project_root: 'C:\\repo',
      source_path: 'C:\\repo\\.claude\\skills\\deploy'
    })
    insertSession('sess-1', 'C:\\repo\\packages\\web')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(listSkills(db)[0]).toMatchObject({ total_invocations: 1 })
  })

  it('counts a session whose cwd exactly equals the project root', () => {
    insertSkill('deploy', { source_type: 'project', project_root: '/repo' })
    insertSession('sess-1', '/repo')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(listSkills(db)[0]).toMatchObject({ total_invocations: 1 })
  })

  it('does not count a session from a sibling repo sharing a path prefix', () => {
    insertSkill('deploy', { source_type: 'project', project_root: '/repo' })
    insertSession('sess-1', '/repo-other')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(listSkills(db)[0]).toMatchObject({ total_invocations: 0 })
  })

  it('does not treat an underscore in project_root as a LIKE wildcard', () => {
    insertSkill('deploy', { source_type: 'project', project_root: '/repo_a' })
    // If scoping used `LIKE project_root || '/%'`, `_` would match any single character
    // and this cwd would incorrectly count.
    insertSession('sess-1', '/repoXa/subdir')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(listSkills(db)[0]).toMatchObject({ total_invocations: 0 })
  })
})

describe('global-shadows-project detection', () => {
  it('zeroes a project skill invocation count when a global skill shares its name', () => {
    const globalId = insertSkill('deploy', { source_type: 'global' })
    insertSkill('deploy', {
      source_type: 'project',
      project_root: '/repo',
      source_path: '/repo/.claude/skills/deploy'
    })
    insertSession('sess-1', '/repo')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    const projectRow = listSkills(db).find((r) => r.source_type === 'project')
    expect(projectRow).toMatchObject({
      total_invocations: 0,
      last_invoked_at: null,
      shadowed_by_skill_id: globalId
    })
  })

  it('attributes the full invocation count to the shadowing global skill', () => {
    insertSkill('deploy', { source_type: 'global' })
    insertSkill('deploy', {
      source_type: 'project',
      project_root: '/repo',
      source_path: '/repo/.claude/skills/deploy'
    })
    insertSession('sess-1', '/repo')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    const globalRow = listSkills(db).find((r) => r.source_type === 'global')
    expect(globalRow).toMatchObject({ total_invocations: 1, shadowed_by_skill_id: null })
  })

  it('leaves shadowed_by_skill_id null for two same-named project skills with no global collision', () => {
    insertSkill('visual-verify', { source_type: 'project', project_root: '/repo-a' })
    insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-b',
      source_path: '/skills-b/visual-verify'
    })

    expect(listSkills(db).every((r) => r.shadowed_by_skill_id === null)).toBe(true)
  })

  it('leaves an unrelated global skill unaffected', () => {
    insertSkill('grill-me', { source_type: 'global' })

    expect(listSkills(db)[0]).toMatchObject({ shadowed_by_skill_id: null })
  })
})

describe('synced-shadowed-by-non-synced detection', () => {
  it('zeroes a synced skill invocation count when a non-synced skill shares its name', () => {
    const nonSyncedId = insertSkill('deploy', { source_type: 'global' })
    insertSkill('deploy', { source_type: 'global', is_synced: 1, source_path: '/synced/deploy' })
    insertSession('sess-1')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    const syncedRow = listSkills(db).find((r) => r.source_path === '/synced/deploy')
    expect(syncedRow).toMatchObject({
      total_invocations: 0,
      last_invoked_at: null,
      shadowed_by_skill_id: nonSyncedId
    })
  })

  it('attributes the full invocation count to the shadowing non-synced skill', () => {
    insertSkill('deploy', { source_type: 'global' })
    insertSkill('deploy', { source_type: 'global', is_synced: 1, source_path: '/synced/deploy' })
    insertSession('sess-1')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    const nonSyncedRow = listSkills(db).find((r) => r.source_path === '/skills/deploy')
    expect(nonSyncedRow).toMatchObject({ total_invocations: 1, shadowed_by_skill_id: null })
  })

  it('leaves shadowed_by_skill_id null for a synced skill with no same-named collision', () => {
    insertSkill('visual-verify', { is_synced: 1, source_path: '/synced/visual-verify' })

    expect(listSkills(db)[0]).toMatchObject({ shadowed_by_skill_id: null })
  })
})

describe('getSkillById usage aggregation', () => {
  it('includes total_invocations and last_invoked_at on the single-row lookup too', () => {
    insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-05T00:00:00.000Z'
    })
    const { id } = db.prepare('SELECT id FROM skills WHERE name = ?').get('grill-me') as {
      id: number
    }

    expect(getSkillById(db, id)).toMatchObject({
      total_invocations: 1,
      last_invoked_at: '2026-08-05T00:00:00.000Z'
    })
  })
})

describe('getSkillUsageDetail', () => {
  it('breaks down invocation counts by trigger_type', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      trigger_type: 'user_invoked'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      trigger_type: 'autonomous'
    })
    insertInvocation({
      source_uuid: 'uuid-3',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      trigger_type: 'autonomous'
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.byTriggerType).toEqual(
      expect.arrayContaining([
        { trigger_type: 'user_invoked', count: 1 },
        { trigger_type: 'autonomous', count: 2 }
      ])
    )
  })

  it('breaks down invocation counts by project cwd, joined through sessions_meta', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1', '/repo/a')
    insertSession('sess-2', '/repo/b')
    insertInvocation({ source_uuid: 'uuid-1', session_id: 'sess-1', skill_name: 'grill-me' })
    insertInvocation({ source_uuid: 'uuid-2', session_id: 'sess-2', skill_name: 'grill-me' })
    insertInvocation({ source_uuid: 'uuid-3', session_id: 'sess-2', skill_name: 'grill-me' })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.byProject).toEqual(
      expect.arrayContaining([
        { cwd: '/repo/a', count: 1 },
        { cwd: '/repo/b', count: 2 }
      ])
    )
  })

  it('returns recent non-null trigger text, most-recent-first', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-01T00:00:00.000Z',
      preceding_user_text: 'older message'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-10T00:00:00.000Z',
      preceding_user_text: 'newer message'
    })
    insertInvocation({
      source_uuid: 'uuid-3',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-05T00:00:00.000Z',
      preceding_user_text: null
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.recentTriggers.map((t) => t.preceding_user_text)).toEqual([
      'newer message',
      '/grill-me',
      'older message'
    ])
    expect(detail.recentTriggers[0].trigger_type).toBe('autonomous')
  })

  it('falls back to slash command with args_text when preceding_user_text is null', () => {
    const id = insertSkill('deploy')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'deploy',
      args_text: 'production --force',
      invoked_at: '2026-08-01T00:00:00.000Z',
      trigger_type: 'user_invoked',
      preceding_user_text: null
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)
    expect(detail.recentTriggers).toEqual([
      {
        preceding_user_text: '/deploy production --force',
        invoked_at: '2026-08-01T00:00:00.000Z',
        trigger_type: 'user_invoked',
        cwd: '/repo',
        git_branch: null,
        agent_id: null
      }
    ])
  })

  it('carries cwd, git_branch, and agent_id on each recent-trigger row, including nulls', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-branch', '/repo/on-a-branch', { git_branch: 'feat/x' })
    insertSession('sess-detached', '/tmp/scratch')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-branch',
      skill_name: 'grill-me',
      invoked_at: '2026-08-10T00:00:00.000Z',
      trigger_type: 'subagent',
      agent_id: 'code-reviewer',
      preceding_user_text: 'from a repo on a branch, via subagent'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-detached',
      skill_name: 'grill-me',
      invoked_at: '2026-08-05T00:00:00.000Z',
      preceding_user_text: 'from a non-repo cwd, main session'
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.recentTriggers).toEqual([
      expect.objectContaining({
        preceding_user_text: 'from a repo on a branch, via subagent',
        cwd: '/repo/on-a-branch',
        git_branch: 'feat/x',
        agent_id: 'code-reviewer'
      }),
      expect.objectContaining({
        preceding_user_text: 'from a non-repo cwd, main session',
        cwd: '/tmp/scratch',
        git_branch: null,
        agent_id: null
      })
    ])
  })

  it('includes image-caption placeholder trigger text (rendered, not filtered)', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-01T00:00:00.000Z',
      preceding_user_text: '[Image: original 2438x1460, displayed at 2000x1198]'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      invoked_at: '2026-08-02T00:00:00.000Z',
      preceding_user_text: 'a real message'
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.recentTriggers.map((t) => t.preceding_user_text)).toEqual([
      'a real message',
      '[Image: original 2438x1460, displayed at 2000x1198]'
    ])
  })

  it('returns empty usage detail for a shadowed project skill', () => {
    insertSkill('deploy', { source_type: 'global' })
    const projectId = insertSkill('deploy', {
      source_type: 'project',
      project_root: '/repo',
      source_path: '/repo/.claude/skills/deploy'
    })
    insertSession('sess-1', '/repo')
    insertInvocation({ source_uuid: 'u1', session_id: 'sess-1', skill_name: 'deploy' })

    const detail = getSkillUsageDetail(db, getSkillById(db, projectId)!)

    expect(detail).toEqual({ byTriggerType: [], byProject: [], recentTriggers: [] })
  })

  it('scopes byProject and recentTriggers to sessions under the project root', () => {
    const idA = insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-a',
      source_path: '/repo-a/.claude/skills/visual-verify'
    })
    insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-b',
      source_path: '/repo-b/.claude/skills/visual-verify'
    })
    insertSession('sess-a', '/repo-a')
    insertSession('sess-b', '/repo-b')
    insertInvocation({
      source_uuid: 'u1',
      session_id: 'sess-a',
      skill_name: 'visual-verify',
      preceding_user_text: 'from repo a'
    })
    insertInvocation({
      source_uuid: 'u2',
      session_id: 'sess-b',
      skill_name: 'visual-verify',
      preceding_user_text: 'from repo b'
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, idA)!)

    expect(detail.byProject).toEqual([{ cwd: '/repo-a', count: 1 }])
    expect(detail.recentTriggers.map((t) => t.preceding_user_text)).toEqual(['from repo a'])
  })
})

describe('getSkillInvocationLog', () => {
  it('returns every invocation when no limit is given, most-recent-first', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    for (const day of ['01', '10', '05']) {
      insertInvocation({
        source_uuid: `u-${day}`,
        session_id: 'sess-1',
        skill_name: 'grill-me',
        invoked_at: `2026-08-${day}T00:00:00.000Z`,
        preceding_user_text: `msg ${day}`
      })
    }

    const log = getSkillInvocationLog(db, getSkillById(db, id)!)

    expect(log.map((e) => e.preceding_user_text)).toEqual(['msg 10', 'msg 05', 'msg 01'])
  })

  it('caps the result set at `limit` rows', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    for (let i = 1; i <= 5; i++) {
      insertInvocation({
        source_uuid: `u-${i}`,
        session_id: 'sess-1',
        skill_name: 'grill-me',
        invoked_at: `2026-08-0${i}T00:00:00.000Z`,
        preceding_user_text: `msg ${i}`
      })
    }

    expect(getSkillInvocationLog(db, getSkillById(db, id)!, 2)).toHaveLength(2)
  })

  it('includes image-caption placeholder rows — no [Image:% filter', () => {
    const caption =
      '[Image: original 2438x1460, displayed at 2000x1198. Multiply coordinates by 1.22 to map to original image.]'
    const id = insertSkill('visual-verify')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'u-1',
      session_id: 'sess-1',
      skill_name: 'visual-verify',
      invoked_at: '2026-08-01T00:00:00.000Z',
      preceding_user_text: caption
    })
    insertInvocation({
      source_uuid: 'u-2',
      session_id: 'sess-1',
      skill_name: 'visual-verify',
      invoked_at: '2026-08-02T00:00:00.000Z',
      preceding_user_text: 'a real message'
    })

    const log = getSkillInvocationLog(db, getSkillById(db, id)!)

    expect(log.map((e) => e.preceding_user_text)).toEqual(['a real message', caption])
  })

  it('falls back to the slash command when preceding_user_text is null', () => {
    const id = insertSkill('deploy')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'u-1',
      session_id: 'sess-1',
      skill_name: 'deploy',
      args_text: 'production --force',
      preceding_user_text: null
    })

    expect(getSkillInvocationLog(db, getSkillById(db, id)!)[0].preceding_user_text).toBe(
      '/deploy production --force'
    )
  })

  it('scopes a project skill to sessions under its own project_root', () => {
    const idA = insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-a',
      source_path: '/repo-a/.claude/skills/visual-verify'
    })
    insertSkill('visual-verify', {
      source_type: 'project',
      project_root: '/repo-b',
      source_path: '/repo-b/.claude/skills/visual-verify'
    })
    insertSession('sess-a', '/repo-a')
    insertSession('sess-b', '/repo-b')
    insertInvocation({
      source_uuid: 'u-a',
      session_id: 'sess-a',
      skill_name: 'visual-verify',
      preceding_user_text: 'from a'
    })
    insertInvocation({
      source_uuid: 'u-b',
      session_id: 'sess-b',
      skill_name: 'visual-verify',
      preceding_user_text: 'from b'
    })

    const log = getSkillInvocationLog(db, getSkillById(db, idA)!)

    expect(log.map((e) => e.preceding_user_text)).toEqual(['from a'])
  })

  it('returns an empty log for a shadowed project skill', () => {
    insertSkill('deploy', { source_type: 'global' })
    const projectId = insertSkill('deploy', {
      source_type: 'project',
      project_root: '/repo',
      source_path: '/repo/.claude/skills/deploy'
    })
    insertSession('sess-1', '/repo')
    insertInvocation({ source_uuid: 'u-1', session_id: 'sess-1', skill_name: 'deploy' })

    expect(getSkillInvocationLog(db, getSkillById(db, projectId)!)).toEqual([])
  })
})

describe('getContextBudget', () => {
  it('sums est_listing_tokens across global and plugin skills only, excluding project', () => {
    insertSkill('a', { source_type: 'global', est_listing_tokens: 500 })
    insertSkill('b', { source_type: 'plugin', est_listing_tokens: 700 })
    insertSkill('c', { source_type: 'project', est_listing_tokens: 100000 })

    expect(getContextBudget(db)).toEqual({
      used: 1200,
      limit: 2666,
      excludedTokens: 0,
      excludedCount: 0,
      userInvocableOnlyTokens: 0,
      userInvocableOnlyCount: 0
    })
  })

  it('returns 0 used when there are no skills indexed', () => {
    expect(getContextBudget(db)).toEqual({
      used: 0,
      limit: 2666,
      excludedTokens: 0,
      excludedCount: 0,
      userInvocableOnlyTokens: 0,
      userInvocableOnlyCount: 0
    })
  })

  it('excludes a disabled global/plugin skill from used, and reports it as excluded', () => {
    insertSkill('a', { source_type: 'global', est_listing_tokens: 500 })
    insertSkill('b', {
      source_type: 'plugin',
      est_listing_tokens: 700,
      disabled_reason: 'plugin'
    })

    expect(getContextBudget(db)).toEqual({
      used: 500,
      limit: 2666,
      excludedTokens: 700,
      excludedCount: 1,
      userInvocableOnlyTokens: 0,
      userInvocableOnlyCount: 0
    })
  })

  it('does not count a disabled project skill toward excludedTokens (already out of scope)', () => {
    insertSkill('c', {
      source_type: 'project',
      est_listing_tokens: 100000,
      disabled_reason: 'override'
    })

    expect(getContextBudget(db)).toEqual({
      used: 0,
      limit: 2666,
      excludedTokens: 0,
      excludedCount: 0,
      userInvocableOnlyTokens: 0,
      userInvocableOnlyCount: 0
    })
  })

  it('excludes a model_invocable=0 skill from used and reports it under the user-invocable-only counters', () => {
    insertSkill('a', { source_type: 'global', est_listing_tokens: 500 })
    insertSkill('b', {
      source_type: 'global',
      est_listing_tokens: 300,
      model_invocable: 0
    })

    expect(getContextBudget(db)).toEqual({
      used: 500,
      limit: 2666,
      excludedTokens: 0,
      excludedCount: 0,
      userInvocableOnlyTokens: 300,
      userInvocableOnlyCount: 1
    })
  })

  it('counts a skill that is both disabled and model_invocable=0 only under excluded, not user-invocable-only', () => {
    insertSkill('a', {
      source_type: 'plugin',
      est_listing_tokens: 700,
      disabled_reason: 'plugin',
      model_invocable: 0
    })

    expect(getContextBudget(db)).toEqual({
      used: 0,
      limit: 2666,
      excludedTokens: 700,
      excludedCount: 1,
      userInvocableOnlyTokens: 0,
      userInvocableOnlyCount: 0
    })
  })
})

describe('listPlugins', () => {
  it('returns an empty array when no plugins are registered', () => {
    expect(listPlugins(db)).toEqual([])
  })

  it('groups multiple installs of the same plugin identity into one row', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/user/plugin-a'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/project/plugin-a'
    })

    const rows = listPlugins(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].installs).toHaveLength(2)
    expect(rows[0].installs.map((i) => i.scope).sort()).toEqual(['project', 'user'])
  })

  it('keeps two different plugin identities as separate rows', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })
    insertPluginRegistry({ name: 'plugin-b', marketplace: 'market-1' })

    expect(listPlugins(db)).toHaveLength(2)
  })

  it('reports skill_count from skills joined by plugin_name, scoped to this plugin only', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })
    insertPluginRegistry({ name: 'plugin-b', marketplace: 'market-1' })
    insertSkill('sub-1', { source_type: 'plugin', source_path: '/p/sub-1' })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE name = ?').run('plugin-a@market-1', 'sub-1')
    insertSkill('sub-2', { source_type: 'plugin', source_path: '/p/sub-2' })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE name = ?').run('plugin-b@market-1', 'sub-2')

    const rows = listPlugins(db)
    const pluginA = rows.find((r) => r.name === 'plugin-a')
    const pluginB = rows.find((r) => r.name === 'plugin-b')
    expect(pluginA?.skill_count).toBe(1)
    expect(pluginB?.skill_count).toBe(1)
  })

  it('reports skill_count of 0 for a plugin with no skills', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })

    expect(listPlugins(db)[0].skill_count).toBe(0)
  })

  it('reports the marketplace_repo, installed_version, and disabled_reason from the registry', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      marketplace_repo: 'org/repo',
      installed_version: '1.2.3',
      disabled_reason: 'plugin'
    })

    expect(listPlugins(db)[0]).toMatchObject({
      marketplace_repo: 'org/repo',
      installed_version: '1.2.3',
      disabled_reason: 'plugin'
    })
  })

  it('reports available_version at identity level and on each install', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      installed_version: '1.0.0',
      available_version: '1.2.0'
    })

    const rows = listPlugins(db)
    expect(rows[0].available_version).toBe('1.2.0')
    expect(rows[0].installs[0].available_version).toBe('1.2.0')
    const detail = getPluginDetail(db, 'plugin-a', 'market-1')
    expect(detail?.plugin.available_version).toBe('1.2.0')
    expect(detail?.plugin.installs[0].available_version).toBe('1.2.0')
  })

  it('reports project_path per install, and null for a user install', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/cache/plugin-a'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/cache/plugin-a',
      project_path: '/repo'
    })

    const byScope = Object.fromEntries(
      listPlugins(db)[0].installs.map((install) => [install.scope, install.project_path])
    )
    expect(byScope).toEqual({ user: null, project: '/repo' })
  })

  it('reports installed_version per install when two scopes differ', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/cache/plugin-a/1.0.0',
      installed_version: '1.0.0'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/cache/plugin-a/2.0.0',
      installed_version: '2.0.0',
      project_path: '/repo'
    })

    const byScope = Object.fromEntries(
      listPlugins(db)[0].installs.map((install) => [install.scope, install.installed_version])
    )
    expect(byScope).toEqual({ user: '1.0.0', project: '2.0.0' })
  })

  it('reports disabled_reason per install when two scopes disagree', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/cache/plugin-a',
      disabled_reason: 'plugin'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/cache/plugin-a',
      project_path: '/repo'
    })

    const byScope = Object.fromEntries(
      listPlugins(db)[0].installs.map((install) => [install.scope, install.disabled_reason])
    )
    expect(byScope).toEqual({ user: 'plugin', project: null })
  })

  it('leaves the identity disabled_reason null when only some installs are disabled', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/cache/plugin-a',
      disabled_reason: 'plugin'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/cache/plugin-a',
      project_path: '/repo'
    })

    expect(listPlugins(db)[0].disabled_reason).toBeNull()
  })

  it('reports the identity disabled_reason when every install is disabled', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/cache/plugin-a',
      disabled_reason: 'plugin'
    })
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      install_path: '/cache/plugin-a',
      project_path: '/repo',
      disabled_reason: 'plugin'
    })

    expect(listPlugins(db)[0].disabled_reason).toBe('plugin')
  })

  it('reports enablement_known for a user install, which needs no project grant', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1', scope: 'user' })

    expect(listPlugins(db)[0].installs[0].enablement_known).toBe(true)
  })

  it('reports enablement_known for a project install whose root is granted', () => {
    addAllowedPath(db, '/repo')
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      project_path: resolve('/repo')
    })

    expect(listPlugins(db)[0].installs[0].enablement_known).toBe(true)
  })

  // Without the grant its .claude/settings*.json is unreadable, so a null disabled_reason means
  // "we could not look", not "enabled".
  it('reports enablement unknown for a project install whose root is not granted', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'project',
      project_path: '/ungranted-repo'
    })

    expect(listPlugins(db)[0].installs[0].enablement_known).toBe(false)
  })

  it('reports enablement unknown for a local install whose root is not granted', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'local',
      project_path: '/ungranted-repo'
    })

    expect(listPlugins(db)[0].installs[0].enablement_known).toBe(false)
  })

  // A project/local entry Claude Code wrote without a projectPath has no root to grant, so no
  // grant could ever make its enablement knowable.
  it('reports enablement unknown for a project install with no project_path at all', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1', scope: 'project' })

    expect(listPlugins(db)[0].installs[0].enablement_known).toBe(false)
  })
})

describe('getPluginDetail', () => {
  it('returns null when the plugin identity is not registered', () => {
    expect(getPluginDetail(db, 'nope', 'nowhere')).toBeNull()
  })

  it('returns the plugin row with its installs', () => {
    insertPluginRegistry({
      name: 'plugin-a',
      marketplace: 'market-1',
      scope: 'user',
      install_path: '/user/plugin-a'
    })

    const detail = getPluginDetail(db, 'plugin-a', 'market-1')
    expect(detail?.plugin.name).toBe('plugin-a')
    expect(detail?.plugin.installs).toHaveLength(1)
  })

  it('returns only the skills belonging to this plugin identity', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })
    insertPluginRegistry({ name: 'plugin-b', marketplace: 'market-1' })
    insertSkill('sub-1', { source_type: 'plugin', source_path: '/p/sub-1' })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE name = ?').run('plugin-a@market-1', 'sub-1')
    insertSkill('sub-2', { source_type: 'plugin', source_path: '/p/sub-2' })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE name = ?').run('plugin-b@market-1', 'sub-2')

    const detail = getPluginDetail(db, 'plugin-a', 'market-1')
    expect(detail?.skills.map((s) => s.name)).toEqual(['sub-1'])
  })

  it('sums invocations across all of this plugin identity skills', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })
    const skillId = insertSkill('plugin-a:sub-1', {
      source_type: 'plugin',
      source_path: '/p/sub-1'
    })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE id = ?').run('plugin-a@market-1', skillId)
    insertSession('sess-1')
    insertInvocation({ source_uuid: 'inv-1', session_id: 'sess-1', skill_name: 'plugin-a:sub-1' })
    insertInvocation({ source_uuid: 'inv-2', session_id: 'sess-1', skill_name: 'plugin-a:sub-1' })

    expect(getPluginDetail(db, 'plugin-a', 'market-1')?.totalInvocations).toBe(2)
  })

  it('sums lint finding counts across all of this plugin identity skills', () => {
    insertPluginRegistry({ name: 'plugin-a', marketplace: 'market-1' })
    const skillId = insertSkill('plugin-a:sub-1', {
      source_type: 'plugin',
      source_path: '/p/sub-1'
    })
    db.prepare('UPDATE skills SET plugin_name = ? WHERE id = ?').run('plugin-a@market-1', skillId)
    insertLintFindings(db, skillId, [
      { rule_id: 'r1', severity: 'error', message: 'bad' },
      { rule_id: 'r2', severity: 'warning', message: 'meh' }
    ])

    const detail = getPluginDetail(db, 'plugin-a', 'market-1')
    expect(detail?.errorCount).toBe(1)
    expect(detail?.warningCount).toBe(1)
  })
})

describe('getActivityStats', () => {
  const NOW = new Date('2026-08-20T12:00:00.000Z') // local Thu 2026-08-20 07:00 (UTC-5)

  function insertPrompt(overrides: {
    typed_at: string
    session_id?: string
    project?: string
    is_slash_command?: 0 | 1
  }): void {
    db.prepare(
      `INSERT INTO prompt_history (session_id, project, typed_at, is_slash_command)
       VALUES (@session_id, @project, @typed_at, @is_slash_command)`
    ).run({
      session_id: overrides.session_id ?? 's1',
      project: overrides.project ?? '/repo-a',
      typed_at: overrides.typed_at,
      is_slash_command: overrides.is_slash_command ?? 0
    })
  }

  // A,B,C,D + slash E land inside the 7-day window; F,G + slash H are 30-day only; I predates
  // the 30-day SQL bound entirely.
  function seedFixture(): void {
    insertPrompt({ typed_at: '2026-08-19T02:00:00.000Z', session_id: 's1', project: '/repo-a' }) // A
    insertPrompt({ typed_at: '2026-08-19T02:30:00.000Z', session_id: 's1', project: '/repo-a' }) // B
    insertPrompt({ typed_at: '2026-08-17T15:00:00.000Z', session_id: 's2', project: '/repo-b' }) // C
    insertPrompt({ typed_at: '2026-08-14T09:00:00.000Z', session_id: 's3', project: '/repo-a' }) // D
    insertPrompt({
      typed_at: '2026-08-19T06:00:00.000Z',
      session_id: 's1',
      project: '/repo-a',
      is_slash_command: 1
    }) // E
    insertPrompt({ typed_at: '2026-08-01T12:00:00.000Z', session_id: 's4', project: '/repo-c' }) // F
    insertPrompt({ typed_at: '2026-07-25T12:00:00.000Z', session_id: 's4', project: '/repo-c' }) // G
    insertPrompt({
      typed_at: '2026-07-25T13:00:00.000Z',
      session_id: 's5',
      project: '/repo-c',
      is_slash_command: 1
    }) // H
    insertPrompt({ typed_at: '2026-07-21T11:59:59.000Z', session_id: 's6', project: '/repo-a' }) // I
  }

  it('counts prompts inside the rolling 24-hour cutoff', () => {
    insertPrompt({ typed_at: '2026-08-19T12:00:00.000Z', session_id: 'inside' })
    insertPrompt({ typed_at: '2026-08-19T11:59:59.000Z', session_id: 'outside' })

    expect(getActivityStats(db, NOW)).toMatchObject({
      last24h: { days: 1, prompts: 1 }
    })
  })

  it('zero-fills 24 chronological hourly prompt buckets', () => {
    insertPrompt({ typed_at: '2026-08-19T12:00:00.000Z', session_id: 'first' })
    insertPrompt({ typed_at: '2026-08-19T13:15:00.000Z', session_id: 'second' })
    insertPrompt({ typed_at: '2026-08-20T11:59:59.000Z', session_id: 'last' })
    insertPrompt({
      typed_at: '2026-08-20T11:30:00.000Z',
      session_id: 'slash',
      is_slash_command: 1
    })

    const hourlyTrend = Reflect.get(getActivityStats(db, NOW).last24h, 'hourlyTrend')
    expect(hourlyTrend).toHaveLength(24)
    expect(hourlyTrend[0]).toEqual({ key: '2026-08-19T12:00:00.000Z', count: 1 })
    expect(hourlyTrend[1]).toEqual({ key: '2026-08-19T13:00:00.000Z', count: 1 })
    expect(hourlyTrend[23]).toEqual({ key: '2026-08-20T11:00:00.000Z', count: 1 })
    expect(
      hourlyTrend.reduce((sum: number, bucket: { count: number }) => sum + bucket.count, 0)
    ).toBe(3)
  })

  it('generatedAt is the passed-in now, and both windows carry their day count', () => {
    const stats = getActivityStats(db, NOW)
    expect(stats.generatedAt).toBe('2026-08-20T12:00:00.000Z')
    expect(stats.last7d.days).toBe(7)
    expect(stats.last30d.days).toBe(30)
  })

  it('counts real prompts only in the 7-day window, excluding slash commands', () => {
    seedFixture()
    const w = getActivityStats(db, NOW).last7d
    expect(w.prompts).toBe(4)
    expect(w.slashCommands).toBe(1)
    expect(w.sessions).toBe(3)
    expect(w.activeDays).toBe(3)
  })

  it('widens to the 30-day window: more prompts, sessions, active days, slash commands', () => {
    seedFixture()
    const w = getActivityStats(db, NOW).last30d
    expect(w.prompts).toBe(6)
    expect(w.slashCommands).toBe(2)
    expect(w.sessions).toBe(4)
    expect(w.activeDays).toBe(5)
  })

  it('includes a prompt exactly at the 7-day cutoff and excludes one a second earlier', () => {
    insertPrompt({ typed_at: '2026-08-13T12:00:00.000Z' })
    insertPrompt({ typed_at: '2026-08-13T11:59:59.000Z' })
    const stats = getActivityStats(db, NOW)
    expect(stats.last7d.prompts).toBe(1)
    expect(stats.last30d.prompts).toBe(2)
  })

  it('excludes prompts older than 30 days', () => {
    insertPrompt({ typed_at: '2026-07-21T12:00:00.000Z' })
    insertPrompt({ typed_at: '2026-07-21T11:59:59.000Z' })
    expect(getActivityStats(db, NOW).last30d.prompts).toBe(1)
  })

  it('places each prompt in the [weekday][hour] punchcard cell, local time', () => {
    seedFixture()
    const w = getActivityStats(db, NOW).last7d
    expect(w.byHourWeekday).toHaveLength(7)
    expect(w.byHourWeekday[0]).toHaveLength(24)
    expect(w.byHourWeekday[2][21]).toBe(2) // A + B: Tue 21:00 local
    expect(w.byHourWeekday[1][10]).toBe(1) // C: Mon 10:00 local
    expect(w.byHourWeekday[5][4]).toBe(1) // D: Fri 04:00 local
    // E (slash) would be Wed 01:00 — not counted
    expect(w.byHourWeekday[3][1]).toBe(0)
  })

  it('derives byHour and byWeekday as the margins of byHourWeekday', () => {
    seedFixture()
    for (const w of [getActivityStats(db, NOW).last7d, getActivityStats(db, NOW).last30d]) {
      const hourMargins = Array.from({ length: 24 }, (_, h) =>
        w.byHourWeekday.reduce((sum, row) => sum + row[h], 0)
      )
      const weekdayMargins = w.byHourWeekday.map((row) => row.reduce((sum, n) => sum + n, 0))
      expect(w.byHour).toEqual(hourMargins)
      expect(w.byWeekday).toEqual(weekdayMargins)
      expect(w.byHour.reduce((a, b) => a + b, 0)).toBe(w.prompts)
      expect(w.byWeekday.reduce((a, b) => a + b, 0)).toBe(w.prompts)
    }
  })

  it('ranks byProject by count descending', () => {
    seedFixture()
    expect(getActivityStats(db, NOW).last30d.byProject).toEqual([
      { project: '/repo-a', count: 3 },
      { project: '/repo-c', count: 2 },
      { project: '/repo-b', count: 1 }
    ])
  })

  it('zero-fills byDay across the window with a server-computed weekday', () => {
    seedFixture()
    const { byDay } = getActivityStats(db, NOW).last7d
    expect(byDay).toHaveLength(7)
    expect(byDay[0]).toEqual({ date: '2026-08-14', count: 1, weekday: 5 })
    expect(byDay[6]).toEqual({ date: '2026-08-20', count: 0, weekday: 4 })
    expect(byDay.find((d) => d.date === '2026-08-18')).toEqual({
      date: '2026-08-18',
      count: 2,
      weekday: 2
    })
    expect(byDay.reduce((sum, d) => sum + d.count, 0)).toBe(4)
  })

  it('spans 30 ascending days for the 30-day window', () => {
    seedFixture()
    const { byDay } = getActivityStats(db, NOW).last30d
    expect(byDay).toHaveLength(30)
    expect(byDay[0].date).toBe('2026-07-22')
    expect(byDay[29].date).toBe('2026-08-20')
    expect(byDay.find((d) => d.date === '2026-07-25')).toEqual({
      date: '2026-07-25',
      count: 1,
      weekday: 6
    })
    expect(byDay.reduce((sum, d) => sum + d.count, 0)).toBe(6)
  })

  it('returns zeroed windows when there is no prompt history', () => {
    const w = getActivityStats(db, NOW).last7d
    expect(w.prompts).toBe(0)
    expect(w.sessions).toBe(0)
    expect(w.activeDays).toBe(0)
    expect(w.byProject).toEqual([])
    expect(w.byHour).toEqual(Array(24).fill(0))
    expect(w.byWeekday).toEqual(Array(7).fill(0))
    expect(w.byDay).toHaveLength(7)
  })
})

describe('getCostStats', () => {
  const NOW = new Date('2026-09-07T12:00:00.000Z') // local Mon 2026-09-07 07:00 (UTC-5)

  function meta(sessionId: string, startedAt: string, cwd = '/repo-a'): void {
    db.prepare(
      `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
       VALUES (?, ?, NULL, ?, 0, 0)`
    ).run(sessionId, cwd, startedAt)
  }

  function addCost(overrides: {
    session_id: string
    started_at: string
    cwd?: string
    total_cost_usd?: number
    has_unknown_model_cost?: 0 | 1
    is_zeroed?: 0 | 1
    continued_in_session_id?: string | null
    models?: { model: string; cost_usd: number }[]
  }): void {
    meta(overrides.session_id, overrides.started_at, overrides.cwd ?? '/repo-a')
    db.prepare(
      `INSERT INTO session_cost
         (session_id, total_cost_usd, has_unknown_model_cost, is_zeroed, continued_in_session_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      overrides.session_id,
      overrides.total_cost_usd ?? 0,
      overrides.has_unknown_model_cost ?? 0,
      overrides.is_zeroed ?? 0,
      overrides.continued_in_session_id ?? null
    )
    for (const m of overrides.models ?? []) {
      db.prepare(
        `INSERT INTO session_model_cost
           (session_id, model, cost_usd, input_tokens, output_tokens, thinking_tokens,
            cache_read_tokens, cache_creation_tokens, web_search_requests)
         VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)`
      ).run(overrides.session_id, m.model, m.cost_usd)
    }
  }

  // p1/p2/p3 are priced terminals; z1 is zeroed; n1 is a non-terminal (continued into another);
  // pre1/pre2 predate the first priced session; crash1 is after it but has no cost row.
  function seedFixture(): void {
    addCost({
      session_id: 'p1',
      started_at: '2026-08-21T15:00:00.000Z', // local Fri Aug 21 10:00
      cwd: '/repo-a',
      total_cost_usd: 100,
      models: [
        { model: 'claude-sonnet-5', cost_usd: 80 },
        { model: 'claude-opus-5', cost_usd: 20 }
      ]
    })
    addCost({
      session_id: 'p2',
      started_at: '2026-08-25T18:00:00.000Z', // local Tue Aug 25 13:00
      cwd: '/repo-b',
      total_cost_usd: 50,
      has_unknown_model_cost: 1,
      models: [{ model: 'claude-sonnet-5', cost_usd: 50 }]
    })
    addCost({
      session_id: 'p3',
      started_at: '2026-09-06T02:00:00.000Z', // local Sat Sep 5 21:00
      cwd: '/repo-a',
      total_cost_usd: 30,
      models: [{ model: 'claude-haiku-4-5', cost_usd: 30 }]
    })
    addCost({ session_id: 'z1', started_at: '2026-08-30T12:00:00.000Z', is_zeroed: 1 })
    addCost({
      session_id: 'n1',
      started_at: '2026-09-01T12:00:00.000Z',
      total_cost_usd: 999,
      continued_in_session_id: 'p3',
      models: [{ model: 'claude-sonnet-5', cost_usd: 999 }]
    })
    meta('pre1', '2026-07-01T12:00:00.000Z')
    meta('pre2', '2026-08-01T12:00:00.000Z')
    meta('crash1', '2026-09-02T12:00:00.000Z')
  }

  it('returns null when there is no priced, lineage-terminal session', () => {
    addCost({ session_id: 'z1', started_at: '2026-08-30T12:00:00.000Z', is_zeroed: 1 })
    addCost({
      session_id: 'n1',
      started_at: '2026-09-01T12:00:00.000Z',
      total_cost_usd: 999,
      continued_in_session_id: 'x'
    })
    expect(getCostStats(db, NOW)).toBeNull()
  })

  it('sums only priced terminals into totalCostUsd and pricedSessionCount', () => {
    seedFixture()
    const stats = getCostStats(db, NOW)!
    expect(stats.totalCostUsd).toBe(180)
    expect(stats.pricedSessionCount).toBe(3)
  })

  it('sets trackedSince to the earliest priced-terminal started_at', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.trackedSince).toBe('2026-08-21T15:00:00.000Z')
  })

  it('counts sessions before trackedSince as preTrackingSessionCount, pure date cut', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.preTrackingSessionCount).toBe(2)
  })

  it('counts zeroed and cost-row-less sessions after trackedSince as unusable, excluding non-terminals', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.unusableSessionCount).toBe(2) // z1 + crash1, not n1
  })

  it('counts a pre-trackedSince zeroed session as pre-tracking, not unusable', () => {
    addCost({
      session_id: 'p1',
      started_at: '2026-08-21T15:00:00.000Z',
      total_cost_usd: 10,
      models: [{ model: 'claude-sonnet-5', cost_usd: 10 }]
    })
    addCost({ session_id: 'early-zero', started_at: '2026-08-01T00:00:00.000Z', is_zeroed: 1 })
    const stats = getCostStats(db, NOW)!
    expect(stats.preTrackingSessionCount).toBe(1)
    expect(stats.unusableSessionCount).toBe(0)
  })

  it('propagates hasUnknownModelCost from any priced terminal', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.hasUnknownModelCost).toBe(true)
  })

  it('does not propagate hasUnknownModelCost from a non-terminal row', () => {
    addCost({
      session_id: 'p1',
      started_at: '2026-08-21T15:00:00.000Z',
      total_cost_usd: 10,
      models: [{ model: 'claude-sonnet-5', cost_usd: 10 }]
    })
    addCost({
      session_id: 'n1',
      started_at: '2026-09-01T12:00:00.000Z',
      total_cost_usd: 5,
      has_unknown_model_cost: 1,
      continued_in_session_id: 'p1'
    })
    expect(getCostStats(db, NOW)!.hasUnknownModelCost).toBe(false)
  })

  it('aggregates byModel across priced terminals, descending with a model tie-break', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.byModel).toEqual([
      { model: 'claude-sonnet-5', costUsd: 130 },
      { model: 'claude-haiku-4-5', costUsd: 30 },
      { model: 'claude-opus-5', costUsd: 20 }
    ])
  })

  it('aggregates byProject by cwd across priced terminals, descending with a cwd tie-break', () => {
    seedFixture()
    expect(getCostStats(db, NOW)!.byProject).toEqual([
      { project: '/repo-a', costUsd: 130 },
      { project: '/repo-b', costUsd: 50 }
    ])
  })

  it('breaks equal byModel / byProject sums by name ascending', () => {
    addCost({
      session_id: 'p1',
      started_at: '2026-08-21T15:00:00.000Z',
      cwd: '/zzz',
      total_cost_usd: 10,
      models: [{ model: 'claude-sonnet-5', cost_usd: 10 }]
    })
    addCost({
      session_id: 'p2',
      started_at: '2026-08-22T15:00:00.000Z',
      cwd: '/aaa',
      total_cost_usd: 10,
      models: [{ model: 'claude-opus-5', cost_usd: 10 }]
    })
    const stats = getCostStats(db, NOW)!
    expect(stats.byModel.map((m) => m.model)).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    expect(stats.byProject.map((p) => p.project)).toEqual(['/aaa', '/zzz'])
  })

  it('zero-fills byDay from trackedSince to now with a server-computed weekday', () => {
    seedFixture()
    const { byDay } = getCostStats(db, NOW)!
    expect(byDay).toHaveLength(18) // Aug 21 .. Sep 7 inclusive
    expect(byDay[0]).toEqual({
      date: '2026-08-21',
      costUsd: 100,
      weekday: new Date(2026, 7, 21).getDay()
    })
    expect(byDay.at(-1)).toEqual({
      date: '2026-09-07',
      costUsd: 0,
      weekday: new Date(2026, 8, 7).getDay()
    })
    expect(byDay.find((d) => d.date === '2026-08-25')?.costUsd).toBe(50)
    expect(byDay.find((d) => d.date === '2026-09-05')?.costUsd).toBe(30)
    expect(byDay.reduce((sum, d) => sum + d.costUsd, 0)).toBe(180)
  })
})

describe('getSkillStats', () => {
  const NOW = new Date('2026-09-09T17:00:00.000Z') // local Wed 2026-09-09 12:00 (UTC-5)

  function insertSession(sessionId: string, startedAt: string): void {
    db.prepare(
      `INSERT INTO sessions_meta
         (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
       VALUES (?, '/repo', NULL, ?, 0, 0)`
    ).run(sessionId, startedAt)
  }

  function insertInvocation(overrides: {
    uuid: string
    sessionId: string
    skillName: string
    invokedAt: string
    triggerType?: 'user_invoked' | 'autonomous' | 'subagent'
  }): void {
    db.prepare(
      `INSERT INTO skill_invocations
         (source_uuid, session_id, skill_name, invoked_at, trigger_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      overrides.uuid,
      overrides.sessionId,
      overrides.skillName,
      overrides.invokedAt,
      overrides.triggerType ?? 'user_invoked'
    )
  }

  function insertCost(overrides: {
    sessionId: string
    totalCostUsd: number
    continuedInSessionId?: string | null
    isZeroed?: 0 | 1
  }): void {
    db.prepare(
      `INSERT INTO session_cost
         (session_id, total_cost_usd, has_unknown_model_cost, is_zeroed, continued_in_session_id)
       VALUES (?, ?, 0, ?, ?)`
    ).run(
      overrides.sessionId,
      overrides.totalCostUsd,
      overrides.isZeroed ?? 0,
      overrides.continuedInSessionId ?? null
    )
  }

  function insertModelOutput(sessionId: string, model: string, outputTokens: number): void {
    db.prepare(
      `INSERT INTO session_model_cost
         (session_id, model, cost_usd, input_tokens, output_tokens, thinking_tokens,
          cache_read_tokens, cache_creation_tokens, web_search_requests)
       VALUES (?, ?, 0, 0, ?, 0, 0, 0, 0)`
    ).run(sessionId, model, outputTokens)
  }

  it('returns a zero-valued 24-hour window when no skill invocations are indexed', () => {
    expect(getSkillStats(db, NOW).last24h.invocationCount).toBe(0)
  })

  it('applies rolling window cutoffs and counts distinct skills and sessions', () => {
    insertSession('recent', '2026-09-09T16:00:00.000Z')
    insertSession('week', '2026-09-07T17:00:00.000Z')
    insertSession('month', '2026-08-30T17:00:00.000Z')
    insertSession('old', '2026-08-01T17:00:00.000Z')

    insertInvocation({
      uuid: 'recent-1',
      sessionId: 'recent',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:00:00.000Z'
    })
    insertInvocation({
      uuid: 'recent-2',
      sessionId: 'recent',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:30:00.000Z'
    })
    insertInvocation({
      uuid: 'week-1',
      sessionId: 'week',
      skillName: 'beta',
      invokedAt: '2026-09-07T17:00:00.000Z'
    })
    insertInvocation({
      uuid: 'month-1',
      sessionId: 'month',
      skillName: 'alpha',
      invokedAt: '2026-08-30T17:00:00.000Z'
    })
    insertInvocation({
      uuid: 'old-1',
      sessionId: 'old',
      skillName: 'gamma',
      invokedAt: '2026-08-01T17:00:00.000Z'
    })

    const stats = getSkillStats(db, NOW)
    expect(stats.last24h).toMatchObject({ invocationCount: 2, skillCount: 1, sessionCount: 1 })
    expect(stats.last7d).toMatchObject({ invocationCount: 3, skillCount: 2, sessionCount: 2 })
    expect(stats.last30d).toMatchObject({ invocationCount: 4, skillCount: 2, sessionCount: 3 })
  })

  it('ranks skills by invocation count and preserves trigger classifications', () => {
    insertSession('s1', '2026-09-09T15:00:00.000Z')
    insertSession('s2', '2026-09-09T16:00:00.000Z')
    insertInvocation({
      uuid: 'a1',
      sessionId: 's1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T15:00:00.000Z'
    })
    insertInvocation({
      uuid: 'a2',
      sessionId: 's2',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:00:00.000Z',
      triggerType: 'autonomous'
    })
    insertInvocation({
      uuid: 'g1',
      sessionId: 's2',
      skillName: 'gamma',
      invokedAt: '2026-09-09T16:15:00.000Z',
      triggerType: 'subagent'
    })
    insertInvocation({
      uuid: 'b1',
      sessionId: 's1',
      skillName: 'beta',
      invokedAt: '2026-09-09T15:30:00.000Z'
    })

    const window = getSkillStats(db, NOW).last24h
    expect(window.bySkill).toEqual([
      { skillName: 'alpha', count: 2 },
      { skillName: 'beta', count: 1 },
      { skillName: 'gamma', count: 1 }
    ])
    expect(window.byTriggerType).toEqual([
      { trigger_type: 'user_invoked', count: 2 },
      { trigger_type: 'autonomous', count: 1 },
      { trigger_type: 'subagent', count: 1 }
    ])
  })

  it('zero-fills chronological hourly and daily trend buckets in local time', () => {
    insertSession('s1', '2026-09-08T18:00:00.000Z')
    insertInvocation({
      uuid: 'first-hour',
      sessionId: 's1',
      skillName: 'alpha',
      invokedAt: '2026-09-08T18:15:00.000Z'
    })
    insertInvocation({
      uuid: 'last-hour-1',
      sessionId: 's1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T17:05:00.000Z'
    })
    insertInvocation({
      uuid: 'last-hour-2',
      sessionId: 's1',
      skillName: 'beta',
      invokedAt: '2026-09-09T17:30:00.000Z'
    })

    const stats = getSkillStats(db, NOW)
    expect(stats.last24h.trend).toHaveLength(24)
    expect(stats.last24h.trend[0]).toEqual({ key: '2026-09-08T18:00:00.000Z', count: 1 })
    expect(stats.last24h.trend[23]).toEqual({ key: '2026-09-09T17:00:00.000Z', count: 2 })
    expect(stats.last24h.trend.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)

    expect(stats.last7d.trend).toHaveLength(7)
    expect(stats.last7d.trend[0].key).toBe('2026-09-03')
    expect(stats.last7d.trend[5]).toEqual({ key: '2026-09-08', count: 1 })
    expect(stats.last7d.trend[6]).toEqual({ key: '2026-09-09', count: 2 })
    expect(stats.last30d.trend).toHaveLength(30)
    expect(stats.last30d.trend[0].key).toBe('2026-08-11')
  })

  it('associates each usable session once per skill without attributing cost per invocation', () => {
    insertSession('priced-1', '2026-09-09T14:00:00.000Z')
    insertSession('priced-2', '2026-09-09T15:00:00.000Z')
    insertSession('untracked', '2026-09-09T16:00:00.000Z')
    insertCost({ sessionId: 'priced-1', totalCostUsd: 10 })
    insertCost({ sessionId: 'priced-2', totalCostUsd: 5 })
    insertModelOutput('priced-1', 'claude-sonnet-5', 200)
    insertModelOutput('priced-1', 'claude-opus-5', 100)
    insertModelOutput('priced-2', 'claude-sonnet-5', 50)

    insertInvocation({
      uuid: 'alpha-1',
      sessionId: 'priced-1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T14:05:00.000Z'
    })
    insertInvocation({
      uuid: 'alpha-2',
      sessionId: 'priced-1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T14:10:00.000Z'
    })
    insertInvocation({
      uuid: 'beta-1',
      sessionId: 'priced-1',
      skillName: 'beta',
      invokedAt: '2026-09-09T14:15:00.000Z'
    })
    insertInvocation({
      uuid: 'alpha-3',
      sessionId: 'priced-2',
      skillName: 'alpha',
      invokedAt: '2026-09-09T15:05:00.000Z'
    })
    insertInvocation({
      uuid: 'alpha-4',
      sessionId: 'untracked',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:05:00.000Z'
    })
    insertInvocation({
      uuid: 'gamma-1',
      sessionId: 'untracked',
      skillName: 'gamma',
      invokedAt: '2026-09-09T16:10:00.000Z'
    })

    expect(getSkillStats(db, NOW).last24h.associations).toEqual([
      {
        skillName: 'alpha',
        skillId: null,
        sourceType: null,
        sessionCount: 3,
        trackedSessionCount: 2,
        associatedCostUsd: 15,
        associatedOutputTokens: 350
      },
      {
        skillName: 'beta',
        skillId: null,
        sourceType: null,
        sessionCount: 1,
        trackedSessionCount: 1,
        associatedCostUsd: 10,
        associatedOutputTokens: 300
      },
      {
        skillName: 'gamma',
        skillId: null,
        sourceType: null,
        sessionCount: 1,
        trackedSessionCount: 0,
        associatedCostUsd: 0,
        associatedOutputTokens: 0
      }
    ])
  })

  it('resolves continued sessions to one priced terminal and rejects unusable lineages', () => {
    for (const sessionId of ['ancestor', 'terminal', 'zeroed', 'broken', 'cycle-a', 'cycle-b']) {
      insertSession(sessionId, '2026-09-09T14:00:00.000Z')
    }
    insertCost({ sessionId: 'ancestor', totalCostUsd: 3, continuedInSessionId: 'terminal' })
    insertCost({ sessionId: 'terminal', totalCostUsd: 7 })
    insertModelOutput('terminal', 'claude-sonnet-5', 700)
    insertCost({ sessionId: 'zeroed', totalCostUsd: 0, isZeroed: 1 })
    insertCost({ sessionId: 'broken', totalCostUsd: 2, continuedInSessionId: 'missing' })
    insertCost({ sessionId: 'cycle-a', totalCostUsd: 4, continuedInSessionId: 'cycle-b' })
    insertCost({ sessionId: 'cycle-b', totalCostUsd: 5, continuedInSessionId: 'cycle-a' })

    insertInvocation({
      uuid: 'ancestor-alpha',
      sessionId: 'ancestor',
      skillName: 'alpha',
      invokedAt: '2026-09-09T14:05:00.000Z'
    })
    insertInvocation({
      uuid: 'zeroed-beta',
      sessionId: 'zeroed',
      skillName: 'beta',
      invokedAt: '2026-09-09T14:15:00.000Z'
    })
    insertInvocation({
      uuid: 'broken-gamma',
      sessionId: 'broken',
      skillName: 'gamma',
      invokedAt: '2026-09-09T14:20:00.000Z'
    })
    insertInvocation({
      uuid: 'cycle-delta',
      sessionId: 'cycle-a',
      skillName: 'delta',
      invokedAt: '2026-09-09T14:25:00.000Z'
    })

    const associations = getSkillStats(db, NOW).last24h.associations
    expect(associations.find((row) => row.skillName === 'alpha')).toEqual({
      skillName: 'alpha',
      skillId: null,
      sourceType: null,
      sessionCount: 1,
      trackedSessionCount: 1,
      associatedCostUsd: 7,
      associatedOutputTokens: 700
    })
    for (const skillName of ['beta', 'gamma', 'delta']) {
      expect(associations.find((row) => row.skillName === skillName)).toMatchObject({
        trackedSessionCount: 0,
        associatedCostUsd: 0,
        associatedOutputTokens: 0
      })
    }
  })

  it('resolves an association skillId and sourceType by shadowing precedence', () => {
    const globalId = insertSkill('alpha', { source_type: 'global' })
    insertSkill('alpha', {
      source_type: 'project',
      project_root: '/repo',
      source_path: '/repo/.claude/skills/alpha'
    })
    insertSession('s1', '2026-09-09T16:00:00.000Z')
    insertInvocation({
      uuid: 'a1',
      sessionId: 's1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:00:00.000Z'
    })

    expect(getSkillStats(db, NOW).last24h.associations[0]).toMatchObject({
      skillName: 'alpha',
      skillId: globalId,
      sourceType: 'global'
    })
  })

  it('resolves an association to the non-synced skill when a synced skill shares the name', () => {
    const globalId = insertSkill('alpha', { source_type: 'global', is_synced: 0 })
    insertSkill('alpha', {
      source_type: 'global',
      is_synced: 1,
      source_path: '/synced/alpha'
    })
    insertSession('s1', '2026-09-09T16:00:00.000Z')
    insertInvocation({
      uuid: 'a1',
      sessionId: 's1',
      skillName: 'alpha',
      invokedAt: '2026-09-09T16:00:00.000Z'
    })

    expect(getSkillStats(db, NOW).last24h.associations[0]).toMatchObject({
      skillId: globalId,
      sourceType: 'global'
    })
  })

  it('reports null skillId and sourceType when no skills row matches the invocation name', () => {
    insertSession('s1', '2026-09-09T16:00:00.000Z')
    insertInvocation({
      uuid: 'g1',
      sessionId: 's1',
      skillName: 'ghost',
      invokedAt: '2026-09-09T16:00:00.000Z'
    })

    expect(getSkillStats(db, NOW).last24h.associations[0]).toMatchObject({
      skillName: 'ghost',
      skillId: null,
      sourceType: null
    })
  })

  it('counts priced terminals that no skill resolves to as pricedSessionsWithoutSkill', () => {
    insertSession('with-skill', '2026-09-09T14:00:00.000Z')
    insertSession('no-skill', '2026-09-09T15:00:00.000Z')
    insertCost({ sessionId: 'with-skill', totalCostUsd: 10 })
    insertCost({ sessionId: 'no-skill', totalCostUsd: 5 })
    insertInvocation({
      uuid: 'a1',
      sessionId: 'with-skill',
      skillName: 'alpha',
      invokedAt: '2026-09-09T14:05:00.000Z'
    })

    expect(getSkillStats(db, NOW).pricedSessionsWithoutSkill).toBe(1)
  })

  it('excludes a priced terminal from the skill-less count when its only invocation predates the 30-day window', () => {
    insertSession('old', '2026-07-26T17:00:00.000Z')
    insertCost({ sessionId: 'old', totalCostUsd: 5 })
    insertInvocation({
      uuid: 'old-1',
      sessionId: 'old',
      skillName: 'alpha',
      invokedAt: '2026-07-26T17:00:00.000Z'
    })

    expect(getSkillStats(db, NOW).pricedSessionsWithoutSkill).toBe(0)
  })

  it('does not count non-terminal or zeroed sessions toward the skill-less count', () => {
    insertSession('non-terminal', '2026-09-09T14:00:00.000Z')
    insertSession('zeroed', '2026-09-09T15:00:00.000Z')
    insertCost({ sessionId: 'non-terminal', totalCostUsd: 3, continuedInSessionId: 'gone' })
    insertCost({ sessionId: 'zeroed', totalCostUsd: 0, isZeroed: 1 })

    expect(getSkillStats(db, NOW).pricedSessionsWithoutSkill).toBe(0)
  })

  it('does not count a terminal reached only through an ancestor invocation as skill-less', () => {
    insertSession('ancestor', '2026-09-09T14:00:00.000Z')
    insertSession('terminal', '2026-09-09T15:00:00.000Z')
    insertCost({ sessionId: 'ancestor', totalCostUsd: 3, continuedInSessionId: 'terminal' })
    insertCost({ sessionId: 'terminal', totalCostUsd: 7 })
    insertInvocation({
      uuid: 'anc-1',
      sessionId: 'ancestor',
      skillName: 'alpha',
      invokedAt: '2026-09-09T14:05:00.000Z'
    })

    expect(getSkillStats(db, NOW).pricedSessionsWithoutSkill).toBe(0)
  })
})

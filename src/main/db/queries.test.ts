import Database from 'better-sqlite3'
import { resolve } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import {
  addAllowedPath,
  deleteSkillsForProjectRoot,
  getContextBudget,
  getSkillById,
  getSkillUsageDetail,
  listAllowedPaths,
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
  } = {}
): number {
  db.prepare(
    `INSERT INTO skills
       (name, source_type, source_path, plugin_name, description, last_scanned_at,
        est_listing_tokens, est_body_tokens, project_root)
     VALUES (?, ?, ?, NULL, NULL, '2026-08-14T00:00:00.000Z', ?, 0, ?)`
  ).run(
    name,
    overrides.source_type ?? 'global',
    overrides.source_path ?? `/skills/${name}`,
    overrides.est_listing_tokens ?? 0,
    overrides.project_root ?? null
  )
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
}

function insertSession(sessionId: string, cwd = '/repo'): void {
  db.prepare(
    `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
     VALUES (?, ?, NULL, '2026-08-14T00:00:00.000Z', 0, 0)`
  ).run(sessionId, cwd)
}

function insertInvocation(overrides: {
  source_uuid: string
  session_id: string
  skill_name: string
  invoked_at?: string
  trigger_type?: string
  preceding_user_text?: string | null
}): void {
  db.prepare(
    `INSERT INTO skill_invocations
       (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id, preceding_user_text)
     VALUES (@source_uuid, @session_id, @skill_name, NULL, @invoked_at, @trigger_type, NULL, @preceding_user_text)`
  ).run({
    source_uuid: overrides.source_uuid,
    session_id: overrides.session_id,
    skill_name: overrides.skill_name,
    invoked_at: overrides.invoked_at ?? '2026-08-14T00:00:00.000Z',
    trigger_type: overrides.trigger_type ?? 'autonomous',
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
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('grill-me', 'plugin', '/plugins/grill-me', 'taste@leonxlnx', 'Interview the user', '2026-08-14T00:00:00.000Z')`
    ).run()
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('frontend-design', 'global', '/global/frontend-design', NULL, NULL, '2026-08-14T00:00:00.000Z')`
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
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('grill-me', 'global', '/global/grill-me', NULL, 'Interview the user', '2026-08-14T00:00:00.000Z')`
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
        lint_status: 'warning',
        error_count: 0,
        warning_count: 1
      })
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
      'older message'
    ])
  })

  it('excludes image-caption-stub trigger text', () => {
    const id = insertSkill('grill-me')
    insertSession('sess-1')
    insertInvocation({
      source_uuid: 'uuid-1',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      preceding_user_text: '[Image: original 2438x1460, displayed at 2000x1198]'
    })
    insertInvocation({
      source_uuid: 'uuid-2',
      session_id: 'sess-1',
      skill_name: 'grill-me',
      preceding_user_text: 'a real message'
    })

    const detail = getSkillUsageDetail(db, getSkillById(db, id)!)

    expect(detail.recentTriggers.map((t) => t.preceding_user_text)).toEqual(['a real message'])
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

describe('getContextBudget', () => {
  it('sums est_listing_tokens across global and plugin skills only, excluding project', () => {
    insertSkill('a', { source_type: 'global', est_listing_tokens: 500 })
    insertSkill('b', { source_type: 'plugin', est_listing_tokens: 700 })
    insertSkill('c', { source_type: 'project', est_listing_tokens: 100000 })

    expect(getContextBudget(db)).toEqual({ used: 1200, limit: 2000 })
  })

  it('returns 0 used when there are no skills indexed', () => {
    expect(getContextBudget(db)).toEqual({ used: 0, limit: 2000 })
  })
})

import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
})

describe('applySchema', () => {
  it('creates all six tables', () => {
    applySchema(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining([
        'skills',
        'sessions_meta',
        'skill_invocations',
        'plugin_registry',
        'allowed_paths',
        'lint_findings'
      ])
    )
  })

  it('rejects an invalid lint_findings.severity', () => {
    applySchema(db)
    const insertSkill = db.prepare(
      `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at)
       VALUES ('skill-a', 'global', '/path/a', 'desc', ?)`
    )
    insertSkill.run(new Date().toISOString())
    const skill = db.prepare('SELECT id FROM skills LIMIT 1').get() as { id: number }

    const insertFinding = db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'rule-1', 'critical', 'msg', NULL, NULL, NULL, ?)`
    )
    expect(() => insertFinding.run(skill.id, new Date().toISOString())).toThrow()
  })

  it('enables foreign_keys so lint_findings cascade without a manual pragma', () => {
    applySchema(db)
    const insertSkill = db.prepare(
      `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at)
       VALUES ('skill-a', 'global', '/path/a', 'desc', ?)`
    )
    insertSkill.run(new Date().toISOString())
    const skill = db.prepare('SELECT id FROM skills LIMIT 1').get() as { id: number }

    db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'rule-1', 'error', 'msg', NULL, NULL, NULL, ?)`
    ).run(skill.id, new Date().toISOString())

    db.prepare('DELETE FROM skills WHERE id = ?').run(skill.id)
    expect(db.prepare('SELECT COUNT(*) as count FROM lint_findings').get()).toEqual({ count: 0 })
  })

  it('cascades deletion of lint_findings when parent skill is deleted', () => {
    applySchema(db)
    db.pragma('foreign_keys = ON')
    const insertSkill = db.prepare(
      `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at)
       VALUES ('skill-a', 'global', '/path/a', 'desc', ?)`
    )
    insertSkill.run(new Date().toISOString())
    const skill = db.prepare('SELECT id FROM skills LIMIT 1').get() as { id: number }

    db.prepare(
      `INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
       VALUES (?, 'rule-1', 'error', 'msg', NULL, NULL, NULL, ?)`
    ).run(skill.id, new Date().toISOString())

    expect(db.prepare('SELECT COUNT(*) as count FROM lint_findings').get()).toEqual({ count: 1 })
    db.prepare('DELETE FROM skills WHERE id = ?').run(skill.id)
    expect(db.prepare('SELECT COUNT(*) as count FROM lint_findings').get()).toEqual({ count: 0 })
  })

  it('rejects a duplicate allowed_paths.path', () => {
    applySchema(db)
    const insert = db.prepare(`INSERT INTO allowed_paths (path, granted_at) VALUES (?, ?)`)
    const now = new Date().toISOString()
    insert.run('/path/to/repo', now)
    expect(() => insert.run('/path/to/repo', now)).toThrow()
  })

  it('is idempotent — running twice does not throw', () => {
    applySchema(db)
    expect(() => applySchema(db)).not.toThrow()
  })

  it('rejects a duplicate skills.source_path', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at)
       VALUES (?, 'global', ?, NULL, ?)`
    )
    insert.run('foo', '/path/to/foo', new Date().toISOString())
    expect(() => insert.run('foo2', '/path/to/foo', new Date().toISOString())).toThrow()
  })

  it('rejects an out-of-enum skills.source_type', () => {
    applySchema(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at)
           VALUES ('foo', 'builtin', '/path/to/foo', NULL, ?)`
        )
        .run(new Date().toISOString())
    ).toThrow()
  })

  it('allows the same plugin name under two different marketplaces', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
       VALUES (?, ?, NULL, '1.0.0', 'user', '/path', ?)`
    )
    const now = new Date().toISOString()
    expect(() => {
      insert.run('same-name', 'marketplace-a', now)
      insert.run('same-name', 'marketplace-b', now)
    }).not.toThrow()
  })

  it('rejects the same (name, marketplace) pair twice', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
       VALUES (?, ?, NULL, '1.0.0', 'user', '/path', ?)`
    )
    const now = new Date().toISOString()
    insert.run('same-name', 'marketplace-a', now)
    expect(() => insert.run('same-name', 'marketplace-a', now)).toThrow()
  })

  it('rejects a duplicate skill_invocations.source_uuid', () => {
    applySchema(db)
    db.prepare(
      `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
       VALUES ('session-1', '/cwd', NULL, ?, 0, 0)`
    ).run(new Date().toISOString())
    const insert = db.prepare(
      `INSERT INTO skill_invocations (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type)
       VALUES (?, 'session-1', 'some-skill', NULL, ?, 'autonomous')`
    )
    const now = new Date().toISOString()
    insert.run('uuid-1', now)
    expect(() => insert.run('uuid-1', now)).toThrow()
  })

  it('rejects an out-of-enum skill_invocations.trigger_type', () => {
    applySchema(db)
    db.prepare(
      `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
       VALUES ('session-1', '/cwd', NULL, ?, 0, 0)`
    ).run(new Date().toISOString())
    expect(() =>
      db
        .prepare(
          `INSERT INTO skill_invocations (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type)
           VALUES ('uuid-1', 'session-1', 'some-skill', NULL, ?, 'made_up_type')`
        )
        .run(new Date().toISOString())
    ).toThrow()
  })

  it('accepts subagent as a valid skill_invocations.trigger_type, with a nullable agent_id', () => {
    applySchema(db)
    db.prepare(
      `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
       VALUES ('session-1', '/cwd', NULL, ?, 0, 0)`
    ).run(new Date().toISOString())

    expect(() =>
      db
        .prepare(
          `INSERT INTO skill_invocations
             (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id)
           VALUES ('uuid-1', 'session-1', 'some-skill', NULL, ?, 'subagent', 'agent-abc123')`
        )
        .run(new Date().toISOString())
    ).not.toThrow()

    const row = db
      .prepare('SELECT agent_id FROM skill_invocations WHERE source_uuid = ?')
      .get('uuid-1') as { agent_id: string }
    expect(row.agent_id).toBe('agent-abc123')
  })

  it('accepts local as a plugin_registry.scope', () => {
    applySchema(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO plugin_registry
             (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
           VALUES ('plugin-a', 'market-1', NULL, '1.0.0', 'local', '/path', ?)`
        )
        .run(new Date().toISOString())
    ).not.toThrow()
  })

  it('rejects an out-of-enum plugin_registry.scope', () => {
    applySchema(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO plugin_registry
             (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
           VALUES ('plugin-a', 'market-1', NULL, '1.0.0', 'global', '/path', ?)`
        )
        .run(new Date().toISOString())
    ).toThrow()
  })

  // Claude Code's install path is version-addressed (cache/<marketplace>/<plugin>/<version>), so
  // one plugin installed at the same version for two scopes shares a single installPath.
  it('keeps a user and a project install sharing one install_path as two rows', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at, project_path)
       VALUES ('plugin-a', 'market-1', NULL, '1.0.0', ?, '/cache/plugin-a/1.0.0', ?, ?)`
    )
    const now = new Date().toISOString()
    insert.run('user', now, '')
    insert.run('project', now, '/repo')

    expect(db.prepare('SELECT COUNT(*) AS count FROM plugin_registry').get()).toEqual({ count: 2 })
  })

  it('keeps two projects installing one plugin at the same version as two rows', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at, project_path)
       VALUES ('plugin-a', 'market-1', NULL, '1.0.0', 'project', '/cache/plugin-a/1.0.0', ?, ?)`
    )
    const now = new Date().toISOString()
    insert.run(now, '/repo-a')
    insert.run(now, '/repo-b')

    expect(db.prepare('SELECT COUNT(*) AS count FROM plugin_registry').get()).toEqual({ count: 2 })
  })

  // project_path is NOT NULL DEFAULT '' rather than nullable because SQLite does not enforce
  // NOT NULL on a non-integer PRIMARY KEY, and ON CONFLICT never matches a NULL — a nullable
  // column here would make every scan insert a fresh duplicate row for every user-scope install.
  it('rejects a second user install differing only by an absent project_path', () => {
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
       VALUES ('plugin-a', 'market-1', NULL, '1.0.0', 'user', '/path', ?)`
    )
    const now = new Date().toISOString()
    insert.run(now)
    expect(() => insert.run(now)).toThrow()
  })

  it('defaults project_path to the empty string when the insert omits it', () => {
    applySchema(db)
    db.prepare(
      `INSERT INTO plugin_registry
         (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
       VALUES ('plugin-a', 'market-1', NULL, '1.0.0', 'user', '/path', ?)`
    ).run(new Date().toISOString())

    expect(db.prepare('SELECT project_path FROM plugin_registry').get()).toEqual({
      project_path: ''
    })
  })

  it('accepts a project_root value on a skills row', () => {
    applySchema(db)
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, description, last_scanned_at, project_root)
       VALUES ('foo', 'project', '/repo/.claude/skills/foo', NULL, ?, '/repo')`
    ).run(new Date().toISOString())
    const row = db.prepare('SELECT project_root FROM skills WHERE name = ?').get('foo') as {
      project_root: string
    }
    expect(row.project_root).toBe('/repo')
  })
})

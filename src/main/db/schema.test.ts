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

  it('adds agent_id column if skill_invocations was created from an older schema', () => {
    db.exec(`
      CREATE TABLE skill_invocations (
        id INTEGER PRIMARY KEY,
        source_uuid TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        args_text TEXT,
        invoked_at TEXT NOT NULL,
        trigger_type TEXT NOT NULL
      );
    `)
    applySchema(db)
    const cols = db.prepare("PRAGMA table_info('skill_invocations')").all() as { name: string }[]
    expect(cols.some((c) => c.name === 'agent_id')).toBe(true)
  })

  it('adds preceding_user_text column if skill_invocations was created from an older schema', () => {
    db.exec(`
      CREATE TABLE skill_invocations (
        id INTEGER PRIMARY KEY,
        source_uuid TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        args_text TEXT,
        invoked_at TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        agent_id TEXT
      );
    `)
    applySchema(db)
    const cols = db.prepare("PRAGMA table_info('skill_invocations')").all() as { name: string }[]
    expect(cols.some((c) => c.name === 'preceding_user_text')).toBe(true)
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

  it('adds project_root and token columns if skills was created from an older schema', () => {
    db.exec(`
      CREATE TABLE skills (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_path TEXT NOT NULL UNIQUE,
        plugin_name TEXT,
        description TEXT,
        last_scanned_at TEXT NOT NULL
      );
    `)
    applySchema(db)
    const cols = db.prepare("PRAGMA table_info('skills')").all() as { name: string }[]
    expect(cols.some((c) => c.name === 'project_root')).toBe(true)
    expect(cols.some((c) => c.name === 'est_listing_tokens')).toBe(true)
    expect(cols.some((c) => c.name === 'est_body_tokens')).toBe(true)
  })
})

import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
})

describe('applySchema', () => {
  it('creates all four tables', () => {
    applySchema(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['skills', 'sessions_meta', 'skill_invocations', 'plugin_registry'])
    )
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
})

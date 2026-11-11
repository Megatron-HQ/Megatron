import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openUsageArchive } from './usage-archive'

// The archive outlives Claude Code's ~30-day history.jsonl retention, so it can never be rebuilt.
// This is the shape every archive written so far has. Changes must be additive (new tables, or a
// guarded nullable/defaulted ADD COLUMN); see "usage-history.db is additive-only" in
// docs/data-model.md. Never edit this literal to make a test pass.
const SHIPPED_ARCHIVE_DDL = `
  CREATE TABLE history_prompts (
    session_id TEXT NOT NULL, project TEXT NOT NULL, typed_at TEXT NOT NULL,
    is_slash_command INTEGER NOT NULL, copies INTEGER NOT NULL,
    PRIMARY KEY(session_id, project, typed_at, is_slash_command)
  );
  CREATE TABLE history_coverage (start_at TEXT PRIMARY KEY, end_at TEXT NOT NULL);
  CREATE TABLE history_sessions (
    session_id TEXT PRIMARY KEY, project TEXT NOT NULL, started_at TEXT NOT NULL,
    continued_in_session_id TEXT, has_totals INTEGER NOT NULL, is_zeroed INTEGER NOT NULL
  );
  CREATE TABLE history_models (
    session_id TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL,
    PRIMARY KEY(session_id, model)
  );
  CREATE TABLE history_turns (
    logical_turn_key TEXT PRIMARY KEY, source_uuid TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL, model TEXT NOT NULL, invoked_at TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
  );
  CREATE TABLE history_token_shares (
    session_id TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL, allocated_at TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
  );
  CREATE TABLE history_undated_tokens (
    session_id TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
  );
  CREATE TABLE history_plugin_skills (
    plugin_name TEXT NOT NULL, skill_name TEXT NOT NULL, first_seen_at TEXT NOT NULL,
    PRIMARY KEY(plugin_name, skill_name)
  );
`

type Shape = Record<string, { name: string; type: string; notnull: number; pk: number }[]>

function shapeOf(db: Database.Database): Shape {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      (
        db.prepare(`PRAGMA table_info(${name})`).all() as {
          name: string
          type: string
          notnull: number
          pk: number
        }[]
      ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }))
    ])
  )
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'megatron-archive-test-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('usage archive compatibility', () => {
  it('keeps every shipped column with its type, nullability and key unchanged', () => {
    const shipped = new Database(':memory:')
    shipped.exec(SHIPPED_ARCHIVE_DDL)
    const current = openUsageArchive(':memory:')
    const currentShape = shapeOf(current)
    for (const [table, columns] of Object.entries(shapeOf(shipped)))
      expect(currentShape[table], table).toEqual(expect.arrayContaining(columns))
    shipped.close()
    current.close()
  })

  it('brings a shipped archive up to the current shape without losing rows', () => {
    const path = join(root, 'usage-history.db')
    const shipped = new Database(path)
    shipped.exec(SHIPPED_ARCHIVE_DDL)
    shipped
      .prepare(
        "INSERT INTO history_coverage (start_at, end_at) VALUES ('2026-01-01', '2026-01-31')"
      )
      .run()
    shipped.close()

    const upgraded = openUsageArchive(path)
    const fresh = openUsageArchive(':memory:')
    expect(shapeOf(upgraded)).toEqual(shapeOf(fresh))
    expect(upgraded.prepare('SELECT start_at, end_at FROM history_coverage').all()).toEqual([
      { start_at: '2026-01-01', end_at: '2026-01-31' }
    ])
    upgraded.close()
    fresh.close()
  })
})

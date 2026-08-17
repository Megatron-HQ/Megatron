import type Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)

  // Retrofit columns if database was initialized with an earlier schema version
  const skillInvocationsCols = db.prepare("PRAGMA table_info('skill_invocations')").all() as {
    name: string
  }[]
  if (skillInvocationsCols.length > 0) {
    if (!skillInvocationsCols.some((c) => c.name === 'agent_id')) {
      db.exec('ALTER TABLE skill_invocations ADD COLUMN agent_id TEXT')
    }
    if (!skillInvocationsCols.some((c) => c.name === 'preceding_user_text')) {
      db.exec('ALTER TABLE skill_invocations ADD COLUMN preceding_user_text TEXT')
    }
  }

  const skillsCols = db.prepare("PRAGMA table_info('skills')").all() as { name: string }[]
  if (skillsCols.length > 0) {
    if (!skillsCols.some((c) => c.name === 'project_root')) {
      db.exec('ALTER TABLE skills ADD COLUMN project_root TEXT')
    }
    if (!skillsCols.some((c) => c.name === 'est_listing_tokens')) {
      db.exec('ALTER TABLE skills ADD COLUMN est_listing_tokens INTEGER NOT NULL DEFAULT 0')
    }
    if (!skillsCols.some((c) => c.name === 'est_body_tokens')) {
      db.exec('ALTER TABLE skills ADD COLUMN est_body_tokens INTEGER NOT NULL DEFAULT 0')
    }
  }
}

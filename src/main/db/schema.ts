import type Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

export function applySchema(db: Database.Database): void {
  db.exec(schemaSql)

  // Retrofit columns if database was initialized with an earlier schema version
  const skillInvocationsCols = db.prepare("PRAGMA table_info('skill_invocations')").all() as {
    name: string
  }[]
  if (skillInvocationsCols.length > 0 && !skillInvocationsCols.some((c) => c.name === 'agent_id')) {
    db.exec('ALTER TABLE skill_invocations ADD COLUMN agent_id TEXT')
  }
}

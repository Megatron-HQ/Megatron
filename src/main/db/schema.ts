import type Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

function migrateSkillInvocationTriggerTypes(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'skill_invocations'")
    .get() as { sql: string } | undefined
  const tableSql = table?.sql?.toLowerCase() ?? ''
  if (tableSql.includes('user_invoked') && tableSql.includes('subagent')) return

  db.transaction(() => {
    db.exec(`
      CREATE TABLE skill_invocations_rebuild (
        id INTEGER PRIMARY KEY,
        source_uuid TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL REFERENCES sessions_meta(session_id),
        skill_name TEXT NOT NULL,
        args_text TEXT,
        invoked_at TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK (
          trigger_type IN ('user_invoked', 'autonomous', 'subagent')
        ),
        agent_id TEXT,
        preceding_user_text TEXT
      );
      INSERT INTO skill_invocations_rebuild
        (id, source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id, preceding_user_text)
      SELECT id, source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id, preceding_user_text
      FROM skill_invocations;
      DROP TABLE skill_invocations;
      ALTER TABLE skill_invocations_rebuild RENAME TO skill_invocations;
    `)
  })()
}

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)

  const pluginRegistryColumns = db.prepare("PRAGMA table_info('plugin_registry')").all() as {
    name: string
    pk: number
  }[]
  const pluginRegistryPrimaryKey = pluginRegistryColumns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)
  if (
    pluginRegistryPrimaryKey.length > 0 &&
    pluginRegistryPrimaryKey.join(',') !== 'name,marketplace,install_path'
  ) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE plugin_registry_rebuild (
          name TEXT NOT NULL,
          marketplace TEXT NOT NULL,
          marketplace_repo TEXT,
          installed_version TEXT NOT NULL,
          scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
          install_path TEXT NOT NULL,
          last_scanned_at TEXT NOT NULL,
          PRIMARY KEY (name, marketplace, install_path)
        );
        INSERT INTO plugin_registry_rebuild
          (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
        SELECT name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at
        FROM plugin_registry;
        DROP TABLE plugin_registry;
        ALTER TABLE plugin_registry_rebuild RENAME TO plugin_registry;
      `)
    })()
  }

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
    migrateSkillInvocationTriggerTypes(db)
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
    if (!skillsCols.some((c) => c.name === 'is_synced')) {
      db.exec('ALTER TABLE skills ADD COLUMN is_synced INTEGER NOT NULL DEFAULT 0')
    }
  }

  const sessionsMetaCols = db.prepare("PRAGMA table_info('sessions_meta')").all() as {
    name: string
  }[]
  if (
    sessionsMetaCols.length > 0 &&
    !sessionsMetaCols.some((column) => column.name === 'source_size_bytes')
  ) {
    db.exec('ALTER TABLE sessions_meta ADD COLUMN source_size_bytes INTEGER NOT NULL DEFAULT -1')
  }
  if (
    sessionsMetaCols.length > 0 &&
    !sessionsMetaCols.some((column) => column.name === 'transcript_parser_version')
  ) {
    db.exec(
      'ALTER TABLE sessions_meta ADD COLUMN transcript_parser_version INTEGER NOT NULL DEFAULT 0'
    )
  }
}

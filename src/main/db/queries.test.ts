import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { listSkills } from './queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
})

describe('listSkills', () => {
  it('returns an empty array when no skills are indexed', () => {
    expect(listSkills(db)).toEqual([])
  })

  it('returns every skill row with all columns intact', () => {
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('grill-me', 'plugin', '/plugins/grill-me', 'taste@leonxlnx', 'Interview the user', '2026-08-14T00:00:00.000Z')`
    ).run()
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('frontend-design', 'global', '/global/frontend-design', NULL, NULL, '2026-08-14T00:00:00.000Z')`
    ).run()

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
          last_scanned_at: '2026-08-14T00:00:00.000Z'
        }),
        expect.objectContaining({
          name: 'frontend-design',
          source_type: 'global',
          source_path: '/global/frontend-design',
          plugin_name: null,
          description: null
        })
      ])
    )
  })
})

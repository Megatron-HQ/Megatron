import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { listSkills, writeSkillScan, writeSkillScanAuthoritative } from './queries'

let db: Database.Database

function allSkills(): {
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
}[] {
  return db.prepare('SELECT * FROM skills ORDER BY source_path').all() as ReturnType<
    typeof allSkills
  >
}

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

describe('writeSkillScanAuthoritative', () => {
  it('inserts rows for a fresh scan', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'Interview the user'
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
        description: 'Old'
      }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [
      {
        name: 'grill-me',
        source_path: '/plugins/grill-me',
        plugin_name: 'taste@leonxlnx',
        description: 'New'
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
        description: 'A'
      }
    ])
    // Same source_path re-appears from a different source_type's scan (tier changed).
    writeSkillScanAuthoritative(db, 'global', [
      { name: 'grill-me', source_path: '/shared/grill-me', plugin_name: null, description: 'A' }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_type: 'global', plugin_name: null })
  })

  it('deletes every row of that source_type not present in this scan', () => {
    writeSkillScanAuthoritative(db, 'plugin', [
      { name: 'a', source_path: '/plugins/a', plugin_name: 'a@m', description: null },
      { name: 'b', source_path: '/plugins/b', plugin_name: 'b@m', description: null }
    ])
    writeSkillScanAuthoritative(db, 'plugin', [
      { name: 'a', source_path: '/plugins/a', plugin_name: 'a@m', description: null }
    ])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].source_path).toBe('/plugins/a')
  })

  it('leaves rows of other source_types untouched', () => {
    writeSkillScanAuthoritative(db, 'global', [
      { name: 'g', source_path: '/global/g', plugin_name: null, description: null }
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
        { name: 'a', source_path: '/roots/global/a', plugin_name: null, description: null },
        { name: 'b', source_path: '/roots/global/b', plugin_name: null, description: null }
      ],
      ['/roots/global']
    )
    writeSkillScan(
      db,
      'global',
      [{ name: 'a', source_path: '/roots/global/a', plugin_name: null, description: null }],
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
          description: null
        }
      ],
      ['/roots/project-b']
    )

    // A separate scan call that only covers project-a's root.
    writeSkillScan(
      db,
      'project',
      [{ name: 'a', source_path: '/roots/project-a/a', plugin_name: null, description: null }],
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
      [{ name: 'a', source_path: '/roots/global/a', plugin_name: null, description: null }],
      ['/roots/global']
    )
    writeSkillScan(db, 'global', [], ['/roots/global'])

    expect(allSkills()).toHaveLength(0)
  })
})

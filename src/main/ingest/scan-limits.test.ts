import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, readAllowedDirectory, resetGrantedPaths } from '../permissions'
import { applySchema } from '../db/schema'
import { findNestedSkillsDirs } from './skills-scanner'
import { parseTranscript } from './transcript-scanner'
import { scanPromptHistory } from './prompt-history-scanner'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'megatron-scan-limit-'))
  grantPath(root)
})
afterEach(() => {
  resetGrantedPaths()
  rmSync(root, { recursive: true, force: true })
})

describe('scan work budgets', () => {
  it('reports an incomplete directory rather than allocating every entry', () => {
    for (const name of ['a', 'b', 'c', 'd']) writeFileSync(join(root, name), '')
    const read = readAllowedDirectory as (
      path: string,
      maximumEntries: number
    ) => ReturnType<typeof readAllowedDirectory>
    expect(read(root, 2).status).toBe('unavailable')
    expect(read(root, 2).entries.length).toBeLessThanOrEqual(2)
  })

  it('reports incomplete discovery when a directory budget is exhausted', () => {
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true })
    let incomplete = false
    const discover = findNestedSkillsDirs as (
      path: string,
      onUnavailable: () => void,
      limits: { maxDepth: number; maxDirectories: number }
    ) => string[]
    discover(
      root,
      () => {
        incomplete = true
      },
      { maxDepth: 1, maxDirectories: 2 }
    )
    expect(incomplete).toBe(true)
  })

  it('rejects a transcript snapshot when retained records exceed the budget', () => {
    const file = join(root, 'session.jsonl')
    writeFileSync(
      file,
      [
        {
          type: 'user',
          cwd: '/fixture',
          sessionId: 'fixture',
          uuid: 'a',
          timestamp: '2026-10-10T00:00:00.000Z',
          message: { content: 'one' }
        },
        {
          type: 'user',
          cwd: '/fixture',
          sessionId: 'fixture',
          uuid: 'b',
          timestamp: '2026-10-10T00:00:01.000Z',
          message: { content: 'two' }
        },
        {
          type: 'user',
          cwd: '/fixture',
          sessionId: 'fixture',
          uuid: 'c',
          timestamp: '2026-10-10T00:00:02.000Z',
          message: { content: 'three' }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')
    )
    const parse = parseTranscript as (
      file: string,
      limits: { maxRecords: number; maxRetainedBytes: number }
    ) => ReturnType<typeof parseTranscript>
    expect(parse(file, { maxRecords: 2, maxRetainedBytes: 1024 }).session).toBeNull()
  })

  it('preserves existing prompt rows when the incoming history exceeds the budget', () => {
    const database = new Database(':memory:')
    try {
      applySchema(database)
      database
        .prepare(
          "INSERT INTO prompt_history (session_id,project,typed_at,is_slash_command) VALUES ('previous','/previous','2026-10-09T00:00:00.000Z',0)"
        )
        .run()
      const file = join(root, 'history.jsonl')
      writeFileSync(
        file,
        [1, 2, 3]
          .map((index) =>
            JSON.stringify({
              sessionId: 'new',
              project: '/new',
              timestamp: 1791590400000 + index,
              display: 'fixture'
            })
          )
          .join('\n')
      )
      const scan = scanPromptHistory as (
        db: Database.Database,
        file: string,
        maximumRows: number
      ) => ReturnType<typeof scanPromptHistory>
      expect(scan(database, file, 2)).toEqual({ status: 'partial' })
      expect(database.prepare('SELECT session_id FROM prompt_history').all()).toEqual([
        { session_id: 'previous' }
      ])
    } finally {
      database.close()
    }
  })
})

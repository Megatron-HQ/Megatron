import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths } from '../permissions'
import {
  parsePromptHistory,
  scanPromptHistory,
  type PromptHistoryRow
} from './prompt-history-scanner'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-history-test-'))
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

function line(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    display: 'hello there',
    pastedContents: {},
    timestamp: 1_784_249_655_258,
    project: '/Users/sai/Desktop',
    sessionId: 'sess-1',
    ...overrides
  }
}

function jsonl(lines: unknown[]): string {
  return lines.map((entry) => JSON.stringify(entry)).join('\n')
}

describe('parsePromptHistory', () => {
  it('maps a real line to a row with the epoch timestamp converted to ISO 8601', () => {
    const rows = parsePromptHistory(jsonl([line()]))

    expect(rows).toEqual<PromptHistoryRow[]>([
      {
        session_id: 'sess-1',
        project: '/Users/sai/Desktop',
        typed_at: '2026-07-17T00:54:15.258Z',
        is_slash_command: 0
      }
    ])
  })

  it('flags a bare /clear as a slash command', () => {
    expect(parsePromptHistory(jsonl([line({ display: '/clear' })]))[0].is_slash_command).toBe(1)
  })

  it('flags a bare /quit as a slash command', () => {
    expect(parsePromptHistory(jsonl([line({ display: '/quit' })]))[0].is_slash_command).toBe(1)
  })

  it('does not flag a slash command that carries arguments', () => {
    expect(
      parsePromptHistory(jsonl([line({ display: '/model opusplan' })]))[0].is_slash_command
    ).toBe(0)
  })

  it('flags a bare skill run like /grill-me as a slash command (known conflation)', () => {
    expect(parsePromptHistory(jsonl([line({ display: '/grill-me' })]))[0].is_slash_command).toBe(1)
  })

  it('does not flag ordinary prose', () => {
    expect(parsePromptHistory(jsonl([line({ display: 'hello' })]))[0].is_slash_command).toBe(0)
  })

  it('does not flag a lone slash or a slash followed by a digit', () => {
    const rows = parsePromptHistory(jsonl([line({ display: '/' }), line({ display: '/1' })]))
    expect(rows.map((row) => row.is_slash_command)).toEqual([0, 0])
  })

  it('skips a malformed JSON line without dropping the valid lines around it', () => {
    const raw = [
      JSON.stringify(line()),
      'not json {{{',
      JSON.stringify(line({ display: '/clear' }))
    ]
    expect(parsePromptHistory(raw.join('\n'))).toHaveLength(2)
  })

  it('skips a line missing sessionId', () => {
    const bad = line()
    delete bad.sessionId
    expect(parsePromptHistory(jsonl([bad, line()]))).toHaveLength(1)
  })

  it('skips a line missing project', () => {
    const bad = line()
    delete bad.project
    expect(parsePromptHistory(jsonl([bad, line()]))).toHaveLength(1)
  })

  it('skips a line missing timestamp', () => {
    const bad = line()
    delete bad.timestamp
    expect(parsePromptHistory(jsonl([bad, line()]))).toHaveLength(1)
  })

  it('skips a line whose timestamp is not a number', () => {
    expect(parsePromptHistory(jsonl([line({ timestamp: '2026-01-01' }), line()]))).toHaveLength(1)
  })

  it('skips a line whose timestamp is not a finite date', () => {
    expect(parsePromptHistory(jsonl([line({ timestamp: Number.NaN }), line()]))).toHaveLength(1)
  })

  it('skips blank lines', () => {
    expect(parsePromptHistory(`\n${JSON.stringify(line())}\n\n`)).toHaveLength(1)
  })
})

describe('scanPromptHistory', () => {
  let db: Database.Database

  interface CountRow {
    n: number
  }

  function rowCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM prompt_history').get() as CountRow).n
  }

  beforeEach(() => {
    db = new Database(':memory:')
    applySchema(db)
  })

  it('loads every parsed row into prompt_history', () => {
    const historyFile = join(tmpDir, 'history.jsonl')
    writeFileSync(historyFile, jsonl([line(), line({ display: '/clear' })]))

    scanPromptHistory(db, historyFile)

    expect(rowCount()).toBe(2)
  })

  it('wipes and reloads, so a shrunk history file leaves no stale rows', () => {
    const historyFile = join(tmpDir, 'history.jsonl')
    writeFileSync(historyFile, jsonl([line(), line(), line()]))
    scanPromptHistory(db, historyFile)
    expect(rowCount()).toBe(3)

    writeFileSync(historyFile, jsonl([line()]))
    scanPromptHistory(db, historyFile)

    expect(rowCount()).toBe(1)
  })

  it('leaves the existing table untouched when the history file is missing', () => {
    db.prepare(
      `INSERT INTO prompt_history (session_id, project, typed_at, is_slash_command)
       VALUES ('seeded', '/repo', '2026-01-01T00:00:00.000Z', 0)`
    ).run()

    scanPromptHistory(db, join(tmpDir, 'does-not-exist.jsonl'))

    expect(rowCount()).toBe(1)
  })

  it('clears the table when the history file exists but is empty', () => {
    db.prepare(
      `INSERT INTO prompt_history (session_id, project, typed_at, is_slash_command)
       VALUES ('seeded', '/repo', '2026-01-01T00:00:00.000Z', 0)`
    ).run()
    const historyFile = join(tmpDir, 'history.jsonl')
    writeFileSync(historyFile, '')

    scanPromptHistory(db, historyFile)

    expect(rowCount()).toBe(0)
  })

  it('does nothing when the history file is outside the permission boundary', () => {
    const ungranted = mkdtempSync(join(tmpdir(), 'megatron-ungranted-'))
    try {
      mkdirSync(ungranted, { recursive: true })
      const historyFile = join(ungranted, 'history.jsonl')
      writeFileSync(historyFile, jsonl([line()]))

      scanPromptHistory(db, historyFile)

      expect(rowCount()).toBe(0)
    } finally {
      rmSync(ungranted, { recursive: true, force: true })
    }
  })
})

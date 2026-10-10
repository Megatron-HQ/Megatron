import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { getSkillById, getSkillInvocationLog, getSkillInvocationSlice } from './queries'
import { IPC_CHANNELS, type SkillInvocationSliceInput } from '../../shared/ipc'
import { validateIpcArguments } from '../ipc-security'

let database: Database.Database
beforeEach(() => {
  database = new Database(':memory:')
  applySchema(database)
  database
    .prepare(
      "INSERT INTO skills (id,name,source_type,source_path,last_scanned_at) VALUES (1,'fixture','global','/fixture','2026-10-10T00:00:00.000Z')"
    )
    .run()
  database
    .prepare(
      "INSERT INTO sessions_meta (session_id,cwd,started_at,message_count,source_mtime_ms) VALUES ('fixture','/fixture','2026-10-10T00:00:00.000Z',205,0)"
    )
    .run()
  const insert = database.prepare(
    "INSERT INTO skill_invocations (source_uuid,session_id,skill_name,invoked_at,trigger_type,preceding_user_text) VALUES (?,'fixture','fixture','2026-10-10T00:00:00.000Z','user_invoked',?)"
  )
  database.transaction(() => {
    for (let index = 0; index < 205; index++) insert.run(`uuid-${index}`, `prompt-${index}`)
  })()
})
afterEach(() => database.close())

describe('history paging', () => {
  it('bounds the lifetime log and exposes subsequent rows in stable order', () => {
    const skill = getSkillById(database, 1)!
    const page = getSkillInvocationLog(database, skill)
    const next = getSkillInvocationLog(database, skill, 200, 200)
    expect(page).toHaveLength(200)
    expect(next.map((row) => row.preceding_user_text)).toEqual([
      'prompt-4',
      'prompt-3',
      'prompt-2',
      'prompt-1',
      'prompt-0'
    ])
    expect(page[0].preceding_user_text).toBe('prompt-204')
  })

  it('bounds time slices and exposes the next page without overlap', () => {
    const input: SkillInvocationSliceInput & { offset?: number } = {
      startAt: '2026-10-10T00:00:00.000Z',
      endAt: '2026-10-11T00:00:00.000Z'
    }
    expect(getSkillInvocationSlice(database, input)).toHaveLength(200)
    expect(
      getSkillInvocationSlice(database, { ...input, offset: 200 } as typeof input)
    ).toHaveLength(5)
  })

  it('rejects negative, fractional and excessive offsets at IPC', () => {
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => validateIpcArguments(IPC_CHANNELS.openSkillHistory, [1, offset])).toThrow()
      expect(() =>
        validateIpcArguments(IPC_CHANNELS.usageSkillInvocations, [
          { startAt: '2026-10-10T00:00:00.000Z', endAt: '2026-10-11T00:00:00.000Z', offset }
        ])
      ).toThrow()
    }
    expect(() => validateIpcArguments(IPC_CHANNELS.openSkillHistory, [1, 200])).not.toThrow()
  })
})

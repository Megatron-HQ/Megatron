import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { rebuildSessionSkillCosts } from './skill-cost-allocation'

let db: Database.Database

function addSession(sessionId: string): void {
  db.prepare(
    `INSERT INTO sessions_meta
       (session_id, cwd, started_at, message_count, source_mtime_ms)
     VALUES (?, '/repo', '2026-01-01T00:00:00.000Z', 1, 0)`
  ).run(sessionId)
}

function addCost(
  sessionId: string,
  totalCostUsd: number,
  continuedInSessionId: string | null = null
): void {
  db.prepare('UPDATE sessions_meta SET continued_in_session_id = ? WHERE session_id = ?').run(
    continuedInSessionId,
    sessionId
  )
  db.prepare(
    `INSERT INTO session_cost (session_id, total_cost_usd)
     VALUES (?, ?)`
  ).run(sessionId, totalCostUsd)
}

function addModelCost(sessionId: string, model: string, costUsd: number): void {
  db.prepare(
    `INSERT INTO session_model_cost
       (session_id, model, cost_usd, input_tokens, output_tokens, thinking_tokens,
        cache_read_tokens, cache_creation_tokens, web_search_requests)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)`
  ).run(sessionId, model, costUsd)
}

function addTurn(
  sessionId: string,
  sourceUuid: string,
  model: string,
  outputTokens: number,
  activeSkill: string | null
): void {
  db.prepare(
    `INSERT INTO turn_usage
       (logical_turn_key, source_uuid, session_id, turn_index, model, input_tokens,
        cache_read_tokens, cache_creation_tokens, cache_creation_5m_tokens,
        cache_creation_1h_tokens, output_tokens, active_skill, invoked_at)
     VALUES (?, ?, ?, 0, ?, 0, 0, 0, 0, 0, ?, ?, '2026-01-01T00:00:01.000Z')`
  ).run(`message:${sourceUuid}`, sourceUuid, sessionId, model, outputTokens, activeSkill)
}

function allocations(): Array<{
  session_id: string
  skill_name: string | null
  est_cost_usd: number
}> {
  return db
    .prepare(
      `SELECT session_id, skill_name, est_cost_usd
       FROM session_skill_cost ORDER BY session_id, skill_name`
    )
    .all() as Array<{ session_id: string; skill_name: string | null; est_cost_usd: number }>
}

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
})

describe('rebuildSessionSkillCosts', () => {
  it('weights each priced model by output tokens and assigns residual cost to General work', () => {
    addSession('terminal')
    addCost('terminal', 10)
    addModelCost('terminal', 'claude-opus-5', 8)
    addTurn('terminal', 'turn-a', 'claude-opus-5', 3, 'review')
    addTurn('terminal', 'turn-b', 'claude-opus-5', 1, null)

    rebuildSessionSkillCosts(db)

    expect(allocations()).toEqual([
      { session_id: 'terminal', skill_name: null, est_cost_usd: 4 },
      { session_id: 'terminal', skill_name: 'review', est_cost_usd: 6 }
    ])
  })

  it('attributes predecessor turns to the priced terminal in a continuation lineage', () => {
    addSession('before')
    addSession('terminal')
    addCost('before', 0, 'terminal')
    addCost('terminal', 5)
    addModelCost('terminal', 'claude-sonnet-5', 5)
    addTurn('before', 'turn-before', 'claude-sonnet-5', 10, 'domain-modeling')

    rebuildSessionSkillCosts(db)

    expect(allocations()).toEqual([
      { session_id: 'terminal', skill_name: 'domain-modeling', est_cost_usd: 5 }
    ])
  })

  it('follows continuation metadata through an intermediate session with no cost-state', () => {
    addSession('before')
    addSession('middle')
    addSession('terminal')
    addCost('before', 0, 'middle')
    db.prepare(
      "UPDATE sessions_meta SET continued_in_session_id = 'terminal' WHERE session_id = 'middle'"
    ).run()
    addCost('terminal', 5)
    addModelCost('terminal', 'claude-sonnet-5', 5)
    addTurn('before', 'turn-before', 'claude-sonnet-5', 10, 'domain-modeling')

    rebuildSessionSkillCosts(db)

    expect(allocations()).toEqual([
      { session_id: 'terminal', skill_name: 'domain-modeling', est_cost_usd: 5 }
    ])
  })

  it('assigns a priced model with no output-token evidence to General work', () => {
    addSession('terminal')
    addCost('terminal', 3)
    addModelCost('terminal', 'claude-haiku-5', 3)
    addTurn('terminal', 'turn-zero', 'claude-haiku-5', 0, 'review')

    rebuildSessionSkillCosts(db)

    expect(allocations()).toEqual([{ session_id: 'terminal', skill_name: null, est_cost_usd: 3 }])
  })

  it('rebuilds idempotently and conserves every terminal total', () => {
    addSession('terminal')
    addCost('terminal', 1)
    addModelCost('terminal', 'claude-opus-5', 0.7)
    addModelCost('terminal', 'claude-sonnet-5', 0.4)
    addTurn('terminal', 'turn-a', 'claude-opus-5', 2, 'review')
    addTurn('terminal', 'turn-b', 'claude-sonnet-5', 1, null)

    rebuildSessionSkillCosts(db)
    rebuildSessionSkillCosts(db)

    const rows = allocations()
    expect(rows).toHaveLength(2)
    expect(rows.reduce((total, row) => total + row.est_cost_usd, 0)).toBeCloseTo(1, 12)
  })
})

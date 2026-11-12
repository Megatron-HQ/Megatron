import type Database from 'better-sqlite3'
import type { ModelCost, TurnUsageRow } from './cost-parser'

// Claude desktop resumes, rewinds and forks, and the CLI's --fork-session and /branch, each write a
// new transcript whose cost-state counter starts from its source's final total, with no
// continued-in link. Summing every file overcounts; this module finds those lineages and the exact
// spend of each (docs/usage-analytics.md, hazard 3).

export type LineageTurn = Pick<
  TurnUsageRow,
  'model' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_creation_tokens'
>

export interface LineageSession {
  session_id: string
  started_at: string
  continued_in_session_id: string | null
  cost: {
    total_cost_usd: number
    is_zeroed: boolean
    has_unknown_model_cost: boolean
    cost_state_start_time: string | null
    models: ModelCost[]
  } | null
  // Every turn the session's files hold, replayed copies included.
  turn_keys: string[]
}

export interface LineageMembership {
  session_id: string
  head_session_id: string
  parent_session_id: string | null
}

export interface LineageCost {
  head_session_id: string
  total_cost_usd: number
  has_unknown_model_cost: boolean
  is_estimate: boolean
  models: ModelCost[]
}

type Member = LineageSession & { cost: NonNullable<LineageSession['cost']> }

// Only these four fields appear in both cost-state and per-turn usage on every Claude Code
// version, so they are the ones the parent check can compare.
const CHECKED_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens'
] as const
const MODEL_FIELDS = [
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'thinking_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'web_search_requests'
] as const

function isForkMember(session: LineageSession): session is Member {
  return (
    session.cost !== null &&
    !session.cost.is_zeroed &&
    !session.cost.has_unknown_model_cost &&
    session.cost.cost_state_start_time !== null
  )
}

// Counters only grow, so a parent always sorts strictly before its child. Requiring that order
// makes the parent graph acyclic even for forks whose counters are identical.
function precedes(a: Member, b: Member): boolean {
  return (
    a.cost.total_cost_usd < b.cost.total_cost_usd ||
    (a.cost.total_cost_usd === b.cost.total_cost_usd && a.session_id < b.session_id)
  )
}

// How far m's counter exceeds s's beyond the turns m holds that s doesn't, summed over every
// model and checked field; null when any field falls short, so s can't be the counter m started
// from. Background requests bill the counter without a transcript line, so a positive gap is
// normal. An integer check needs no price table, keeping cost-state the only source of dollars.
function residual(m: Member, s: Member, turns: Map<string, LineageTurn>): number | null {
  const gaps = new Map<string, number[]>()
  const add = (
    model: string,
    values: Pick<LineageTurn, (typeof CHECKED_FIELDS)[number]>,
    sign: 1 | -1
  ): void => {
    const gap = gaps.get(model) ?? CHECKED_FIELDS.map(() => 0)
    CHECKED_FIELDS.forEach((field, index) => (gap[index] += sign * values[field]))
    gaps.set(model, gap)
  }
  for (const row of m.cost.models) add(row.model, row, 1)
  for (const row of s.cost.models) add(row.model, row, -1)
  const sTurns = new Set(s.turn_keys)
  for (const key of m.turn_keys) {
    const turn = turns.get(key)
    if (turn !== undefined && !sTurns.has(key)) add(turn.model, turn, -1)
  }
  let total = 0
  for (const gap of gaps.values()) {
    for (const value of gap) {
      if (value < 0) return null
      total += value
    }
  }
  return total
}

function findParent(m: Member, group: Member[], turns: Map<string, LineageTurn>): Member | null {
  const explicit = group.filter((s) => s.continued_in_session_id === m.session_id && precedes(s, m))
  if (explicit.length > 0) return explicit.reduce((a, b) => (precedes(a, b) ? b : a))
  let best: { session: Member; residual: number } | null = null
  for (const s of group) {
    if (!precedes(s, m)) continue
    const gap = residual(m, s, turns)
    if (gap === null) continue
    if (
      best === null ||
      gap < best.residual ||
      (gap === best.residual &&
        (s.cost.total_cost_usd > best.session.cost.total_cost_usd ||
          (s.cost.total_cost_usd === best.session.cost.total_cost_usd &&
            s.session_id < best.session.session_id)))
    ) {
      best = { session: s, residual: gap }
    }
  }
  return best?.session ?? null
}

function addModels(target: Map<string, ModelCost>, rows: ModelCost[], sign: 1 | -1): void {
  for (const row of rows) {
    const sum =
      target.get(row.model) ??
      ({ model: row.model, ...Object.fromEntries(MODEL_FIELDS.map((f) => [f, 0])) } as ModelCost)
    for (const field of MODEL_FIELDS) sum[field] += sign * row[field]
    target.set(row.model, sum)
  }
}

function groupForkMembers(members: Member[]): Member[][] {
  const root = new Map(members.map((m) => [m.session_id, m.session_id]))
  const find = (id: string): string => {
    while (root.get(id) !== id) id = root.get(id)!
    return id
  }
  const union = (a: string, b: string): void => {
    root.set(find(a), find(b))
  }
  const byKey = new Map<string, string>()
  for (const m of members) {
    // /clear resets startTime, and the first record's timestamp guards against two unrelated
    // sessions starting in the same millisecond.
    const key = `${m.cost.cost_state_start_time}\u0000${m.started_at}`
    const first = byKey.get(key)
    if (first === undefined) byKey.set(key, m.session_id)
    else union(m.session_id, first)
    const next = m.continued_in_session_id
    if (next !== null && root.has(next)) union(m.session_id, next)
  }
  const groups = new Map<string, Member[]>()
  for (const m of members)
    groups.set(find(m.session_id), [...(groups.get(find(m.session_id)) ?? []), m])
  return [...groups.values()]
}

export function resolveCostLineages(
  sessions: LineageSession[],
  turns: Map<string, LineageTurn>
): { sessions: LineageMembership[]; lineages: LineageCost[] } {
  const byId = new Map(sessions.map((s) => [s.session_id, s]))
  const groupHead = new Map<string, string>()
  const parentOf = new Map<string, string | null>()
  const groupCost = new Map<string, LineageCost>()

  for (const group of groupForkMembers(sessions.filter(isForkMember))) {
    const head = group.reduce((a, b) => (precedes(a, b) ? b : a))
    const parents = new Map(group.map((m) => [m.session_id, findParent(m, group, turns)]))
    const models = new Map<string, ModelCost>()
    let total = 0
    const isEstimate = [...parents.values()].filter((p) => p === null).length > 1
    if (isEstimate) {
      // A shared ancestor was pruned, so its counter can't be subtracted twice; the head's own
      // counter still contains it and is the closest figure left.
      addModels(models, head.cost.models, 1)
      total = head.cost.total_cost_usd
    }
    for (const m of group) {
      const parent = parents.get(m.session_id) ?? null
      groupHead.set(m.session_id, head.session_id)
      parentOf.set(m.session_id, parent?.session_id ?? null)
      if (isEstimate) continue
      addModels(models, m.cost.models, 1)
      total += m.cost.total_cost_usd
      if (parent !== null) {
        addModels(models, parent.cost.models, -1)
        total -= parent.cost.total_cost_usd
      }
    }
    groupCost.set(head.session_id, {
      head_session_id: head.session_id,
      total_cost_usd: total,
      has_unknown_model_cost: false,
      is_estimate: isEstimate,
      models: [...models.values()]
    })
  }

  // A fork lineage ends at its head unless that head was continued outside the lineage; every
  // other session keeps the continued-in walk to its priced terminal.
  const terminalOf = (sessionId: string): string | null => {
    const visited = new Set<string>()
    let current: string | null = sessionId
    while (current !== null && !visited.has(current)) {
      visited.add(current)
      const session = byId.get(current)
      if (session === undefined) return null
      const head = groupHead.get(current)
      if (head !== undefined) {
        const next = byId.get(head)!.continued_in_session_id
        if (next === null || groupHead.get(next) === head) return head
        visited.add(head)
        current = next
        continue
      }
      if (session.continued_in_session_id === null) {
        return session.cost !== null && !session.cost.is_zeroed ? current : null
      }
      current = session.continued_in_session_id
    }
    return null
  }

  const memberships: LineageMembership[] = []
  const lineages = new Map<string, LineageCost>()
  for (const session of sessions) {
    const head = terminalOf(session.session_id)
    if (head === null) continue
    memberships.push({
      session_id: session.session_id,
      head_session_id: head,
      parent_session_id: parentOf.get(session.session_id) ?? null
    })
    if (lineages.has(head)) continue
    const terminal = byId.get(head)!
    lineages.set(
      head,
      groupCost.get(head) ?? {
        head_session_id: head,
        total_cost_usd: terminal.cost!.total_cost_usd,
        has_unknown_model_cost: terminal.cost!.has_unknown_model_cost,
        is_estimate: false,
        models: terminal.cost!.models
      }
    )
  }
  return { sessions: memberships, lineages: [...lineages.values()] }
}

const MODEL_COLUMNS = MODEL_FIELDS.join(', ')

export function rebuildCostLineages(db: Database.Database): void {
  const modelsBySession = new Map<string, ModelCost[]>()
  for (const row of db
    .prepare(`SELECT session_id, model, ${MODEL_COLUMNS} FROM session_model_cost`)
    .all() as Array<ModelCost & { session_id: string }>) {
    const { session_id, ...model } = row
    modelsBySession.set(session_id, [...(modelsBySession.get(session_id) ?? []), model])
  }

  // Turn membership only matters for sessions that can join a fork lineage.
  const turnKeysBySession = new Map<string, string[]>()
  const turns = new Map<string, LineageTurn>()
  for (const row of db
    .prepare(
      `SELECT st.session_id, st.logical_turn_key, tu.model, tu.input_tokens, tu.output_tokens,
              tu.cache_read_tokens, tu.cache_creation_tokens
       FROM session_turn st
       JOIN session_cost sc ON sc.session_id = st.session_id
       LEFT JOIN turn_usage tu ON tu.logical_turn_key = st.logical_turn_key
       WHERE sc.is_zeroed = 0 AND sc.has_unknown_model_cost = 0
         AND sc.cost_state_start_time IS NOT NULL`
    )
    .all() as Array<{ session_id: string; logical_turn_key: string } & Partial<LineageTurn>>) {
    const keys = turnKeysBySession.get(row.session_id) ?? []
    keys.push(row.logical_turn_key)
    turnKeysBySession.set(row.session_id, keys)
    if (row.model != null) turns.set(row.logical_turn_key, row as LineageTurn)
  }

  const sessions = (
    db
      .prepare(
        `SELECT sm.session_id, sm.started_at, sm.continued_in_session_id,
                sc.session_id AS cost_session_id, sc.total_cost_usd, sc.is_zeroed,
                sc.has_unknown_model_cost, sc.cost_state_start_time
         FROM sessions_meta sm LEFT JOIN session_cost sc ON sc.session_id = sm.session_id`
      )
      .all() as Array<{
      session_id: string
      started_at: string
      continued_in_session_id: string | null
      cost_session_id: string | null
      total_cost_usd: number
      is_zeroed: number
      has_unknown_model_cost: number
      cost_state_start_time: string | null
    }>
  ).map((row): LineageSession => ({
    session_id: row.session_id,
    started_at: row.started_at,
    continued_in_session_id: row.continued_in_session_id,
    cost:
      row.cost_session_id === null
        ? null
        : {
            total_cost_usd: row.total_cost_usd,
            is_zeroed: row.is_zeroed === 1,
            has_unknown_model_cost: row.has_unknown_model_cost === 1,
            cost_state_start_time: row.cost_state_start_time,
            models: modelsBySession.get(row.session_id) ?? []
          },
    turn_keys: turnKeysBySession.get(row.session_id) ?? []
  }))

  const resolved = resolveCostLineages(sessions, turns)
  const insertMembership = db.prepare(
    'INSERT INTO cost_lineage VALUES (@session_id, @head_session_id, @parent_session_id)'
  )
  const insertLineage = db.prepare('INSERT INTO lineage_cost VALUES (?, ?, ?, ?)')
  const insertModel = db.prepare(
    `INSERT INTO lineage_model_cost (head_session_id, model, ${MODEL_COLUMNS})
     VALUES (@head_session_id, @model, ${MODEL_FIELDS.map((field) => `@${field}`).join(', ')})`
  )
  db.transaction(() => {
    db.prepare('DELETE FROM cost_lineage').run()
    db.prepare('DELETE FROM lineage_cost').run()
    for (const row of resolved.sessions) insertMembership.run(row)
    for (const lineage of resolved.lineages) {
      insertLineage.run(
        lineage.head_session_id,
        lineage.total_cost_usd,
        lineage.has_unknown_model_cost ? 1 : 0,
        lineage.is_estimate ? 1 : 0
      )
      for (const model of lineage.models) {
        insertModel.run({ head_session_id: lineage.head_session_id, ...model })
      }
    }
  })()
}

import type Database from 'better-sqlite3'

interface SessionCostRow {
  session_id: string
  total_cost_usd: number
  is_zeroed: number
  continued_in_session_id: string | null
}

interface SessionLineageRow {
  session_id: string
  continued_in_session_id: string | null
}

interface ModelCostRow {
  session_id: string
  model: string
  cost_usd: number
}

interface TurnWeightRow {
  session_id: string
  model: string
  output_tokens: number
  active_skill: string | null
}

function addAmount(
  allocations: Map<string | null, number>,
  skillName: string | null,
  amount: number
): void {
  allocations.set(skillName, (allocations.get(skillName) ?? 0) + amount)
}

function resolveTerminalSession(
  sessionId: string,
  nextSessionById: Map<string, string | null>,
  terminalIds: Set<string>
): string | null {
  const visited = new Set<string>()
  let current = sessionId
  while (!visited.has(current)) {
    if (terminalIds.has(current)) return current
    visited.add(current)
    const next = nextSessionById.get(current)
    if (next === undefined || next === null) return null
    current = next
  }
  return null
}

export function rebuildSessionSkillCosts(db: Database.Database): void {
  const sessionCosts = db
    .prepare(
      `SELECT sc.session_id, sc.total_cost_usd, sc.is_zeroed, sm.continued_in_session_id
       FROM session_cost sc
       JOIN sessions_meta sm ON sm.session_id = sc.session_id`
    )
    .all() as SessionCostRow[]
  const terminalCosts = sessionCosts.filter(
    (row) => row.is_zeroed === 0 && row.continued_in_session_id === null
  )
  const terminalIds = new Set(terminalCosts.map((row) => row.session_id))
  const lineageRows = db
    .prepare('SELECT session_id, continued_in_session_id FROM sessions_meta')
    .all() as SessionLineageRow[]
  const nextSessionById = new Map(
    lineageRows.map((row) => [row.session_id, row.continued_in_session_id] as const)
  )

  const turnsByTerminalAndModel = new Map<string, Map<string, TurnWeightRow[]>>()
  const turns = db
    .prepare('SELECT session_id, model, output_tokens, active_skill FROM turn_usage')
    .all() as TurnWeightRow[]
  for (const turn of turns) {
    const terminalId = resolveTerminalSession(turn.session_id, nextSessionById, terminalIds)
    if (terminalId === null) continue
    const turnsByModel = turnsByTerminalAndModel.get(terminalId) ?? new Map()
    const modelTurns = turnsByModel.get(turn.model) ?? []
    modelTurns.push(turn)
    turnsByModel.set(turn.model, modelTurns)
    turnsByTerminalAndModel.set(terminalId, turnsByModel)
  }

  const modelCostsByTerminal = new Map<string, ModelCostRow[]>()
  const modelCosts = db
    .prepare('SELECT session_id, model, cost_usd FROM session_model_cost')
    .all() as ModelCostRow[]
  for (const modelCost of modelCosts) {
    const rows = modelCostsByTerminal.get(modelCost.session_id) ?? []
    rows.push(modelCost)
    modelCostsByTerminal.set(modelCost.session_id, rows)
  }

  const insert = db.prepare(
    `INSERT INTO session_skill_cost (session_id, skill_name, est_cost_usd) VALUES (?, ?, ?)`
  )
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM session_skill_cost').run()

    for (const terminal of terminalCosts) {
      const allocations = new Map<string | null, number>()
      let pricedModelTotal = 0
      const turnsByModel = turnsByTerminalAndModel.get(terminal.session_id) ?? new Map()

      for (const modelCost of modelCostsByTerminal.get(terminal.session_id) ?? []) {
        if (modelCost.cost_usd <= 0) continue
        pricedModelTotal += modelCost.cost_usd
        const modelTurns = turnsByModel.get(modelCost.model) ?? []
        const outputTokenTotal = modelTurns.reduce(
          (total, turn) => total + Math.max(0, turn.output_tokens),
          0
        )
        if (outputTokenTotal === 0) {
          addAmount(allocations, null, modelCost.cost_usd)
          continue
        }
        for (const turn of modelTurns) {
          const weight = Math.max(0, turn.output_tokens) / outputTokenTotal
          addAmount(allocations, turn.active_skill, modelCost.cost_usd * weight)
        }
      }

      if (pricedModelTotal < terminal.total_cost_usd) {
        addAmount(allocations, null, terminal.total_cost_usd - pricedModelTotal)
      } else if (pricedModelTotal > terminal.total_cost_usd && pricedModelTotal > 0) {
        const scale = terminal.total_cost_usd / pricedModelTotal
        for (const [skillName, amount] of allocations) allocations.set(skillName, amount * scale)
      }

      if (allocations.size === 0 && terminal.total_cost_usd > 0) {
        allocations.set(null, terminal.total_cost_usd)
      }
      for (const [skillName, amount] of allocations) {
        if (amount > 0) insert.run(terminal.session_id, skillName, amount)
      }
    }
  })

  rebuild()
}

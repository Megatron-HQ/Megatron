import type Database from 'better-sqlite3'

const COST_ROUNDING_EPSILON = 0.000000001

interface LineageCostRow {
  session_id: string
  total_cost_usd: number
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
  invoked_at: string
}

interface TimedAllocation {
  skillName: string | null
  model: string | null
  allocatedAt: string
  amount: number
}

function spreadGeneralCost(
  allocations: TimedAllocation[],
  turns: TurnWeightRow[],
  amount: number,
  model: string | null = null
): void {
  if (turns.length === 0 || amount <= 0) return
  const tokenTotal = turns.reduce((sum, turn) => sum + Math.max(0, turn.output_tokens), 0)
  for (const turn of turns) {
    const weight = tokenTotal > 0 ? Math.max(0, turn.output_tokens) / tokenTotal : 1 / turns.length
    if (weight > 0) {
      allocations.push({
        skillName: null,
        model,
        allocatedAt: turn.invoked_at,
        amount: amount * weight
      })
    }
  }
}

function addAmount(
  allocations: Map<string | null, number>,
  skillName: string | null,
  amount: number
): void {
  allocations.set(skillName, (allocations.get(skillName) ?? 0) + amount)
}

// Reads the lineage tables, so rebuildCostLineages must run first. Every turn of a lineage, from
// any member, is weighted under its head against the lineage's exact spend.
export function rebuildSessionSkillCosts(db: Database.Database): void {
  const terminalCosts = db
    .prepare('SELECT head_session_id AS session_id, total_cost_usd FROM lineage_cost')
    .all() as LineageCostRow[]
  const headBySession = new Map(
    (
      db.prepare('SELECT session_id, head_session_id FROM cost_lineage').all() as Array<{
        session_id: string
        head_session_id: string
      }>
    ).map((row) => [row.session_id, row.head_session_id] as const)
  )

  const turnsByTerminalAndModel = new Map<string, Map<string, TurnWeightRow[]>>()
  const turns = db
    .prepare('SELECT session_id, model, output_tokens, active_skill, invoked_at FROM turn_usage')
    .all() as TurnWeightRow[]
  for (const turn of turns) {
    const terminalId = headBySession.get(turn.session_id)
    if (terminalId === undefined) continue
    const turnsByModel = turnsByTerminalAndModel.get(terminalId) ?? new Map()
    const modelTurns = turnsByModel.get(turn.model) ?? []
    modelTurns.push(turn)
    turnsByModel.set(turn.model, modelTurns)
    turnsByTerminalAndModel.set(terminalId, turnsByModel)
  }

  const modelCostsByTerminal = new Map<string, ModelCostRow[]>()
  const modelCosts = db
    .prepare('SELECT head_session_id AS session_id, model, cost_usd FROM lineage_model_cost')
    .all() as ModelCostRow[]
  for (const modelCost of modelCosts) {
    const rows = modelCostsByTerminal.get(modelCost.session_id) ?? []
    rows.push(modelCost)
    modelCostsByTerminal.set(modelCost.session_id, rows)
  }

  const insert = db.prepare(
    `INSERT INTO session_skill_cost (session_id, skill_name, est_cost_usd) VALUES (?, ?, ?)`
  )
  const insertTimed = db.prepare(
    `INSERT INTO timed_skill_cost (session_id, skill_name, model, allocated_at, est_cost_usd)
     VALUES (?, ?, ?, ?, ?)`
  )
  const rebuild = db.transaction(() => {
    db.prepare('DELETE FROM session_skill_cost').run()
    db.prepare('DELETE FROM timed_skill_cost').run()

    for (const terminal of terminalCosts) {
      const allocations = new Map<string | null, number>()
      const timedAllocations: TimedAllocation[] = []
      let pricedModelTotal = 0
      const turnsByModel = turnsByTerminalAndModel.get(terminal.session_id) ?? new Map()
      const allTurns = [...turnsByModel.values()].flat()

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
          spreadGeneralCost(timedAllocations, allTurns, modelCost.cost_usd, modelCost.model)
          continue
        }
        for (const turn of modelTurns) {
          const weight = Math.max(0, turn.output_tokens) / outputTokenTotal
          const amount = modelCost.cost_usd * weight
          addAmount(allocations, turn.active_skill, amount)
          if (amount > 0) {
            timedAllocations.push({
              skillName: turn.active_skill,
              model: modelCost.model,
              allocatedAt: turn.invoked_at,
              amount
            })
          }
        }
      }

      if (
        pricedModelTotal === 0 ||
        terminal.total_cost_usd - pricedModelTotal > COST_ROUNDING_EPSILON
      ) {
        const residual = terminal.total_cost_usd - pricedModelTotal
        addAmount(allocations, null, residual)
        spreadGeneralCost(timedAllocations, allTurns, residual)
      } else if (pricedModelTotal !== terminal.total_cost_usd && pricedModelTotal > 0) {
        const scale = terminal.total_cost_usd / pricedModelTotal
        for (const [skillName, amount] of allocations) allocations.set(skillName, amount * scale)
        for (const allocation of timedAllocations) allocation.amount *= scale
      }

      if (allocations.size === 0 && terminal.total_cost_usd > 0) {
        allocations.set(null, terminal.total_cost_usd)
      }
      for (const [skillName, amount] of allocations) {
        if (amount > 0) insert.run(terminal.session_id, skillName, amount)
      }
      for (const allocation of timedAllocations) {
        insertTimed.run(
          terminal.session_id,
          allocation.skillName,
          allocation.model,
          allocation.allocatedAt,
          allocation.amount
        )
      }
    }
  })

  rebuild()
}

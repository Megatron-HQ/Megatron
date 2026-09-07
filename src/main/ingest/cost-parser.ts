// Pure, dependency-free extraction of Claude Code's `cost-state` line and per-turn usage shape
// from an already-parsed transcript record array. No `fs`, no `permissions` — callers supply the
// records, exactly like `extractInvocations` in transcript-scanner.ts. This is what lets the
// production scan and `scripts/explore-usage.mjs` share one implementation.

// `cost-state.modelUsage` keys are inconsistently formatted — `claude-haiku-4-5-20251001` (date
// suffix) vs `claude-sonnet-5` (none). Normalize before any join or bucket. `<synthetic>` is the
// model on local/error messages and has no cost — callers skip those rows entirely.
export function normalizeModelKey(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '<synthetic>') return null
  return trimmed.replace(/-\d{8}$/, '')
}

// Per-model numbers are kept under their verbatim `cost-state` field names (`costUSD`,
// `inputTokens`, `cacheReadInputTokens`, …) — no renaming, so a schema drift stays visible.
export type ModelUsage = Record<string, Record<string, number>>

export interface SessionCost {
  totalCostUsd: number
  modelUsage: ModelUsage
  hasUnknownModelCost: boolean
  // `cost-state` present but `totalCostUSD` 0 and `modelUsage` empty — the immature-feature
  // artifact (CC v2.1.241–246), not a genuine $0 session. Callers bucket it as "not tracked".
  isZeroed: boolean
  // From the `continued-in` marker in THIS session's own transcript: the session this one was
  // continued INTO. NULL means this session is a lineage terminal.
  continuedInSessionId: string | null
  costStateStartTime: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Reads the last `type:"cost-state"` line (cumulative — 9 of 53 real sessions have several,
// from resume checkpoints) plus any `continued-in` lineage marker. Returns null when the
// transcript has no `cost-state` line at all (pre-v2.1.241 history — ~77% of sessions).
export function extractCostState(records: Record<string, unknown>[]): SessionCost | null {
  let costStateRecord: Record<string, unknown> | null = null
  let continuedInSessionId: string | null = null

  for (const record of records) {
    if (record.type === 'cost-state') {
      costStateRecord = record
    } else if (
      record.type === 'continued-in' &&
      typeof record.continuedInSessionId === 'string' &&
      record.continuedInSessionId !== ''
    ) {
      continuedInSessionId = record.continuedInSessionId
    }
  }

  if (costStateRecord === null) return null

  const totalCostUsd =
    typeof costStateRecord.totalCostUSD === 'number' ? costStateRecord.totalCostUSD : 0

  const rawModelUsage = isRecord(costStateRecord.modelUsage) ? costStateRecord.modelUsage : {}
  const modelUsage: ModelUsage = {}
  for (const [rawKey, rawValue] of Object.entries(rawModelUsage)) {
    const key = normalizeModelKey(rawKey)
    if (key === null || !isRecord(rawValue)) continue
    const bucket = (modelUsage[key] ??= {})
    for (const [field, value] of Object.entries(rawValue)) {
      if (typeof value === 'number') bucket[field] = (bucket[field] ?? 0) + value
    }
  }

  return {
    totalCostUsd,
    modelUsage,
    hasUnknownModelCost: costStateRecord.hasUnknownModelCost === true,
    isZeroed: totalCostUsd === 0 && Object.keys(modelUsage).length === 0,
    continuedInSessionId,
    costStateStartTime:
      typeof costStateRecord.startTime === 'number'
        ? new Date(costStateRecord.startTime).toISOString()
        : null
  }
}

// Snake_case fields to match the DB's `session_model_cost` columns.
export interface ModelCost {
  model: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  thinking_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  web_search_requests: number
}

// The one place cost-state's inner per-model field names (`costUSD`, `cacheReadInputTokens`, …)
// map to the DB's typed snake_case columns — the scanner just spreads the result. `modelUsage`
// is already normalized + `<synthetic>`-dropped + date-suffix-collapsed by `extractCostState`.
// A missing verbatim field → 0. Mirrors `extractTurnUsage` returning DB-shaped rows.
export function toModelCostRows(cost: SessionCost): ModelCost[] {
  return Object.entries(cost.modelUsage).map(([model, usage]) => ({
    model,
    cost_usd: usage.costUSD ?? 0,
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    thinking_tokens: usage.thinkingTokens ?? 0,
    cache_read_tokens: usage.cacheReadInputTokens ?? 0,
    cache_creation_tokens: usage.cacheCreationInputTokens ?? 0,
    web_search_requests: usage.webSearchRequests ?? 0
  }))
}

// Snake_case fields to match the DB columns / `TranscriptInvocation`'s convention.
export interface TurnUsageRow {
  source_uuid: string
  session_id: string
  turn_index: number
  model: string
  effort: string | null
  cache_read_tokens: number
  cache_creation_tokens: number
  invoked_at: string
}

// One row per main-transcript assistant turn — for per-turn SHAPE only (§3 model/effort mix as a
// live COUNT GROUP BY, §4 turn-1 resident context via turn_index = 0). Never sum the token
// columns across turns: resume-replay inflates them ~2.3x. Mirrors extractInvocations —
// `isSidechain === false` on the main chain, deduped by the line's own `uuid`. `<synthetic>`
// turns (local/error messages, no cost) are dropped.
//
// `turn_index` is a 0-based ordinal by scan position, NOT `apiBlockIndex` — that field is
// absent on ~81% of real assistant turns (exploration report), so it can't anchor "the first
// turn." `records` is one session's transcript in file (chronological) order, so ordinal 0 is
// reliably that session's first real assistant turn. A skipped synthetic turn does not consume
// an ordinal.
export function extractTurnUsage(records: Record<string, unknown>[]): TurnUsageRow[] {
  const rows: TurnUsageRow[] = []
  const seen = new Set<string>()
  let turnIndex = 0

  for (const record of records) {
    if (record.type !== 'assistant' || record.isSidechain !== false) continue

    const sourceUuid = record.uuid
    const sessionId = record.sessionId
    const invokedAt = record.timestamp
    if (
      typeof sourceUuid !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof invokedAt !== 'string' ||
      seen.has(sourceUuid)
    ) {
      continue
    }

    const message = isRecord(record.message) ? record.message : null
    const model = normalizeModelKey(
      message !== null && typeof message.model === 'string' ? message.model : ''
    )
    if (model === null) continue

    seen.add(sourceUuid)
    const usage = message !== null && isRecord(message.usage) ? message.usage : {}

    rows.push({
      source_uuid: sourceUuid,
      session_id: sessionId,
      turn_index: turnIndex++,
      model,
      effort: typeof record.effort === 'string' ? record.effort : null,
      cache_read_tokens:
        typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0,
      cache_creation_tokens:
        typeof usage.cache_creation_input_tokens === 'number'
          ? usage.cache_creation_input_tokens
          : 0,
      invoked_at: invokedAt
    })
  }

  return rows
}

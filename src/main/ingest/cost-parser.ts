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
  costStateStartTime: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Reads the last `type:"cost-state"` line (cumulative — 9 of 53 real sessions have several,
// from resume checkpoints). Continuation lineage belongs to sessions_meta. Returns null when the
// transcript has no `cost-state` line at all (pre-v2.1.241 history — ~77% of sessions).
export function extractCostState(records: Record<string, unknown>[]): SessionCost | null {
  let costStateRecord: Record<string, unknown> | null = null

  for (const record of records) {
    if (record.type === 'cost-state') {
      costStateRecord = record
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
  logical_turn_key: string
  source_uuid: string
  session_id: string
  request_id: string | null
  message_id: string | null
  turn_index: number
  model: string
  effort: string | null
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cache_creation_5m_tokens: number
  cache_creation_1h_tokens: number
  output_tokens: number
  thinking_tokens: number
  web_search_requests: number
  agent_id: string | null
  active_skill: string | null
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
const VALID_EFFORTS = new Set(['xhigh', 'high', 'medium', 'low'])
const SKILL_BASE_DIRECTORY_MARKER = 'Base directory for this skill:'
const SKILL_COMMAND_PATTERN = /<command-name>\/([^<\s]+)<\/command-name>/

function numberField(record: Record<string, unknown>, key: string): number {
  return typeof record[key] === 'number' ? record[key] : 0
}

function userRecordStartsNewTurn(record: Record<string, unknown>): boolean {
  if (record.type !== 'user') return false
  const message = isRecord(record.message) ? record.message : null
  const content = message?.content
  if (typeof content === 'string') return !content.includes(SKILL_BASE_DIRECTORY_MARKER)
  if (!Array.isArray(content)) return false
  if (content.some((block) => isRecord(block) && block.type === 'tool_result')) return false
  const text = content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => String((block as Record<string, unknown>).text))
    .join('')
  return text !== '' && !text.includes(SKILL_BASE_DIRECTORY_MARKER)
}

function recordHasSkillBaseMarker(record: Record<string, unknown>): boolean {
  const message = isRecord(record.message) ? record.message : null
  const content = message?.content
  if (typeof content === 'string') return content.includes(SKILL_BASE_DIRECTORY_MARKER)
  if (!Array.isArray(content)) return false
  return content.some(
    (block) =>
      isRecord(block) &&
      typeof block.text === 'string' &&
      block.text.includes(SKILL_BASE_DIRECTORY_MARKER)
  )
}

function verifiedSlashSkill(
  record: Record<string, unknown>,
  parentsWithBaseMarker: Set<string>
): string | null {
  const uuid = typeof record.uuid === 'string' ? record.uuid : null
  if (uuid === null || !parentsWithBaseMarker.has(uuid)) return null
  const message = isRecord(record.message) ? record.message : null
  const content = message?.content
  if (typeof content !== 'string') return null
  return SKILL_COMMAND_PATTERN.exec(content)?.[1] ?? null
}

function lastSkillToolUse(message: Record<string, unknown>): string | null {
  if (!Array.isArray(message.content)) return null
  let skill: string | null = null
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_use' || block.name !== 'Skill') continue
    const input = isRecord(block.input) ? block.input : null
    if (typeof input?.skill === 'string' && input.skill.trim() !== '') skill = input.skill.trim()
  }
  return skill
}

export function extractTurnUsage(
  records: Record<string, unknown>[],
  agentId: string | null = null
): TurnUsageRow[] {
  const rows: TurnUsageRow[] = []
  const rowsByLogicalKey = new Map<string, TurnUsageRow>()
  let turnIndex = 0
  let activeSkill: string | null = null
  const parentsWithBaseMarker = new Set(
    records.flatMap((record) =>
      typeof record.parentUuid === 'string' && recordHasSkillBaseMarker(record)
        ? [record.parentUuid]
        : []
    )
  )

  for (const record of records) {
    if (userRecordStartsNewTurn(record)) {
      activeSkill = verifiedSlashSkill(record, parentsWithBaseMarker)
      continue
    }
    if (record.type !== 'assistant' || (agentId === null && record.isSidechain !== false)) continue

    const message = isRecord(record.message) ? record.message : null
    const attributedSkill =
      typeof record.attributionSkill === 'string' && record.attributionSkill.trim() !== ''
        ? record.attributionSkill.trim()
        : null
    const invokedSkill = message === null ? null : lastSkillToolUse(message)
    const resolvedSkill = attributedSkill ?? invokedSkill
    if (resolvedSkill !== null) activeSkill = resolvedSkill

    const sourceUuid = record.uuid
    const sessionId = record.sessionId
    const invokedAt = record.timestamp
    if (
      typeof sourceUuid !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof invokedAt !== 'string'
    ) {
      continue
    }

    const model = normalizeModelKey(
      message !== null && typeof message.model === 'string' ? message.model : ''
    )
    if (model === null) continue

    const requestId = typeof record.requestId === 'string' ? record.requestId : null
    const messageId = message !== null && typeof message.id === 'string' ? message.id : null
    const logicalTurnKey =
      messageId !== null
        ? `message:${messageId}`
        : requestId !== null
          ? `request:${requestId}`
          : `source:${sourceUuid}`
    const existing = rowsByLogicalKey.get(logicalTurnKey)
    if (existing !== undefined) {
      if (resolvedSkill !== null) {
        existing.active_skill = resolvedSkill
        activeSkill = resolvedSkill
      }
      continue
    }

    const usage = message !== null && isRecord(message.usage) ? message.usage : {}
    const cacheCreation = isRecord(usage.cache_creation) ? usage.cache_creation : {}
    const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {}
    const serverToolUse = isRecord(usage.server_tool_use) ? usage.server_tool_use : {}
    const effort =
      typeof record.effort === 'string' && VALID_EFFORTS.has(record.effort) ? record.effort : null

    const row: TurnUsageRow = {
      logical_turn_key: logicalTurnKey,
      source_uuid: sourceUuid,
      session_id: sessionId,
      request_id: requestId,
      message_id: messageId,
      turn_index: turnIndex++,
      model,
      effort,
      input_tokens: numberField(usage, 'input_tokens'),
      cache_read_tokens: numberField(usage, 'cache_read_input_tokens'),
      cache_creation_tokens: numberField(usage, 'cache_creation_input_tokens'),
      cache_creation_5m_tokens: numberField(cacheCreation, 'ephemeral_5m_input_tokens'),
      cache_creation_1h_tokens: numberField(cacheCreation, 'ephemeral_1h_input_tokens'),
      output_tokens: numberField(usage, 'output_tokens'),
      thinking_tokens:
        numberField(outputDetails, 'thinking_tokens') || numberField(usage, 'thinking_tokens'),
      web_search_requests: numberField(serverToolUse, 'web_search_requests'),
      agent_id: agentId,
      active_skill: activeSkill,
      invoked_at: invokedAt
    }
    rows.push(row)
    rowsByLogicalKey.set(logicalTurnKey, row)
  }

  return rows
}

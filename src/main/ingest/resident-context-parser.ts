import { normalizeModelKey } from './cost-parser'

export interface ResidentContextSample {
  session_id: string
  first_turn_at: string
  model: string
  claude_version: string | null
  cache_read_tokens: number
  measured_tokens: number
  cost_state_started_at: string | null
  skill_characters: number
  skill_count: number
  agent_characters: number
  agent_count: number
  hook_characters: number
  hook_count: number
  mcp_characters: number
  mcp_count: number
  instruction_characters: number
  instruction_count: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonNegativeInteger(value: unknown): number | null {
  const number = finiteNonNegativeNumber(value)
  return number !== null && Number.isInteger(number) ? number : null
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function attachmentIsBefore(timestamp: unknown, firstTurnAt: string): boolean | null {
  const attachmentTime = toIsoTimestamp(timestamp)
  const firstTurnTime = toIsoTimestamp(firstTurnAt)
  if (attachmentTime === null || firstTurnTime === null) return null
  return attachmentTime <= firstTurnTime
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
  return value as string[]
}

function firstAssistantTurn(records: Record<string, unknown>[]): {
  sessionId: string
  timestamp: string
  model: string
  cacheReadTokens: number
  measuredTokens: number
} | null {
  for (const record of records) {
    if (record.type !== 'assistant' || record.isSidechain !== false) continue
    const message = isRecord(record.message) ? record.message : null
    const model = normalizeModelKey(
      message !== null && typeof message.model === 'string' ? message.model : ''
    )
    if (model === null) continue

    const usage = message !== null && isRecord(message.usage) ? message.usage : null
    const cacheReadTokens = finiteNonNegativeNumber(usage?.cache_read_input_tokens)
    const measuredTokens = finiteNonNegativeNumber(usage?.cache_creation_input_tokens)
    if (
      typeof record.sessionId !== 'string' ||
      typeof record.timestamp !== 'string' ||
      cacheReadTokens === null ||
      measuredTokens === null
    ) {
      return null
    }

    return {
      sessionId: record.sessionId,
      timestamp: record.timestamp,
      model,
      cacheReadTokens,
      measuredTokens
    }
  }
  return null
}

function costStateStartedAt(records: Record<string, unknown>[]): string | null {
  let result: string | null = null
  for (const record of records) {
    if (record.type !== 'cost-state') continue
    result = toIsoTimestamp(record.startTime)
  }
  return result
}

export function extractResidentContextSample(
  records: Record<string, unknown>[]
): ResidentContextSample | null {
  const firstTurn = firstAssistantTurn(records)
  if (firstTurn === null) return null

  const skillContents = new Set<string>()
  let skillCount = 0
  const agentListings = new Set<string>()
  let agentCount = 0
  const hooks = new Map<string, string>()
  const mcpBlocks = new Set<string>()
  const instructionFiles = new Map<string, string>()

  for (const [recordIndex, record] of records.entries()) {
    if (record.type !== 'attachment') continue
    const attachment = isRecord(record.attachment) ? record.attachment : null
    if (attachment === null || typeof attachment.type !== 'string') continue

    if (attachment.type === 'hook_success') {
      if (attachment.hookEvent !== 'SessionStart') continue
      if (attachment.exitCode !== 0) continue
      const content =
        typeof attachment.content === 'string'
          ? attachment.content
          : typeof attachment.stdout === 'string'
            ? attachment.stdout.trimEnd()
            : null
      if (content === null) return null
      const hookName =
        typeof attachment.hookName === 'string' && attachment.hookName !== ''
          ? attachment.hookName
          : `record-${recordIndex}`
      hooks.set(`${hookName}\u0000${content}`, content)
      continue
    }

    if (
      attachment.type !== 'skill_listing' &&
      attachment.type !== 'agent_listing_delta' &&
      attachment.type !== 'mcp_instructions_delta' &&
      attachment.type !== 'instructions'
    ) {
      continue
    }

    const isBefore = attachmentIsBefore(record.timestamp, firstTurn.timestamp)
    if (isBefore === null) return null
    if (!isBefore) continue

    if (attachment.type === 'skill_listing') {
      if (attachment.isInitial !== true) continue
      if (typeof attachment.content !== 'string') return null
      const count =
        attachment.skillCount === undefined
          ? (stringArray(attachment.names)?.length ?? null)
          : nonNegativeInteger(attachment.skillCount)
      if (count === null) return null
      skillContents.add(attachment.content)
      skillCount = Math.max(skillCount, count)
      continue
    }

    if (attachment.type === 'agent_listing_delta') {
      if (attachment.isInitial !== true) continue
      const lines = stringArray(attachment.addedLines)
      if (lines === null) return null
      const types = attachment.addedTypes === undefined ? lines : stringArray(attachment.addedTypes)
      if (types === null) return null
      agentListings.add(lines.join('\n'))
      agentCount = Math.max(agentCount, types.length)
      continue
    }

    if (attachment.type === 'mcp_instructions_delta') {
      if (!Array.isArray(attachment.addedBlocks)) return null
      for (const block of attachment.addedBlocks) {
        if (typeof block === 'string') {
          mcpBlocks.add(block)
          continue
        }
        if (!isRecord(block)) return null
        const content = [block.content, block.text, block.instructions].find(
          (value): value is string => typeof value === 'string'
        )
        if (content === undefined) return null
        mcpBlocks.add(content)
      }
      continue
    }

    if (!Array.isArray(attachment.files)) return null
    for (const file of attachment.files) {
      if (!isRecord(file) || typeof file.content !== 'string') return null
      const key =
        typeof file.path === 'string' ? file.path : `record-${recordIndex}-${instructionFiles.size}`
      instructionFiles.set(key, file.content)
    }
  }

  const claudeVersion = records.find(
    (record) => typeof record.version === 'string' && record.version.trim() !== ''
  )?.version

  return {
    session_id: firstTurn.sessionId,
    first_turn_at: firstTurn.timestamp,
    model: firstTurn.model,
    claude_version: typeof claudeVersion === 'string' ? claudeVersion : null,
    cache_read_tokens: firstTurn.cacheReadTokens,
    measured_tokens: firstTurn.measuredTokens,
    cost_state_started_at: costStateStartedAt(records),
    skill_characters: [...skillContents].reduce((total, content) => total + content.length, 0),
    skill_count: skillCount,
    agent_characters: [...agentListings].reduce((total, content) => total + content.length, 0),
    agent_count: agentCount,
    hook_characters: [...hooks.values()].reduce((total, content) => total + content.length, 0),
    hook_count: hooks.size,
    mcp_characters: [...mcpBlocks].reduce((total, content) => total + content.length, 0),
    mcp_count: mcpBlocks.size,
    instruction_characters: [...instructionFiles.values()].reduce(
      (total, content) => total + content.length,
      0
    ),
    instruction_count: instructionFiles.size
  }
}

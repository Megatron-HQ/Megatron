import { describe, expect, it } from 'vitest'
import {
  extractCostState,
  extractTurnUsage,
  normalizeModelKey,
  toModelCostRows
} from './cost-parser'

function costStateLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'cost-state',
    sessionId: 'sess-A',
    totalCostUSD: 2.5,
    startTime: 1788381209533,
    modelUsage: {
      'claude-sonnet-5': {
        inputTokens: 100,
        outputTokens: 200,
        thinkingTokens: 50,
        cacheReadInputTokens: 3000,
        cacheCreationInputTokens: 400,
        webSearchRequests: 0,
        costUSD: 2.5
      }
    },
    hasUnknownModelCost: false,
    ...overrides
  }
}

function assistantLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const overrideMessage =
    typeof overrides.message === 'object' && overrides.message !== null
      ? (overrides.message as Record<string, unknown>)
      : {}
  const rest = { ...overrides }
  delete rest.message
  return {
    type: 'assistant',
    uuid: 'u-1',
    requestId: 'req-1',
    sessionId: 'sess-A',
    isSidechain: false,
    timestamp: '2026-09-05T12:00:00.000Z',
    apiBlockIndex: 0,
    effort: 'high',
    message: {
      id: 'msg-1',
      model: 'claude-sonnet-5',
      usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 12000 },
      ...overrideMessage
    },
    ...rest
  }
}

describe('normalizeModelKey', () => {
  it('strips a trailing 8-digit date suffix', () => {
    expect(normalizeModelKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  })

  it('leaves a key with no date suffix unchanged', () => {
    expect(normalizeModelKey('claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(normalizeModelKey('claude-opus-5')).toBe('claude-opus-5')
  })

  it('returns null for the synthetic sentinel', () => {
    expect(normalizeModelKey('<synthetic>')).toBeNull()
  })

  it('returns null for an empty or whitespace key', () => {
    expect(normalizeModelKey('')).toBeNull()
    expect(normalizeModelKey('   ')).toBeNull()
  })

  it('only strips an 8-digit suffix, not a version-looking tail', () => {
    expect(normalizeModelKey('claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
  })
})

describe('extractCostState', () => {
  it('returns null when no cost-state line is present', () => {
    expect(
      extractCostState([assistantLine(), { type: 'user', message: { content: 'hi' } }])
    ).toBeNull()
  })

  it('extracts the core fields from a cost-state line', () => {
    const result = extractCostState([assistantLine(), costStateLine({ totalCostUSD: 3.14 })])
    expect(result).not.toBeNull()
    expect(result?.totalCostUsd).toBe(3.14)
    expect(result?.hasUnknownModelCost).toBe(false)
    expect(result).not.toHaveProperty('continuedInSessionId')
  })

  it('converts the epoch-ms startTime to an ISO 8601 UTC string', () => {
    const result = extractCostState([costStateLine({ startTime: 1788381209533 })])
    expect(result?.costStateStartTime).toBe('2026-09-02T20:33:29.533Z')
  })

  it('takes the last cost-state line when several are present', () => {
    const result = extractCostState([
      costStateLine({ totalCostUSD: 1 }),
      assistantLine({ uuid: 'u-2' }),
      costStateLine({ totalCostUSD: 9 })
    ])
    expect(result?.totalCostUsd).toBe(9)
  })

  it('normalizes model keys and sums collapsed buckets', () => {
    const result = extractCostState([
      costStateLine({
        totalCostUSD: 5,
        modelUsage: {
          'claude-haiku-4-5-20251001': { costUSD: 1, inputTokens: 10, outputTokens: 5 },
          'claude-haiku-4-5-20250901': { costUSD: 2, inputTokens: 20, outputTokens: 7 }
        }
      })
    ])
    expect(Object.keys(result?.modelUsage ?? {})).toEqual(['claude-haiku-4-5'])
    expect(result?.modelUsage['claude-haiku-4-5']).toMatchObject({
      costUSD: 3,
      inputTokens: 30,
      outputTokens: 12
    })
  })

  it('drops a <synthetic> model bucket', () => {
    const result = extractCostState([
      costStateLine({
        modelUsage: {
          'claude-sonnet-5': { costUSD: 2.5, inputTokens: 100 },
          '<synthetic>': { costUSD: 0, inputTokens: 3 }
        }
      })
    ])
    expect(Object.keys(result?.modelUsage ?? {})).toEqual(['claude-sonnet-5'])
  })

  it('flags an all-zeroed cost-state as zeroed rather than a real $0 session', () => {
    const result = extractCostState([
      assistantLine(),
      costStateLine({ totalCostUSD: 0, modelUsage: {} })
    ])
    expect(result?.isZeroed).toBe(true)
    expect(result?.totalCostUsd).toBe(0)
  })

  it('does not flag a normal priced cost-state as zeroed', () => {
    const result = extractCostState([costStateLine({ totalCostUSD: 2.5 })])
    expect(result?.isZeroed).toBe(false)
  })

  it('leaves continued-in lineage to session metadata', () => {
    const result = extractCostState([
      { type: 'continued-in', sessionId: 'sess-A', continuedInSessionId: 'sess-B' },
      costStateLine()
    ])
    expect(result).not.toHaveProperty('continuedInSessionId')
  })
})

// Shape-snapshot guard: a real cost-state line captured verbatim from
// ~/.claude/projects on 2026-09-05 (CC v2.1.247+). If Anthropic renames or moves a field,
// extraction from this frozen input breaks and CI fails loudly instead of the UI showing
// silently wrong dollar figures. Update only alongside a deliberate parser change.
const FROZEN_COST_STATE: Record<string, unknown> = {
  type: 'cost-state',
  sessionId: '31eab75f-5d78-4487-8c8a-e7dfef659482',
  totalCostUSD: 2.183658,
  totalAPIDuration: 850234,
  totalAPIDurationWithoutRetries: 849648,
  totalToolDuration: 34784,
  totalLinesAdded: 590,
  totalLinesRemoved: 0,
  totalDuration: 30324907,
  startTime: 1788381209533,
  modelUsage: {
    'claude-haiku-4-5-20251001': {
      inputTokens: 29201,
      outputTokens: 1534,
      thinkingTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 1,
      costUSD: 0.046871
    },
    'claude-sonnet-5': {
      inputTokens: 1344,
      outputTokens: 57765,
      thinkingTokens: 31063,
      cacheReadInputTokens: 2957665,
      cacheCreationInputTokens: 241229,
      webSearchRequests: 0,
      costUSD: 2.136787
    }
  },
  hasUnknownModelCost: false
}

describe('extractCostState — frozen shape snapshot', () => {
  it('extracts every field from a real captured cost-state line', () => {
    expect(extractCostState([FROZEN_COST_STATE])).toEqual({
      totalCostUsd: 2.183658,
      hasUnknownModelCost: false,
      isZeroed: false,
      costStateStartTime: '2026-09-02T20:33:29.533Z',
      modelUsage: {
        'claude-haiku-4-5': {
          inputTokens: 29201,
          outputTokens: 1534,
          thinkingTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 1,
          costUSD: 0.046871
        },
        'claude-sonnet-5': {
          inputTokens: 1344,
          outputTokens: 57765,
          thinkingTokens: 31063,
          cacheReadInputTokens: 2957665,
          cacheCreationInputTokens: 241229,
          webSearchRequests: 0,
          costUSD: 2.136787
        }
      }
    })
  })
})

describe('toModelCostRows', () => {
  it('projects each verbatim cost-state field onto its typed snake_case column', () => {
    const cost = extractCostState([
      costStateLine({
        modelUsage: {
          'claude-sonnet-5': {
            inputTokens: 100,
            outputTokens: 200,
            thinkingTokens: 50,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 400,
            webSearchRequests: 2,
            costUSD: 2.5
          }
        }
      })
    ])!

    expect(toModelCostRows(cost)).toEqual([
      {
        model: 'claude-sonnet-5',
        cost_usd: 2.5,
        input_tokens: 100,
        output_tokens: 200,
        thinking_tokens: 50,
        cache_read_tokens: 3000,
        cache_creation_tokens: 400,
        web_search_requests: 2
      }
    ])
  })

  it('defaults a missing per-model field to 0', () => {
    const cost = extractCostState([
      costStateLine({ modelUsage: { 'claude-opus-5': { costUSD: 1.25 } } })
    ])!

    expect(toModelCostRows(cost)).toEqual([
      {
        model: 'claude-opus-5',
        cost_usd: 1.25,
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 0
      }
    ])
  })

  it('emits one row for date-suffixed keys already collapsed by extractCostState', () => {
    const cost = extractCostState([
      costStateLine({
        modelUsage: {
          'claude-haiku-4-5-20251001': { costUSD: 1, inputTokens: 10 },
          'claude-haiku-4-5-20250901': { costUSD: 2, inputTokens: 20 }
        }
      })
    ])!

    expect(toModelCostRows(cost)).toEqual([
      expect.objectContaining({ model: 'claude-haiku-4-5', cost_usd: 3, input_tokens: 30 })
    ])
  })

  it('produces the two expected typed rows from the frozen cost-state snapshot', () => {
    expect(toModelCostRows(extractCostState([FROZEN_COST_STATE])!)).toEqual([
      {
        model: 'claude-haiku-4-5',
        cost_usd: 0.046871,
        input_tokens: 29201,
        output_tokens: 1534,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        web_search_requests: 1
      },
      {
        model: 'claude-sonnet-5',
        cost_usd: 2.136787,
        input_tokens: 1344,
        output_tokens: 57765,
        thinking_tokens: 31063,
        cache_read_tokens: 2957665,
        cache_creation_tokens: 241229,
        web_search_requests: 0
      }
    ])
  })
})

describe('extractTurnUsage', () => {
  it('emits one row per assistant turn with its shape fields', () => {
    const rows = extractTurnUsage([
      assistantLine({
        uuid: 'u-1',
        effort: 'xhigh',
        message: {
          model: 'claude-sonnet-5',
          usage: { cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }
        }
      })
    ])
    expect(rows).toEqual([
      {
        logical_turn_key: 'message:msg-1',
        source_uuid: 'u-1',
        session_id: 'sess-A',
        request_id: 'req-1',
        message_id: 'msg-1',
        turn_index: 0,
        model: 'claude-sonnet-5',
        effort: 'xhigh',
        input_tokens: 0,
        cache_read_tokens: 900,
        cache_creation_tokens: 100,
        cache_creation_5m_tokens: 0,
        cache_creation_1h_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        web_search_requests: 0,
        agent_id: null,
        active_skill: null,
        invoked_at: '2026-09-05T12:00:00.000Z'
      }
    ])
  })

  it('normalizes the model key', () => {
    const rows = extractTurnUsage([
      assistantLine({ message: { model: 'claude-haiku-4-5-20251001', usage: {} } })
    ])
    expect(rows[0].model).toBe('claude-haiku-4-5')
  })

  it('skips a <synthetic> turn entirely', () => {
    const rows = extractTurnUsage([assistantLine({ message: { model: '<synthetic>', usage: {} } })])
    expect(rows).toEqual([])
  })

  it('skips interleaved sidechain records', () => {
    const rows = extractTurnUsage([assistantLine({ isSidechain: true })])
    expect(rows).toEqual([])
  })

  it('dedups turns that share a uuid', () => {
    const rows = extractTurnUsage([assistantLine({ uuid: 'dup' }), assistantLine({ uuid: 'dup' })])
    expect(rows).toHaveLength(1)
  })

  it('collapses physical content-block records sharing one logical message without summing usage', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 20,
      thinking_tokens: 5,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
      cache_creation: {
        ephemeral_5m_input_tokens: 12,
        ephemeral_1h_input_tokens: 28
      },
      server_tool_use: { web_search_requests: 2 }
    }
    const rows = extractTurnUsage([
      assistantLine({
        uuid: 'thinking',
        message: { id: 'msg-shared', model: 'claude-sonnet-5', usage }
      }),
      assistantLine({
        uuid: 'text',
        message: { id: 'msg-shared', model: 'claude-sonnet-5', usage }
      })
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      logical_turn_key: 'message:msg-shared',
      source_uuid: 'thinking',
      input_tokens: 10,
      output_tokens: 20,
      thinking_tokens: 5,
      cache_creation_5m_tokens: 12,
      cache_creation_1h_tokens: 28,
      web_search_requests: 2
    })
  })

  it('keeps fallback skill state through tool results and clears it on the next real user prompt', () => {
    const rows = extractTurnUsage([
      { type: 'user', message: { content: 'please work' } },
      assistantLine({
        uuid: 'invoke',
        requestId: 'req-invoke',
        message: {
          id: 'msg-invoke',
          model: 'claude-sonnet-5',
          usage: { output_tokens: 5 },
          content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'alpha' } }]
        }
      }),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't-1' }] } },
      assistantLine({
        uuid: 'after-tool',
        requestId: 'req-after',
        message: { id: 'msg-after', model: 'claude-sonnet-5', usage: {} }
      }),
      { type: 'user', message: { content: 'new request' } },
      assistantLine({
        uuid: 'after-user',
        requestId: 'req-user',
        message: { id: 'msg-user', model: 'claude-sonnet-5', usage: {} }
      })
    ])

    expect(rows.map((row) => row.active_skill)).toEqual(['alpha', 'alpha', null])
  })

  it('activates a slash-command skill only when its direct child has the base-directory marker', () => {
    const rows = extractTurnUsage([
      {
        type: 'user',
        uuid: 'slash-parent',
        message: {
          content: '<command-name>/domain-modeling</command-name><command-args></command-args>'
        }
      },
      {
        type: 'user',
        parentUuid: 'slash-parent',
        message: { content: 'Base directory for this skill: C:/skills/domain-modeling' }
      },
      assistantLine({
        uuid: 'after-slash',
        message: { id: 'after-slash', model: 'claude-sonnet-5', usage: {} }
      })
    ])

    expect(rows[0].active_skill).toBe('domain-modeling')
  })

  it('includes dedicated subagent turns with their agent id', () => {
    const rows = extractTurnUsage([assistantLine({ isSidechain: true })], 'agent-123')
    expect(rows).toHaveLength(1)
    expect(rows[0].agent_id).toBe('agent-123')
  })

  it('defaults a missing effort to null and missing usage counts to 0', () => {
    const rows = extractTurnUsage([
      assistantLine({
        effort: undefined,
        message: { model: 'claude-sonnet-5', usage: undefined }
      })
    ])
    expect(rows[0].effort).toBeNull()
    expect(rows[0].cache_read_tokens).toBe(0)
    expect(rows[0].cache_creation_tokens).toBe(0)
  })

  it('numbers turn_index by scan position, ignoring the unreliable apiBlockIndex', () => {
    const rows = extractTurnUsage([
      assistantLine({
        uuid: 'a',
        requestId: 'req-a',
        message: { id: 'msg-a', model: 'claude-sonnet-5', usage: {} },
        apiBlockIndex: 7
      }),
      { type: 'user', uuid: 'x', sessionId: 'sess-A', message: { content: 'next' } },
      assistantLine({
        uuid: 'b',
        requestId: 'req-b',
        message: { id: 'msg-b', model: 'claude-sonnet-5', usage: {} },
        apiBlockIndex: 7
      })
    ])
    expect(rows.map((r) => r.turn_index)).toEqual([0, 1])
  })

  it('does not let a skipped synthetic turn consume a turn_index', () => {
    const rows = extractTurnUsage([
      assistantLine({ uuid: 'syn', message: { model: '<synthetic>', usage: {} } }),
      assistantLine({ uuid: 'real', message: { model: 'claude-sonnet-5', usage: {} } })
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].turn_index).toBe(0)
  })

  it('ignores non-assistant records', () => {
    const rows = extractTurnUsage([
      { type: 'user', uuid: 'u', sessionId: 'sess-A', message: { content: 'hi' } },
      costStateLine()
    ])
    expect(rows).toEqual([])
  })
})

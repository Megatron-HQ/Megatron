import { describe, expect, it } from 'vitest'
import { extractResidentContextSample } from './resident-context-parser'

function firstTurn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'assistant',
    sessionId: 'session-1',
    timestamp: '2026-09-11T12:02:00.000Z',
    isSidechain: false,
    message: {
      model: 'claude-sonnet-5-20260901',
      usage: {
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 2400
      }
    },
    ...overrides
  }
}

function attachment(
  value: Record<string, unknown>,
  timestamp = '2026-09-11T12:01:00.000Z'
): Record<string, unknown> {
  return {
    type: 'attachment',
    timestamp,
    attachment: value
  }
}

describe('extractResidentContextSample', () => {
  it('counts all itemized resident categories and keeps only numeric metadata', () => {
    const result = extractResidentContextSample([
      { type: 'user', version: '2.1.261' },
      attachment({ type: 'skill_listing', isInitial: true, content: 'skills', skillCount: 3 }),
      attachment({
        type: 'agent_listing_delta',
        isInitial: true,
        addedLines: ['agent one', 'agent two'],
        addedTypes: ['one', 'two']
      }),
      attachment({
        type: 'mcp_instructions_delta',
        addedBlocks: [
          { serverName: 'github', content: 'github instructions' },
          { serverName: 'linear', content: 'linear instructions' }
        ]
      }),
      attachment({
        type: 'instructions',
        files: [
          { path: '/repo/CLAUDE.md', content: 'project rules', type: 'project' },
          { path: '/repo/child/CLAUDE.md', content: 'child rules', type: 'local' }
        ]
      }),
      firstTurn(),
      attachment(
        {
          type: 'hook_success',
          hookEvent: 'SessionStart',
          hookName: 'bootstrap',
          exitCode: 0,
          content: 'hook text',
          stdout: 'hook text\n'
        },
        '2026-09-11T12:03:00.000Z'
      )
    ])

    expect(result).toEqual({
      session_id: 'session-1',
      first_turn_at: '2026-09-11T12:02:00.000Z',
      model: 'claude-sonnet-5',
      claude_version: '2.1.261',
      cache_read_tokens: 0,
      measured_tokens: 2400,
      cost_state_started_at: null,
      skill_characters: 6,
      skill_count: 3,
      agent_characters: 19,
      agent_count: 2,
      hook_characters: 9,
      hook_count: 1,
      mcp_characters: 38,
      mcp_count: 2,
      instruction_characters: 24,
      instruction_count: 2
    })
    expect(JSON.stringify(result)).not.toContain('instructions')
    expect(JSON.stringify(result)).not.toContain('project rules')
  })

  it('rejects the sample when the first real turn omits a required cache field', () => {
    expect(
      extractResidentContextSample([
        firstTurn({
          message: {
            model: 'claude-sonnet-5',
            usage: { cache_creation_input_tokens: 2400 }
          }
        }),
        firstTurn({ timestamp: '2026-09-11T12:03:00.000Z' })
      ])
    ).toBeNull()
  })

  it('rejects malformed recognized attachment payloads', () => {
    expect(
      extractResidentContextSample([
        attachment({ type: 'mcp_instructions_delta', addedBlocks: 'not-an-array' }),
        firstTurn()
      ])
    ).toBeNull()
  })

  it('uses skill names when the listing omits skillCount', () => {
    expect(
      extractResidentContextSample([
        attachment({
          type: 'skill_listing',
          isInitial: true,
          content: 'skills',
          names: ['one', 'two']
        }),
        firstTurn()
      ])
    ).toEqual(expect.objectContaining({ skill_count: 2 }))
  })

  it('ignores later resident deltas and unrelated attachment types', () => {
    const result = extractResidentContextSample([
      attachment({ type: 'skill_listing', isInitial: true, content: 'before', skillCount: 1 }),
      attachment({ type: 'prompt_snapshot', systemPrompt: 'private prompt content' }),
      attachment({ type: 'future_attachment', content: 'unknown' }),
      firstTurn(),
      attachment(
        { type: 'agent_listing_delta', isInitial: true, addedLines: ['after'], addedTypes: ['x'] },
        '2026-09-11T12:03:00.000Z'
      )
    ])

    expect(result).toEqual(
      expect.objectContaining({
        skill_characters: 6,
        skill_count: 1,
        agent_characters: 0,
        agent_count: 0
      })
    )
  })

  it('captures the latest optional cost-state start time', () => {
    expect(
      extractResidentContextSample([
        { type: 'cost-state', startTime: Date.parse('2026-09-11T12:00:00.000Z') },
        firstTurn()
      ])
    ).toEqual(expect.objectContaining({ cost_state_started_at: '2026-09-11T12:00:00.000Z' }))
  })
})

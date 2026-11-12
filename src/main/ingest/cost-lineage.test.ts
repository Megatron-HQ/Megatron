import { describe, expect, it } from 'vitest'
import type { ModelCost } from './cost-parser'
import {
  resolveCostLineages,
  type LineageCost,
  type LineageSession,
  type LineageTurn
} from './cost-lineage'

const START_TIME = '2026-11-06T10:00:00.000Z'
const STARTED_AT = '2026-11-06T10:00:01.000Z'
const OPUS = 'claude-opus-5'
const HAIKU = 'claude-haiku-5'

type Counter = Partial<Omit<ModelCost, 'model'>>

function models(counters: Record<string, Counter>): ModelCost[] {
  return Object.entries(counters).map(([model, counter]) => ({
    model,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    web_search_requests: 0,
    ...counter
  }))
}

function turn(output: number, input = 0, model = OPUS): LineageTurn {
  return {
    model,
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: 0,
    cache_creation_tokens: 0
  }
}

function session(
  id: string,
  total: number,
  counters: Record<string, Counter>,
  turnKeys: string[],
  options: {
    startTime?: string | null
    startedAt?: string
    continuedIn?: string
    zeroed?: boolean
    unknown?: boolean
  } = {}
): LineageSession {
  return {
    session_id: id,
    started_at: options.startedAt ?? STARTED_AT,
    continued_in_session_id: options.continuedIn ?? null,
    cost: {
      total_cost_usd: total,
      is_zeroed: options.zeroed ?? false,
      has_unknown_model_cost: options.unknown ?? false,
      cost_state_start_time: options.startTime === undefined ? START_TIME : options.startTime,
      models: models(counters)
    },
    turn_keys: turnKeys
  }
}

interface Resolved {
  head: (id: string) => string | null
  parent: (id: string) => string | null
  lineage: (head: string) => LineageCost | undefined
  heads: string[]
}

function resolve(sessions: LineageSession[], turns: Record<string, LineageTurn>): Resolved {
  const result = resolveCostLineages(sessions, new Map(Object.entries(turns)))
  const byId = new Map(result.sessions.map((row) => [row.session_id, row]))
  return {
    head: (id: string) => byId.get(id)?.head_session_id ?? null,
    parent: (id: string) => byId.get(id)?.parent_session_id ?? null,
    lineage: (head: string) => result.lineages.find((row) => row.head_session_id === head),
    heads: result.lineages.map((row) => row.head_session_id).sort()
  }
}

describe('resolveCostLineages', () => {
  it('counts a desktop resume chain once, at its last counter', () => {
    const turns = { t1: turn(100), t2: turn(100), t3: turn(100), t4: turn(100), t5: turn(100) }
    const result = resolve(
      [
        session('c1', 2.78, { [OPUS]: { cost_usd: 2.78, output_tokens: 100 } }, ['t1']),
        session('c2', 3.02, { [OPUS]: { cost_usd: 3.02, output_tokens: 200 } }, ['t1', 't2']),
        session('c3', 3.35, { [OPUS]: { cost_usd: 3.35, output_tokens: 300 } }, ['t1', 't2', 't3']),
        session('c4', 4.96, { [OPUS]: { cost_usd: 4.96, output_tokens: 400 } }, [
          't1',
          't2',
          't3',
          't4'
        ]),
        session('c5', 6.81, { [OPUS]: { cost_usd: 6.81, output_tokens: 500 } }, [
          't1',
          't2',
          't3',
          't4',
          't5'
        ])
      ],
      turns
    )

    expect(result.heads).toEqual(['c5'])
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) expect(result.head(id)).toBe('c5')
    expect(result.lineage('c5')?.total_cost_usd).toBeCloseTo(6.81, 10)
    expect(result.lineage('c5')?.is_estimate).toBe(false)
    expect(result.lineage('c5')?.models).toEqual([
      expect.objectContaining({ model: OPUS, output_tokens: 500 })
    ])
  })

  it('parents a rewind fork on the source whose counter it inherited, not its content parent', () => {
    // r rewound s1 back to t1 and asked again: fewer records than s1, but s1's whole counter.
    const turns = { t1: turn(100), t2: turn(100), t3: turn(100), t4: turn(100) }
    const result = resolve(
      [
        session('s0', 2, { [OPUS]: { cost_usd: 2, output_tokens: 200 } }, ['t1', 't2']),
        session('s1', 3, { [OPUS]: { cost_usd: 3, output_tokens: 300 } }, ['t1', 't2', 't3']),
        session('r', 4, { [OPUS]: { cost_usd: 4, output_tokens: 400 } }, ['t1', 't4'])
      ],
      turns
    )

    expect(result.parent('r')).toBe('s1')
    expect(result.lineage('r')?.total_cost_usd).toBeCloseTo(4, 10)
  })

  it('adds both branches of CLI siblings whose second branch sits under the first on every field', () => {
    const turns = { t1: turn(100, 10), t2: turn(100, 10), a1: turn(150, 10), b1: turn(100, 5) }
    const result = resolve(
      [
        session('p', 1, { [OPUS]: { cost_usd: 1, output_tokens: 200, input_tokens: 20 } }, [
          't1',
          't2'
        ]),
        session('a', 1.6, { [OPUS]: { cost_usd: 1.6, output_tokens: 350, input_tokens: 30 } }, [
          't1',
          't2',
          'a1'
        ]),
        session('b', 1.4, { [OPUS]: { cost_usd: 1.4, output_tokens: 300, input_tokens: 25 } }, [
          't1',
          't2',
          'b1'
        ])
      ],
      turns
    )

    expect(result.parent('a')).toBe('p')
    expect(result.parent('b')).toBe('p')
    expect(result.heads).toEqual(['a'])
    expect(result.head('b')).toBe('a')
    const lineage = result.lineage('a')
    expect(lineage?.total_cost_usd).toBeCloseTo(2, 10)
    expect(lineage?.is_estimate).toBe(false)
    expect(lineage?.models).toHaveLength(1)
    expect(lineage?.models[0].cost_usd).toBeCloseTo(2, 10)
    expect(lineage?.models[0]).toMatchObject({ output_tokens: 450, input_tokens: 35 })
  })

  it('counts identical-counter duplicates once without a parent cycle', () => {
    const turns = { t1: turn(100) }
    const result = resolve(
      [
        session('d2', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1']),
        session('d1', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1'])
      ],
      turns
    )

    expect(result.parent('d1')).toBeNull()
    expect(result.parent('d2')).toBe('d1')
    expect(result.heads).toEqual(['d2'])
    expect(result.lineage('d2')?.total_cost_usd).toBe(1)
    expect(result.lineage('d2')?.is_estimate).toBe(false)
  })

  it('keeps sessions that share a startTime but not a first record in separate lineages', () => {
    const turns = { t1: turn(100), t2: turn(100) }
    const result = resolve(
      [
        session('x', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1']),
        session('y', 2, { [OPUS]: { cost_usd: 2, output_tokens: 200 } }, ['t1', 't2'], {
          startedAt: '2026-11-06T11:00:00.000Z'
        })
      ],
      turns
    )

    expect(result.heads).toEqual(['x', 'y'])
    expect(result.lineage('x')?.total_cost_usd).toBe(1)
    expect(result.lineage('y')?.total_cost_usd).toBe(2)
  })

  it('keeps sessions that share a first record but not a startTime in separate lineages', () => {
    // /clear resets cost-state.startTime while the transcript's first record stays the same.
    const turns = { t1: turn(100), t2: turn(100) }
    const result = resolve(
      [
        session('x', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1']),
        session('y', 2, { [OPUS]: { cost_usd: 2, output_tokens: 200 } }, ['t1', 't2'], {
          startTime: '2026-11-06T12:00:00.000Z'
        })
      ],
      turns
    )

    expect(result.heads).toEqual(['x', 'y'])
  })

  it('joins an explicit continued-in edge and an implicit fork into one lineage counted once', () => {
    const turns = { t1: turn(100), t2: turn(100), t3: turn(50) }
    const result = resolve(
      [
        session('a', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1'], {
          startedAt: '2026-11-06T09:00:00.000Z',
          continuedIn: 'b'
        }),
        session('b', 2, { [OPUS]: { cost_usd: 2, output_tokens: 200 } }, ['t1', 't2']),
        session('f', 2.5, { [OPUS]: { cost_usd: 2.5, output_tokens: 250 } }, ['t1', 't2', 't3'])
      ],
      turns
    )

    expect(result.parent('b')).toBe('a')
    expect(result.parent('f')).toBe('b')
    expect(result.heads).toEqual(['f'])
    expect(result.head('a')).toBe('f')
    expect(result.lineage('f')?.total_cost_usd).toBeCloseTo(2.5, 10)
  })

  it('falls back to the head counter as an estimate when a pruned ancestor leaves two roots', () => {
    const turns = { t1: turn(100, 10), t2: turn(100, 10), a1: turn(150, 10), b1: turn(100, 5) }
    const result = resolve(
      [
        session('a', 1.6, { [OPUS]: { cost_usd: 1.6, output_tokens: 350, input_tokens: 30 } }, [
          't1',
          't2',
          'a1'
        ]),
        session('b', 1.4, { [OPUS]: { cost_usd: 1.4, output_tokens: 300, input_tokens: 25 } }, [
          't1',
          't2',
          'b1'
        ])
      ],
      turns
    )

    expect(result.heads).toEqual(['a'])
    expect(result.lineage('a')).toMatchObject({ total_cost_usd: 1.6, is_estimate: true })
    expect(result.lineage('a')?.models[0]).toMatchObject({ cost_usd: 1.6, output_tokens: 350 })
  })

  it('leaves zeroed, unpriced, unknown-model, and pre-startTime sessions out of fork grouping', () => {
    const turns = { t1: turn(100), t2: turn(100) }
    const result = resolve(
      [
        session('m', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1']),
        session('zeroed', 0, {}, ['t1'], { zeroed: true }),
        { ...session('unpriced', 0, {}, ['t1']), cost: null },
        session('unknown', 3, { [OPUS]: { cost_usd: 3, output_tokens: 200 } }, ['t1', 't2'], {
          unknown: true
        }),
        session('legacy', 4, { [OPUS]: { cost_usd: 4, output_tokens: 200 } }, ['t1', 't2'], {
          startTime: null
        })
      ],
      turns
    )

    expect(result.heads).toEqual(['legacy', 'm', 'unknown'])
    expect(result.head('zeroed')).toBeNull()
    expect(result.head('unpriced')).toBeNull()
    expect(result.lineage('m')?.total_cost_usd).toBe(1)
    expect(result.lineage('unknown')).toMatchObject({
      total_cost_usd: 3,
      has_unknown_model_cost: true
    })
    expect(result.lineage('legacy')?.total_cost_usd).toBe(4)
  })

  it('accepts a parent whose counter gap exceeds the new turns because of background calls', () => {
    // Title generation and other background requests bill the counter with no transcript line.
    const turns = { t1: turn(100), t2: turn(100) }
    const result = resolve(
      [
        session('s', 1, { [OPUS]: { cost_usd: 1, output_tokens: 100 } }, ['t1']),
        session(
          'm',
          1.2,
          {
            [OPUS]: { cost_usd: 1.15, output_tokens: 200 },
            [HAIKU]: { cost_usd: 0.05, input_tokens: 500, output_tokens: 50 }
          },
          ['t1', 't2']
        )
      ],
      turns
    )

    expect(result.parent('m')).toBe('s')
    expect(result.lineage('m')).toMatchObject({ is_estimate: false })
    expect(result.lineage('m')?.total_cost_usd).toBeCloseTo(1.2, 10)
  })

  it('resolves continued-in chains outside fork grouping to their priced terminal', () => {
    const result = resolve(
      [
        { ...session('unpriced-start', 0, {}, []), continued_in_session_id: 'legacy-mid' },
        session('legacy-mid', 1, {}, [], { startTime: null, continuedIn: 'legacy-end' }),
        session('legacy-end', 2, {}, [], { startTime: null }),
        session('before-zeroed', 1, {}, [], { startTime: null, continuedIn: 'zeroed-end' }),
        session('zeroed-end', 0, {}, [], { startTime: null, zeroed: true })
      ],
      {}
    )

    expect(result.heads).toEqual(['legacy-end'])
    expect(result.head('unpriced-start')).toBe('legacy-end')
    expect(result.head('legacy-mid')).toBe('legacy-end')
    expect(result.lineage('legacy-end')?.total_cost_usd).toBe(2)
    expect(result.head('before-zeroed')).toBeNull()
  })
})

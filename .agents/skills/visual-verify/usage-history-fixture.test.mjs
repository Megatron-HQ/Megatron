import assert from 'node:assert/strict'
import test from 'node:test'
import { usageHistoryFixture } from './usage-history-fixture.mjs'

const CATEGORIES = ['input', 'output', 'cacheRead', 'cacheWrite', 'total']

for (const mode of [
  'usage-history-sample',
  'usage-history-format',
  'usage-history-token-details'
]) {
  test(`${mode} reconciles token bucket details with the parent window`, () => {
    const { tokens } = usageHistoryFixture('usage:overview', [], {}, mode)
    for (const window of [tokens.last24h, tokens.last7d, tokens.last30d]) {
      for (const category of CATEGORIES) {
        assert.equal(
          window.trend.reduce((sum, bucket) => sum + (bucket.tokens?.[category] ?? 0), 0),
          window.tokens[category]
        )
        for (const bucket of window.trend) {
          for (const dimension of ['byModel', 'byProject']) {
            assert.equal(
              bucket[dimension]?.reduce((sum, row) => sum + row.tokens[category], 0),
              bucket.tokens?.[category] ?? 0
            )
          }
        }
      }
      for (const bucket of window.trend) {
        assert.ok(bucket.startAt >= window.startAt)
        assert.ok(bucket.endAt <= window.endAt)
      }
    }
  })
}

test('token details fixtures exercise unavailable, recorded zero, and multiple ranked dimensions', () => {
  const { tokens } = usageHistoryFixture('usage:overview', [], {}, 'usage-history-token-details')
  for (const window of [tokens.last24h, tokens.last7d, tokens.last30d]) {
    assert.ok(window.trend.some((bucket) => bucket.tokens === null))
    assert.ok(window.trend.some((bucket) => bucket.tokens?.total === 0))
    const populated = window.trend.find((bucket) => bucket.tokens?.total > 0)
    assert.ok(populated.byModel.length > 1)
    assert.ok(populated.byProject.length > 8)
  }
})

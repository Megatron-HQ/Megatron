import assert from 'node:assert/strict'
import test from 'node:test'
import { getWindowSizes } from './window-sizes.mjs'

test('retries a garbage-collected Electron evaluation before reading window sizes', async () => {
  let evaluations = 0
  const app = {
    evaluate: async () => {
      evaluations += 1
      if (evaluations === 1) {
        throw new Error('Resulting promise was garbage collected.')
      }
      return evaluations === 2 ? [860, 500] : { width: 1200, height: 720 }
    }
  }

  const sizes = await getWindowSizes(app)

  assert.deepEqual(sizes, [
    { label: 'default', width: 1200, height: 720 },
    { label: 'min', width: 860, height: 500 }
  ])
})

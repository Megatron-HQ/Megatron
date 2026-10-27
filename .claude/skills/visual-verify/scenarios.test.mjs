import assert from 'node:assert/strict'
import test from 'node:test'
import { scenarios } from './scenarios.mjs'

const DISABLED_SCENARIO_NAMES = [
  'table-disabled-icon-tooltip',
  'skill-detail-disabled',
  'context-budget-dialog-view-disabled'
]

function scenarioByName(name) {
  return scenarios.find((scenario) => scenario.name === name)
}

function windowWithDisabledSkillCount(count) {
  return {
    locator: () => ({ count: async () => count })
  }
}

test('every scenario has a non-empty screen tag', () => {
  for (const { name, screen } of scenarios) {
    const tags = [].concat(screen)
    assert.ok(
      tags.length > 0 && tags.every((s) => typeof s === 'string' && s.length > 0),
      `${name}: screen must be a non-empty string or non-empty string[] (got ${JSON.stringify(screen)})`
    )
  }
})

test('skips disabled-skill scenarios only when no disabled skill is available', async () => {
  for (const name of DISABLED_SCENARIO_NAMES) {
    const scenario = scenarioByName(name)
    const skipWhenMissing = await scenario?.shouldSkip?.(windowWithDisabledSkillCount(0))
    const skipWhenPresent = await scenario?.shouldSkip?.(windowWithDisabledSkillCount(1))

    assert.equal(skipWhenMissing, 'no disabled skills found locally', name)
    assert.equal(skipWhenPresent, null, name)
  }
})

test('plugin scenarios pass fixture arguments through ElectronApplication.evaluate correctly', async () => {
  const locator = { click: async () => {}, waitFor: async () => {}, first: () => locator }
  const window = { getByRole: () => locator, locator: () => locator }
  const previous = globalThis.megatronVisualFixtures
  try {
    for (const [name, expected] of [
      ['plugin-update-marketplace', [['plugins:update', 'update-phase-marketplace']]],
      ['plugin-update-verify', [['plugins:update', 'update-phase-verify']]],
      [
        'plugin-disable-pending-after-navigation',
        [
          ['plugins:detail', 'plugin-enabled'],
          ['plugins:disable', 'pending']
        ]
      ],
      [
        'plugin-enable-pending-after-navigation',
        [
          ['plugins:detail', 'plugin-disabled'],
          ['plugins:enable', 'pending']
        ]
      ]
    ]) {
      const calls = []
      globalThis.megatronVisualFixtures = { set: (channel, mode) => calls.push([channel, mode]) }
      const app = {
        evaluate: async (callback, argument) => callback({ app: {}, ipcMain: {} }, argument)
      }
      await scenarioByName(name).run(window, app)
      assert.deepEqual(calls, expected, name)
    }
  } finally {
    if (previous === undefined) delete globalThis.megatronVisualFixtures
    else globalThis.megatronVisualFixtures = previous
  }
})

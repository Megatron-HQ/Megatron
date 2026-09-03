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

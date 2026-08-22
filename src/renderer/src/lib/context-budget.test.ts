import { describe, expect, it } from 'vitest'
import type { SkillRow } from '../../../shared/ipc'
import { heaviestBudgetSkills } from './context-budget'

function makeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 1,
    name: 'test-skill',
    source_type: 'global',
    source_path: '/home/.claude/skills/test-skill',
    plugin_name: null,
    description: 'A test skill',
    last_scanned_at: new Date().toISOString(),
    est_listing_tokens: 100,
    est_body_tokens: 200,
    project_root: null,
    metadata_json: null,
    modified_at: null,
    is_synced: 0,
    hook_events: null,
    disabled_reason: null,
    total_invocations: 0,
    last_invoked_at: null,
    shadowed_by_skill_id: null,
    lint_status: 'clean',
    error_count: 0,
    warning_count: 0,
    ...overrides
  }
}

describe('heaviestBudgetSkills', () => {
  it('excludes project skills', () => {
    const skills = [
      makeSkill({ id: 1, name: 'global-skill', source_type: 'global', est_listing_tokens: 50 }),
      makeSkill({
        id: 2,
        name: 'project-skill',
        source_type: 'project',
        est_listing_tokens: 999
      })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([1])
  })

  it('ranks unused skills before used ones regardless of size', () => {
    const skills = [
      makeSkill({ id: 1, name: 'big-but-used', est_listing_tokens: 500, total_invocations: 12 }),
      makeSkill({ id: 2, name: 'small-and-unused', est_listing_tokens: 10, total_invocations: 0 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2, 1])
  })

  it('sorts by est_listing_tokens descending within the unused group', () => {
    const skills = [
      makeSkill({ id: 1, name: 'a', est_listing_tokens: 10 }),
      makeSkill({ id: 2, name: 'b', est_listing_tokens: 30 }),
      makeSkill({ id: 3, name: 'c', source_type: 'plugin', est_listing_tokens: 20 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2, 3, 1])
  })

  it('sorts by est_listing_tokens descending within the used group', () => {
    const skills = [
      makeSkill({ id: 1, name: 'a', est_listing_tokens: 10, total_invocations: 1 }),
      makeSkill({ id: 2, name: 'b', est_listing_tokens: 30, total_invocations: 5 }),
      makeSkill({ id: 3, name: 'c', est_listing_tokens: 20, total_invocations: 2 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2, 3, 1])
  })

  it('breaks ties by name ascending within the same usage group', () => {
    const skills = [
      makeSkill({ id: 1, name: 'zebra', est_listing_tokens: 50 }),
      makeSkill({ id: 2, name: 'apple', est_listing_tokens: 50 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2, 1])
  })

  it('respects a custom limit and defaults to 5', () => {
    const skills = Array.from({ length: 8 }, (_, i) =>
      makeSkill({ id: i, name: `skill-${i}`, est_listing_tokens: i })
    )
    expect(heaviestBudgetSkills(skills)).toHaveLength(5)
    expect(heaviestBudgetSkills(skills, 2)).toHaveLength(2)
  })

  it('returns an empty array for no skills', () => {
    expect(heaviestBudgetSkills([])).toEqual([])
  })

  it('excludes an unused skill whose plugin runs via hooks, even when heaviest', () => {
    const skills = [
      makeSkill({
        id: 1,
        name: 'ponytail:ponytail',
        source_type: 'plugin',
        est_listing_tokens: 999,
        hook_events: JSON.stringify(['SessionStart', 'UserPromptSubmit'])
      }),
      makeSkill({ id: 2, name: 'small-and-unused', est_listing_tokens: 10 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2])
  })

  it('excludes an unused disabled skill, even when heaviest — it costs 0 tokens already', () => {
    const skills = [
      makeSkill({
        id: 1,
        name: 'disabled-skill',
        est_listing_tokens: 999,
        disabled_reason: 'plugin'
      }),
      makeSkill({ id: 2, name: 'small-and-unused', est_listing_tokens: 10 })
    ]
    expect(heaviestBudgetSkills(skills).map((s) => s.id)).toEqual([2])
  })
})

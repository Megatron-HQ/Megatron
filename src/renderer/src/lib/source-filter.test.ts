import { describe, expect, it } from 'vitest'
import type { SkillRow } from '../../../shared/ipc'
import {
  getFilterHeaderTitle,
  isFilterEqual,
  matchesFilter,
  shouldShowSourceColumn,
  type SourceFilter
} from './source-filter'

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
    total_invocations: 0,
    last_invoked_at: null,
    shadowed_by_skill_id: null,
    lint_status: 'clean',
    error_count: 0,
    warning_count: 0,
    ...overrides
  }
}

describe('source-filter helpers', () => {
  describe('isFilterEqual', () => {
    it('compares identical filters correctly', () => {
      expect(isFilterEqual({ kind: 'all' }, { kind: 'all' })).toBe(true)
      expect(isFilterEqual({ kind: 'global' }, { kind: 'global' })).toBe(true)
      expect(isFilterEqual({ kind: 'all' }, { kind: 'global' })).toBe(false)
      expect(
        isFilterEqual(
          { kind: 'project', projectRoot: '/repo-a' },
          { kind: 'project', projectRoot: '/repo-a' }
        )
      ).toBe(true)
      expect(
        isFilterEqual(
          { kind: 'project', projectRoot: '/repo-a' },
          { kind: 'project', projectRoot: '/repo-b' }
        )
      ).toBe(false)
      expect(
        isFilterEqual(
          { kind: 'plugin', pluginName: 'alpha@market' },
          { kind: 'plugin', pluginName: 'alpha@market' }
        )
      ).toBe(true)
      expect(
        isFilterEqual(
          { kind: 'plugin', pluginName: 'alpha@market' },
          { kind: 'plugin', pluginName: 'beta@market' }
        )
      ).toBe(false)
    })
  })

  describe('matchesFilter', () => {
    const globalSkill = makeSkill({ id: 1, source_type: 'global' })
    const projectSkillA = makeSkill({
      id: 2,
      source_type: 'project',
      project_root: '/repos/alpha',
      source_path: '/repos/alpha/.claude/skills/skill-a'
    })
    const projectSkillB = makeSkill({
      id: 3,
      source_type: 'project',
      project_root: 'C:\\repos\\beta',
      source_path: 'C:\\repos\\beta\\.claude\\skills\\skill-b'
    })
    const pluginSkill = makeSkill({
      id: 4,
      source_type: 'plugin',
      plugin_name: 'designer@official',
      source_path: '/home/.claude/plugins/cache/designer/skills/designer'
    })

    it('matches all skills when filter kind is all', () => {
      const filter: SourceFilter = { kind: 'all' }
      expect(matchesFilter(globalSkill, filter)).toBe(true)
      expect(matchesFilter(projectSkillA, filter)).toBe(true)
      expect(matchesFilter(projectSkillB, filter)).toBe(true)
      expect(matchesFilter(pluginSkill, filter)).toBe(true)
    })

    it('matches global skills when filter kind is global', () => {
      const filter: SourceFilter = { kind: 'global' }
      expect(matchesFilter(globalSkill, filter)).toBe(true)
      expect(matchesFilter(projectSkillA, filter)).toBe(false)
      expect(matchesFilter(pluginSkill, filter)).toBe(false)
    })

    it('matches all project skills when no projectRoot is specified', () => {
      const filter: SourceFilter = { kind: 'project' }
      expect(matchesFilter(globalSkill, filter)).toBe(false)
      expect(matchesFilter(projectSkillA, filter)).toBe(true)
      expect(matchesFilter(projectSkillB, filter)).toBe(true)
      expect(matchesFilter(pluginSkill, filter)).toBe(false)
    })

    it('matches specific project skills by projectRoot with path normalization', () => {
      const filterA: SourceFilter = { kind: 'project', projectRoot: '/repos/alpha' }
      expect(matchesFilter(projectSkillA, filterA)).toBe(true)
      expect(matchesFilter(projectSkillB, filterA)).toBe(false)

      const filterB: SourceFilter = { kind: 'project', projectRoot: 'c:/repos/beta/' }
      expect(matchesFilter(projectSkillB, filterB)).toBe(true)
      expect(matchesFilter(projectSkillA, filterB)).toBe(false)
    })

    it('matches all plugin skills when no pluginName is specified', () => {
      const filter: SourceFilter = { kind: 'plugin' }
      expect(matchesFilter(globalSkill, filter)).toBe(false)
      expect(matchesFilter(pluginSkill, filter)).toBe(true)
    })

    it('matches specific plugin skills by bare or full pluginName', () => {
      const filterExact: SourceFilter = { kind: 'plugin', pluginName: 'designer@official' }
      expect(matchesFilter(pluginSkill, filterExact)).toBe(true)

      const filterBare: SourceFilter = { kind: 'plugin', pluginName: 'designer' }
      expect(matchesFilter(pluginSkill, filterBare)).toBe(true)

      const filterOther: SourceFilter = { kind: 'plugin', pluginName: 'other-plugin' }
      expect(matchesFilter(pluginSkill, filterOther)).toBe(false)
    })
  })

  describe('getFilterHeaderTitle', () => {
    it('returns appropriate titles for all filters', () => {
      expect(getFilterHeaderTitle({ kind: 'all' })).toBe('All Skills')
      expect(getFilterHeaderTitle({ kind: 'global' })).toBe('Global Skills')
      expect(getFilterHeaderTitle({ kind: 'project' })).toBe('Project Skills')
      expect(getFilterHeaderTitle({ kind: 'project', projectRoot: '/Users/dev/Megatron' })).toBe(
        'Project / Megatron Skills'
      )
      expect(getFilterHeaderTitle({ kind: 'plugin' })).toBe('Plugin Skills')
      expect(getFilterHeaderTitle({ kind: 'plugin', pluginName: 'frontend-design@npm' })).toBe(
        'Plugin / frontend-design Skills'
      )
    })
  })

  describe('shouldShowSourceColumn', () => {
    it('shows the Source column only where rows can span multiple source values', () => {
      expect(shouldShowSourceColumn({ kind: 'all' })).toBe(true)
      expect(shouldShowSourceColumn({ kind: 'global' })).toBe(false)
      expect(shouldShowSourceColumn({ kind: 'project' })).toBe(true)
      expect(shouldShowSourceColumn({ kind: 'project', projectRoot: '/Users/dev/Megatron' })).toBe(
        false
      )
      expect(shouldShowSourceColumn({ kind: 'plugin' })).toBe(true)
      expect(shouldShowSourceColumn({ kind: 'plugin', pluginName: 'frontend-design@npm' })).toBe(
        false
      )
    })
  })
})

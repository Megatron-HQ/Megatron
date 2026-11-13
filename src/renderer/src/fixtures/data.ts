// Synthetic data for fixtures. Nothing here reads ~/.claude, so every machine renders the same
// thing. Times are relative to Date.now(), which the runner freezes.
import type {
  AllowedPathRow,
  ContextBudget,
  InventorySkillRow,
  OpenSkillMetaResult,
  ProjectFolder,
  ScanSummary,
  SkillsListResult
} from '../../../shared/ipc'

const DAY_MS = 86_400_000

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

const HOME = '/Users/fixture'

function skill(
  id: number,
  name: string,
  overrides: Partial<InventorySkillRow> = {}
): InventorySkillRow {
  return {
    id,
    name,
    source_type: 'global',
    source_path: `${HOME}/.claude/skills/${name}`,
    plugin_name: null,
    description: `Use when working on ${name.replaceAll('-', ' ')} and the request needs its full procedure.`,
    last_scanned_at: daysAgo(0),
    est_listing_tokens: 40 + id * 7,
    est_body_tokens: 900 + id * 113,
    project_root: null,
    metadata_json: null,
    modified_at: daysAgo(20 + id),
    is_synced: 0,
    hook_events: null,
    disabled_reason: null,
    model_invocable: 1,
    total_invocations: 0,
    last_invoked_at: null,
    shadowed_by_skill_id: null,
    lint_status: 'clean',
    error_count: 0,
    warning_count: 0,
    stale: false,
    ...overrides
  }
}

function pluginSkill(
  id: number,
  plugin: string,
  name: string,
  overrides: Partial<InventorySkillRow> = {}
): InventorySkillRow {
  const bare = plugin.slice(0, plugin.lastIndexOf('@'))
  return skill(id, `${bare}:${name}`, {
    source_type: 'plugin',
    source_path: `${HOME}/.claude/plugins/cache/${bare}/1.2.0/skills/${name}`,
    plugin_name: plugin,
    modified_at: null,
    ...overrides
  })
}

const used = (total: number, lastDays: number): Partial<InventorySkillRow> => ({
  total_invocations: total,
  last_invoked_at: daysAgo(lastDays)
})

// One row for each marker the Name column can show, then enough plain rows that the table scrolls
// at the minimum window size.
export const baseSkills: InventorySkillRow[] = [
  skill(1, 'code-review', {
    ...used(128, 1),
    description:
      'Use when reviewing a diff for correctness bugs before merging, including a description long enough that the Description column has to truncate it at every supported window size.'
  }),
  skill(2, 'release-notes', {
    ...used(14, 6),
    is_synced: 1,
    source_path: `${HOME}/.claude/skills/synced/release-notes`,
    lint_status: 'warning',
    warning_count: 1
  }),
  skill(3, 'legacy-lint', { ...used(2, 80), disabled_reason: 'override' }),
  skill(4, 'scratchpad', { ...used(9, 3), model_invocable: 0 }),
  skill(5, 'old-habit', { ...used(3, 45), stale: true }),
  skill(6, 'broken-frontmatter', { description: null, lint_status: 'error', error_count: 2 }),
  pluginSkill(7, 'ops-kit@fixture-market', 'deploy-check', {
    ...used(31, 2),
    hook_events: JSON.stringify(['SessionStart', 'PreToolUse'])
  }),
  pluginSkill(8, 'ops-kit@fixture-market', 'incident-notes', used(4, 12)),
  pluginSkill(9, 'ops-kit@fixture-market', 'rollback'),
  pluginSkill(10, 'docs-kit@fixture-market', 'api-reference', { disabled_reason: 'plugin' }),
  pluginSkill(11, 'docs-kit@fixture-market', 'tutorial', { disabled_reason: 'plugin' }),
  pluginSkill(12, 'review-kit@other-market', 'security-pass', used(57, 1)),
  skill(13, 'commit-helper', used(211, 0)),
  skill(14, 'design-review', used(18, 4)),
  skill(15, 'test-driven-development', used(76, 1)),
  skill(16, 'changelog', { ...used(5, 9), lint_status: 'warning', warning_count: 2 })
]

// Mirrors the rules in getContextBudget() (src/main/db/queries.ts): only global and plugin skills
// count, a disabled skill is excluded, and a user-invocable-only skill is excluded separately.
function contextBudget(skills: InventorySkillRow[]): ContextBudget {
  const budget: ContextBudget = {
    used: 0,
    limit: 16_000,
    excludedTokens: 0,
    excludedCount: 0,
    userInvocableOnlyTokens: 0,
    userInvocableOnlyCount: 0
  }
  for (const entry of skills) {
    if (entry.source_type === 'project') continue
    if (entry.disabled_reason !== null) {
      budget.excludedTokens += entry.est_listing_tokens
      budget.excludedCount += 1
    } else if (entry.model_invocable === 0) {
      budget.userInvocableOnlyTokens += entry.est_listing_tokens
      budget.userInvocableOnlyCount += 1
    } else {
      budget.used += entry.est_listing_tokens
    }
  }
  return budget
}

export function completeScan(): ScanSummary {
  return { outcome: 'complete', completedAt: daysAgo(0), sources: [] }
}

export function skillsResult(
  skills: InventorySkillRow[] = baseSkills,
  overrides: Partial<SkillsListResult> = {}
): SkillsListResult {
  return {
    skills,
    scanComplete: true,
    scanSummary: completeScan(),
    scanActivity: null,
    contextBudget: contextBudget(skills),
    ...overrides
  }
}

// The least a skill detail page needs to render. Grows when the skill detail fixtures land.
export function skillMeta(id: number): OpenSkillMetaResult | null {
  const found = baseSkills.find((entry) => entry.id === id)
  if (!found) return null
  return {
    skill: found,
    usage: { byTriggerType: [], byProject: [], recentTriggers: [] },
    skillMdContent: `# ${found.name}\n\n${found.description ?? ''}\n`,
    findings: []
  }
}

// A granted parent folder holding repositories. Windows paths on purpose: project paths are
// compared case-insensitively and split on either separator, and these exercise both.
const PARENT = 'C:\\Projects\\Megatron HQ'
const FIRST = `${PARENT}\\Megatron`
const SECOND = `${PARENT}\\Megatron-site`

export type ProjectTreeMode =
  | 'available'
  // The folder was just granted: its scan is running and no project is catalogued yet.
  | 'pending'
  // The parent could not be refreshed and the first repository is gone.
  | 'unavailable'
  | 'child-unavailable'
  // Only the parent is granted, so the first repository is there by discovery alone.
  | 'live'
  | 'live-removed'
  | 'nested'

function projectSkill(id: number, name: string, repository: string): InventorySkillRow {
  return skill(id, name, {
    source_type: 'project',
    source_path: `${repository}\\.claude\\skills\\${name}`,
    project_root: repository,
    description: 'A repository-defined skill.',
    est_listing_tokens: 20,
    est_body_tokens: 80,
    modified_at: null
  })
}

export function projectTree(mode: ProjectTreeMode = 'available'): {
  folders: AllowedPathRow[]
  projects: ProjectFolder[]
  skills: SkillsListResult
} {
  const live = mode === 'live' || mode === 'live-removed'
  const removed = mode === 'live-removed'
  const projects: ProjectFolder[] = [
    {
      path: PARENT,
      kind: 'folder',
      status: mode === 'unavailable' ? 'unavailable' : 'available'
    },
    {
      path: FIRST,
      kind: 'repository',
      status:
        mode === 'unavailable'
          ? 'missing'
          : mode === 'child-unavailable'
            ? 'unavailable'
            : 'available'
    },
    { path: SECOND, kind: 'repository', status: 'available' },
    { path: `${PARENT}\\Empty-repo`, kind: 'repository', status: 'available' }
  ]
  const skills = [FIRST, SECOND].flatMap((repository, repositoryIndex) =>
    ['build', 'review', 'test'].map((name, index) =>
      projectSkill(900001 + repositoryIndex * 10 + index, name, repository)
    )
  )
  if (mode === 'nested') {
    const child = `${FIRST}\\references\\child-a`
    for (const [index, path] of [child, `${child}\\grandchild`, `${FIRST}\\child-b`].entries()) {
      projects.push({ path, kind: 'repository', status: 'available' })
      skills.push(projectSkill(900200 + index, 'deploy', path))
    }
  }
  return {
    folders: [{ path: PARENT, granted_at: '' }, ...(live ? [] : [{ path: FIRST, granted_at: '' }])],
    projects:
      mode === 'pending'
        ? []
        : removed
          ? projects.filter((project) => project.path !== FIRST)
          : projects,
    skills: skillsResult(
      [...baseSkills, ...skills.filter((entry) => !removed || entry.project_root !== FIRST)],
      {
        scanActivity:
          mode === 'pending'
            ? { id: 9001, startedAt: Date.now() - 60_000, isStartup: false, revealMs: 500 }
            : null
      }
    )
  }
}

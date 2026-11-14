// Synthetic data for fixtures. Nothing here reads ~/.claude, so every machine renders the same
// thing. Times are relative to Date.now(), which the runner freezes.
import {
  INVOCATION_PAGE_SIZE,
  type AllowedPathRow,
  type ContextBudget,
  type InventorySkillRow,
  type LintFindingRow,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type ProjectFolder,
  type ScanSummary,
  type SkillFile,
  type SkillInvocationEntry,
  type SkillsListResult,
  type SkillUsageDetail,
  type TriggerType
} from '../../../shared/ipc'

const HOUR_MS = 3_600_000
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
  skill(14, 'design-review', {
    ...used(18, 4),
    metadata_json: JSON.stringify({ version: '2.1.0', owner: 'design-systems' })
  }),
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

const PROMPTS = [
  'Review the diff on this branch before I open the PR',
  '/commit-helper',
  'Can you check whether the migration locks the table while it runs?',
  'Tighten the error handling in the scan worker and keep the tests green',
  'Why does the sidebar count disagree with the table after a rescan? Walk through the data flow from the scanner to the renderer and point at the place where the two diverge.'
]
// Claude Code's own placeholder for an attached screenshot, which the renderer relabels.
const SCREENSHOT =
  '[Image: original 2880x1800, displayed at 1440x900. Multiply coordinates by 2.00 to map to original image.]'
// Skewed on purpose, so the usage bar and the project bars have a clear leader.
const TRIGGER_CYCLE: TriggerType[] = [
  'user_invoked',
  'user_invoked',
  'autonomous',
  'user_invoked',
  'autonomous',
  'user_invoked',
  'subagent',
  'user_invoked'
]
// The folders Claude Code ran in. The invocation log and the usage project catalog share them.
export const WORKSPACES = [
  'megatron',
  'megatron-site',
  'design-system',
  'api-gateway',
  'mobile-app',
  'infra',
  'docs'
].map((name) => `${HOME}/code/${name}`)
const WORKSPACE_CYCLE = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6]

// A skill's whole invocation log, newest first as queries.ts returns it, one entry per recorded
// use. Entries 5 to 8 are one screenshot sweep two minutes apart: the full log has a run to
// group while the recent five stay plain prompts.
function invocations(entry: InventorySkillRow): SkillInvocationEntry[] {
  if (entry.last_invoked_at === null) return []
  const newest = Date.parse(entry.last_invoked_at)
  return Array.from({ length: entry.total_invocations }, (_, index) => {
    const sweep = index >= 5 && index <= 8
    const trigger = sweep ? 'user_invoked' : TRIGGER_CYCLE[index % TRIGGER_CYCLE.length]
    const at = sweep ? newest - 15 * HOUR_MS - (index - 5) * 120_000 : newest - index * 3 * HOUR_MS
    return {
      preceding_user_text: sweep ? SCREENSHOT : PROMPTS[index % PROMPTS.length],
      invoked_at: new Date(at).toISOString(),
      trigger_type: trigger,
      cwd: WORKSPACES[WORKSPACE_CYCLE[index % WORKSPACE_CYCLE.length]],
      git_branch: index % 4 === 3 ? null : 'main',
      agent_id: trigger === 'subagent' ? `agent-a${(index * 7919).toString(16)}` : null
    }
  })
}

function usage(entries: SkillInvocationEntry[]): SkillUsageDetail {
  const count = (matches: (entry: SkillInvocationEntry) => boolean): number =>
    entries.filter(matches).length
  const triggers: TriggerType[] = ['user_invoked', 'autonomous', 'subagent']
  return {
    byTriggerType: triggers
      .map((trigger_type) => ({
        trigger_type,
        count: count((e) => e.trigger_type === trigger_type)
      }))
      .filter((row) => row.count > 0),
    byProject: WORKSPACES.map((cwd) => ({ cwd, count: count((e) => e.cwd === cwd) })).filter(
      (row) => row.count > 0
    ),
    recentTriggers: entries.slice(0, 5)
  }
}

// One finding per warning or error the inventory row counts.
const FINDINGS: Record<number, [rule: string, severity: 'error' | 'warning', message: string][]> = {
  2: [['broken-file-path', 'warning', 'references/style-guide.md does not exist']],
  6: [
    ['yaml-frontmatter', 'error', 'The frontmatter block is not valid YAML'],
    ['missing-description', 'error', 'The frontmatter has no description']
  ],
  16: [
    ['broken-file-path', 'warning', 'scripts/release.sh does not exist'],
    ['missing-mcp-server', 'warning', 'The MCP server "linear" is not configured']
  ]
}

function findings(entry: InventorySkillRow): LintFindingRow[] {
  return (FINDINGS[entry.id] ?? []).map(([rule_id, severity, message], index) => ({
    id: entry.id * 10 + index,
    skill_id: entry.id,
    rule_id,
    severity,
    message,
    detail: null,
    file_path: `${entry.source_path}/SKILL.md`,
    line_number: index + 1,
    detected_at: daysAgo(0)
  }))
}

// Frontmatter fields beyond name and description, which the detail page lists under Details.
const EXTRA_FRONTMATTER: Record<number, string[]> = {
  14: ['allowed-tools: Read, Grep, Glob', 'argument-hint: "[component or screen]"']
}

function skillMd(entry: InventorySkillRow): string {
  const fields = [
    `name: ${JSON.stringify(entry.name)}`,
    ...(entry.description ? [`description: ${JSON.stringify(entry.description)}`] : []),
    ...(entry.model_invocable === 0 ? ['disable-model-invocation: true'] : []),
    ...(EXTRA_FRONTMATTER[entry.id] ?? [])
  ]
  return `---
${fields.join('\n')}
---

# ${entry.name}

${entry.description ?? ''}

## Steps

1. Read the request and collect the files it touches.
2. Work through [the checklist](references/checklist.md) in order.
3. Run \`scripts/collect.sh\` and attach its output.

\`\`\`bash
scripts/collect.sh --since main
\`\`\`
`
}

export function skillMeta(id: number): OpenSkillMetaResult | null {
  const found = baseSkills.find((entry) => entry.id === id)
  if (!found) return null
  return {
    skill: found,
    usage: usage(invocations(found)),
    skillMdContent: skillMd(found),
    findings: findings(found)
  }
}

// SKILL.md plus enough references that the expanded tree outgrows the column at the minimum
// window size, which is where its virtualized rows have to keep rendering.
export function skillFiles(id: number, extra: SkillFile[] = []): OpenSkillResult | null {
  const meta = skillMeta(id)
  if (!meta) return null
  const file = (relativePath: string, content: string | null = null): SkillFile => ({
    relativePath,
    content,
    status: content === null ? 'unreadable' : 'ok'
  })
  const references = [
    'checklist',
    'naming',
    'error-handling',
    'testing',
    'migrations',
    'performance',
    'security',
    'accessibility',
    'logging',
    'dependencies',
    'release',
    'rollback'
  ].map((topic) => file(`references/${topic}.md`, `# ${topic}\n\nWhat to check for ${topic}.\n`))
  return {
    skill: meta.skill,
    usage: meta.usage,
    findings: meta.findings,
    files: [
      file('SKILL.md', meta.skillMdContent),
      ...references,
      file(
        'scripts/collect.sh',
        '#!/usr/bin/env bash\nset -euo pipefail\ngit diff --stat "${2:-main}...HEAD"\n'
      ),
      file('assets/flow.png'),
      ...extra
    ]
  }
}

// One page of openSkillHistory.
export function skillHistory(id: number, offset = 0): SkillInvocationEntry[] {
  const found = baseSkills.find((entry) => entry.id === id)
  return found ? invocations(found).slice(offset, offset + INVOCATION_PAGE_SIZE) : []
}

// A granted parent folder holding repositories. Windows paths on purpose: project paths are
// compared case-insensitively and split on either separator, and these exercise both.
const PARENT = 'C:\\Projects\\Megatron HQ'
const FIRST = `${PARENT}\\Megatron`
const SECOND = `${PARENT}\\Megatron-site`
const EMPTY = `${PARENT}\\Empty-repo`

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
  // The three repositories are granted one by one and the parent is not, so the sidebar groups
  // them under a row it generates for the parent.
  | 'grouped'

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
    { path: EMPTY, kind: 'repository', status: 'available' }
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
    folders:
      mode === 'grouped'
        ? [FIRST, SECOND, EMPTY].map((path) => ({ path, granted_at: '' }))
        : [{ path: PARENT, granted_at: '' }, ...(live ? [] : [{ path: FIRST, granted_at: '' }])],
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

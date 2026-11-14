// Synthetic plugin data. The user-scope plugins own the plugin skills in data.ts at the same
// install paths, so the skill counts the app derives from those rows come out right. The project
// and local installs sit in the repositories of data.ts's project tree, one tree mode per state.
// Later screens add exports beside these rather than changing them, so earlier shots hold.
import type { Api } from '../../../shared/api'
import type {
  AllowedPathRow,
  PluginComponent,
  PluginComponentKind,
  PluginDetailResult,
  PluginInstall,
  PluginRow,
  PluginScope,
  ProjectFolder,
  SkillsListResult
} from '../../../shared/ipc'
import {
  baseSkills,
  daysAgo,
  FIRST,
  PARENT,
  projectTree,
  SECOND,
  type ProjectTreeMode
} from './data'

const CACHE = '/Users/fixture/.claude/plugins/cache'

function install(
  plugin: string,
  scope: PluginScope,
  projectPath: string | null,
  version: string,
  overrides: Partial<PluginInstall> = {}
): PluginInstall {
  return {
    scope,
    project_path: projectPath,
    // Claude Code caches one copy per version, so installs at one version share a path.
    install_path: `${CACHE}/${plugin}/${version}`,
    installed_at: daysAgo(40),
    last_updated: daysAgo(12),
    git_commit_sha: null,
    installed_version: version,
    disabled_reason: null,
    available_version: '2.0.0',
    // A project or local install with no recorded project has no settings file to read.
    enablement_known: scope === 'user' || projectPath !== null,
    project_missing: false,
    ...overrides
  }
}

// The identity-level rollups the main process derives from the installs.
function plugin(name: string, marketplace: string, installs: PluginInstall[]): PluginRow {
  const versions = installs
    .map((entry) => entry.installed_version)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return {
    name,
    marketplace,
    marketplace_repo: null,
    installed_version: versions.at(-1) ?? 'unknown',
    available_version: installs.find((entry) => entry.available_version)?.available_version ?? null,
    disabled_reason: installs.every((entry) => entry.disabled_reason !== null) ? 'plugin' : null,
    skill_count: baseSkills.filter((skill) => skill.plugin_name === `${name}@${marketplace}`)
      .length,
    installs
  }
}

// One plugin per header badge: up to date, disabled, behind its marketplace, and an official one
// pinned to a commit whose marketplace version could not be read.
export const basePlugins: PluginRow[] = [
  plugin('ops-kit', 'fixture-market', [
    install('ops-kit', 'user', null, '1.2.0', { available_version: '1.2.0' })
  ]),
  plugin('docs-kit', 'fixture-market', [
    install('docs-kit', 'user', null, '1.2.0', {
      available_version: '1.2.0',
      disabled_reason: 'plugin'
    })
  ]),
  plugin('review-kit', 'other-market', [
    install('review-kit', 'user', null, '1.2.0', { available_version: '1.4.0' })
  ]),
  plugin('formatter', 'claude-plugins-official', [
    install('formatter', 'user', null, '4f9c2d1e8a7b6c5d', { available_version: null })
  ])
]

export type PluginTreeMode =
  | ProjectTreeMode
  // The granted parent is itself a repository with a plugin of its own.
  | 'own'
  // Two repositories share the name Megatron, so their labels need their parent folders.
  | 'duplicates'

function relocate(path: string, from: string, to: string): string {
  return path === from || path.startsWith(`${from}\\`) ? to + path.slice(from.length) : path
}

// Mirrors the old harness's project-tree plugins: three plugins installed for both repositories,
// older in the first, with a local install beside one of them, and a local record that names no
// project.
export function pluginTree(mode: PluginTreeMode = 'available'): {
  folders: AllowedPathRow[]
  projects: ProjectFolder[]
  skills: SkillsListResult
  plugins: PluginRow[]
} {
  const tree = projectTree(mode === 'own' || mode === 'duplicates' ? 'available' : mode)
  let { folders, projects, skills } = tree
  let first = FIRST
  let second = SECOND
  if (mode === 'duplicates') {
    first = `${PARENT}\\apps\\Megatron`
    second = `${PARENT}\\clients\\Megatron`
    const move = (path: string): string => relocate(relocate(path, FIRST, first), SECOND, second)
    folders = folders.map((folder) => ({ ...folder, path: move(folder.path) }))
    projects = projects.map((project) => ({ ...project, path: move(project.path) }))
    skills = {
      ...skills,
      skills: skills.skills.map((skill) =>
        skill.project_root === null
          ? skill
          : {
              ...skill,
              project_root: move(skill.project_root),
              source_path: move(skill.source_path)
            }
      )
    }
  }
  if (mode === 'own') {
    projects = projects.map((project) =>
      project.path === PARENT ? { ...project, kind: 'repository' } : project
    )
  }

  const missing = mode === 'unavailable'
  const atFirst = { project_missing: missing, enablement_known: !missing }
  const plugins = ['build-tools', 'review-tools', 'test-tools'].map((name, index) =>
    plugin(name, 'fixture-market', [
      install(name, 'project', first, '1.0.0', atFirst),
      install(name, 'project', second, '2.0.0'),
      ...(index === 0 ? [install(name, 'local', first, '2.0.0', atFirst)] : [])
    ])
  )
  plugins.push(
    plugin('unassigned-tool', 'fixture-market', [
      install('unassigned-tool', 'local', null, '2.0.0')
    ])
  )
  if (mode === 'own') {
    plugins.push(
      plugin('folder-tool', 'fixture-market', [install('folder-tool', 'local', PARENT, '2.0.0')])
    )
  }
  if (mode === 'nested') {
    const nested = projects.filter((project) => project.path.startsWith(`${FIRST}\\`))
    plugins.push(
      plugin(
        'nested-tools',
        'fixture-market',
        nested.map((project) => install('nested-tools', 'project', project.path, '2.0.0'))
      )
    )
  }
  const all = [...basePlugins, ...plugins]
  return {
    folders,
    projects,
    skills,
    plugins:
      mode === 'live-removed'
        ? all
            .map((entry) =>
              plugin(
                entry.name,
                entry.marketplace,
                entry.installs.filter((row) => row.project_path !== FIRST)
              )
            )
            .filter((entry) => entry.installs.length > 0)
        : all
  }
}

function component(
  plugin: string,
  kind: PluginComponentKind,
  name: string,
  detail: string | null = null
): PluginComponent {
  return {
    install_path: `${CACHE}/${plugin}/1.2.0`,
    kind,
    name,
    detail,
    source_path: `${CACHE}/${plugin}/1.2.0/${kind}s/${name}`
  }
}

// One of each kind, and more commands than the list previews, so "Show all" is on the page.
const COMPONENTS: PluginComponent[] = [
  component(
    'ops-kit',
    'agent',
    'incident-commander',
    'Use when an incident is open and needs one owner.'
  ),
  component('ops-kit', 'agent', 'release-captain', 'Use when a release train is about to leave.'),
  ...[
    ['canary', 'Ship to one region and watch its error rate'],
    ['deploy', 'Deploy the current branch to staging'],
    ['freeze', 'Freeze deploys until the freeze is lifted'],
    ['logs', 'Tail the service logs for the last deploy'],
    ['oncall', 'Show who is on call this week'],
    ['rollback', 'Roll production back to the previous release'],
    ['status', 'Summarize the health of every environment']
  ].map(([name, detail]) => component('ops-kit', 'command', name, detail)),
  component('ops-kit', 'hook', 'PreToolUse'),
  component('ops-kit', 'hook', 'SessionStart'),
  component('ops-kit', 'lsp', 'yaml-language-server', '.yaml, .yml'),
  component('ops-kit', 'mcp', 'ops-api', 'http · ops.fixture.dev'),
  component('ops-kit', 'mcp', 'pager', 'stdio · pager-mcp')
]

// Mirrors getPluginDetail (src/main/db/queries.ts): null for an unknown plugin.
export function pluginDetail(
  plugins: PluginRow[],
  name: string,
  marketplace: string
): PluginDetailResult | null {
  const found = plugins.find((entry) => entry.name === name && entry.marketplace === marketplace)
  if (!found) return null
  const skills = baseSkills.filter((skill) => skill.plugin_name === `${name}@${marketplace}`)
  const paths = new Set(found.installs.map((entry) => entry.install_path))
  return {
    plugin: found,
    skills,
    components: COMPONENTS.filter((entry) => paths.has(entry.install_path)),
    totalInvocations: skills.reduce((sum, skill) => sum + skill.total_invocations, 0),
    errorCount: skills.reduce((sum, skill) => sum + skill.error_count, 0),
    warningCount: skills.reduce((sum, skill) => sum + skill.warning_count, 0)
  }
}

// The reads App makes, answered from one tree mode.
export function pluginReads(mode: PluginTreeMode = 'available'): Partial<Api> {
  const tree = pluginTree(mode)
  return {
    listAllowedPaths: async () => tree.folders,
    listProjects: async () => tree.projects,
    listSkills: async () => tree.skills,
    listPlugins: async () => tree.plugins,
    getPluginDetail: async (name, marketplace) => pluginDetail(tree.plugins, name, marketplace)
  }
}

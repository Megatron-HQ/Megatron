const PARENT = 'C:\\Projects\\Megatron HQ'
const FIRST = `${PARENT}\\Megatron`
const SECOND = `${PARENT}\\Megatron-site`

function fixtureInstall(scope, project, version = '1.0.0', missing = false) {
  return {
    scope,
    project_path: project,
    install_path: `C:\\Cache\\demo\\${version}`,
    installed_version: version,
    available_version: '2.0.0',
    disabled_reason: null,
    enablement_known: !missing && (project !== null || scope === 'user'),
    project_missing: missing,
    installed_at: null,
    last_updated: null,
    git_commit_sha: null
  }
}

function fixturePlugin(name, installs) {
  return {
    name,
    marketplace: 'fixture-market',
    marketplace_repo: null,
    installed_version: installs[0].installed_version,
    available_version: '2.0.0',
    disabled_reason: null,
    skill_count: 0,
    installs
  }
}

function fixtureSkill(name, repository, id) {
  return {
    id,
    name,
    source_type: 'project',
    source_path: `${repository}\\.claude\\skills\\${name}`,
    project_root: repository,
    description: 'A repository-defined skill.',
    plugin_name: null,
    last_scanned_at: '2026-10-15T12:00:00.000Z',
    est_listing_tokens: 20,
    est_body_tokens: 80,
    metadata_json: null,
    modified_at: null,
    is_synced: 0,
    hook_events: null,
    disabled_reason: null,
    model_invocable: 1,
    total_invocations: 0,
    last_invoked_at: null,
    shadowed_by_skill_id: null,
    lint_status: 'clean',
    error_count: 0,
    warning_count: 0
  }
}

// Folders Claude Code ran in that no grant covers, for Settings' Not readable yet: more than its
// five-row preview, so Show all has something to open.
const UNGRANTED_ELSEWHERE = [
  'C:\\Clients\\Atlas',
  'C:\\Clients\\Borealis',
  'C:\\Clients\\Cobalt',
  'C:\\Clients\\Dune',
  'C:\\Clients\\Ember',
  'C:\\Clients\\Fjord'
]

// Hidden from Megatron (Settings › Project folders › Hidden): one Claude Code ran in, so Not
// readable yet counts one fewer, and one deleted folder only Claude Code's records still name.
const HIDDEN = ['C:\\Clients\\Fjord', 'C:\\Clients\\Staghorn']

// A local server in the ungranted repository, so the MCP Projects tree selects it with a row.
function fixtureMcpServer(projectPath) {
  return {
    id: 'configured:fixture-local',
    name: 'fixture-local',
    kind: 'configured',
    prefix: 'fixture-local',
    transports: ['stdio'],
    location: 'npx',
    scopes: ['local'],
    projectPaths: [projectPath],
    projectCount: 1,
    calls: 0,
    errors: 0,
    denied: 0,
    ambiguousCalls: 0,
    lastUsedAt: null,
    hasProblem: false,
    hasLiteralCredential: false,
    hasPendingApproval: false,
    prefixCollision: false,
    pluginDisabled: false,
    warnings: 0,
    notices: 0,
    liveStatus: null
  }
}

function ungrantedUsageProjects(granted, ungranted) {
  const locations = [granted, ungranted, ...UNGRANTED_ELSEWHERE].map((path, index) => ({
    id: `visual-ungranted:${index}`,
    path,
    kind: 'repository',
    status: path === granted ? 'available' : 'needs_access'
  }))
  return {
    locations,
    claudeCodeFolders: [],
    projects: locations.map((location) => ({
      id: location.id,
      path: location.path,
      label: location.path.split('\\').pop(),
      locations: [location],
      possibleMatches: []
    }))
  }
}

export function projectTreeFixture(channel, args, original, mode) {
  const pending = mode === 'project-tree-pending'
  const unavailable = mode === 'project-tree-unavailable'
  const childUnavailable = mode === 'project-tree-child-unavailable'
  const removed = mode === 'project-tree-live-removed'
  const live = mode.startsWith('project-tree-live')
  const own = mode === 'project-tree-own'
  const duplicate = mode === 'project-tree-duplicates'
  const nested = mode === 'project-tree-nested'
  // Three sibling grants and no parent grant: the parent becomes a generated group row.
  const grouped = mode === 'project-tree-grouped'
  // Only Megatron-site is granted: Megatron's installs are listed but can't be read or changed.
  const ungranted = mode.startsWith('project-tree-ungranted')
  // A second ungranted project, so the Plugins notice offers Review… instead of one aimed picker.
  const multi = mode === 'project-tree-ungranted-multi'
  const first = duplicate ? `${PARENT}\\apps\\Megatron` : FIRST
  const second = duplicate ? `${PARENT}\\clients\\Megatron` : SECOND
  const projects = ungranted
    ? [
        { path: first, kind: 'repository', status: 'needs_access' },
        { path: second, kind: 'repository', status: 'available' }
      ]
    : [
        {
          path: PARENT,
          kind: own ? 'repository' : 'folder',
          status: unavailable ? 'unavailable' : 'available'
        },
        {
          path: first,
          kind: 'repository',
          status: unavailable ? 'missing' : childUnavailable ? 'unavailable' : 'available'
        },
        { path: second, kind: 'repository', status: 'available' },
        { path: `${PARENT}\\Empty-repo`, kind: 'repository', status: 'available' }
      ]
  const plugins = ['build-tools', 'review-tools', 'test-tools'].map((name, index) =>
    fixturePlugin(name, [
      fixtureInstall('project', first, '1.0.0', unavailable),
      fixtureInstall('project', second, '2.0.0'),
      ...(index === 0 ? [fixtureInstall('local', first, '2.0.0', unavailable)] : [])
    ])
  )
  if (ungranted)
    for (const plugin of plugins)
      for (const install of plugin.installs)
        if (install.project_path === first) install.enablement_known = false
  if (multi) plugins[1].installs.push(fixtureInstall('project', UNGRANTED_ELSEWHERE[0]))
  if (ungranted)
    for (const plugin of plugins)
      for (const install of plugin.installs)
        if (install.project_path === UNGRANTED_ELSEWHERE[0]) install.enablement_known = false
  plugins.push(fixturePlugin('user-tool', [fixtureInstall('user', null)]))
  plugins.push(fixturePlugin('unassigned-tool', [fixtureInstall('local', null)]))
  if (own) plugins.push(fixturePlugin('folder-tool', [fixtureInstall('local', PARENT)]))
  const skills = [first, second].flatMap((repo, repoIndex) =>
    ['build', 'review', 'test'].map((name, index) =>
      fixtureSkill(name, repo, 900001 + repoIndex * 10 + index)
    )
  )
  if (own) skills.push(fixtureSkill('folder-skill', PARENT, 900100))
  if (nested) {
    const child = `${first}\\references\\child-a`
    const descendants = [child, `${child}\\grandchild`, `${first}\\child-b`]
    for (const [index, path] of descendants.entries()) {
      projects.push({ path, kind: 'repository', status: 'available' })
      skills.push(fixtureSkill('deploy', path, 900200 + index))
    }
    plugins.push(
      fixturePlugin(
        'nested-tools',
        descendants.map((path) => fixtureInstall('project', path))
      )
    )
  }
  if (channel === 'folders:list' && ungranted) return [{ path: second, granted_at: '' }]
  // A pick that changes nothing, so the notice it came from stays up to show the result.
  if (channel === 'folders:pickAndAdd' && ungranted)
    return {
      folders: [{ path: second, granted_at: '' }],
      skipped: [{ path: `${second}\\web`, coveredBy: second }]
    }
  if (channel === 'usage:projects' && ungranted) return ungrantedUsageProjects(second, first)
  if (channel === 'folders:listHidden' && ungranted) return HIDDEN
  // Stateless, like the pick above: the notice and rows stay, so the toast is what changes.
  if (channel === 'folders:hide' && ungranted) return [...HIDDEN, args[0]]
  if (channel === 'folders:list')
    return grouped
      ? [first, second, `${PARENT}\\Empty-repo`].map((path) => ({ path, granted_at: '' }))
      : [{ path: PARENT, granted_at: '' }, ...(!live ? [{ path: first, granted_at: '' }] : [])]
  if (channel === 'folders:pickAndAdd')
    return {
      folders: [{ path: PARENT, granted_at: '' }],
      skipped: [{ path: second, coveredBy: PARENT }]
    }
  const currentPlugins = removed
    ? plugins
        .map((plugin) => ({
          ...plugin,
          installs: plugin.installs.filter((install) => install.project_path !== first)
        }))
        .filter((plugin) => plugin.installs.length > 0)
    : plugins
  if (channel === 'projects:list')
    return pending ? [] : removed ? projects.filter((project) => project.path !== first) : projects
  if (channel === 'plugins:list') return currentPlugins
  if (channel === 'skills:list')
    return {
      ...original,
      skills: [
        ...original.skills.filter((skill) => skill.source_type !== 'project'),
        ...skills.filter((skill) => !(removed || ungranted) || skill.project_root !== first)
      ],
      scanComplete: true,
      scanActivity: pending
        ? { id: 9001, startedAt: Date.now() - 60_000, isStartup: false, revealMs: 500 }
        : null,
      scanSummary: { outcome: 'complete', completedAt: '2026-10-15T12:00:00.000Z', sources: [] }
    }
  // Like skills: real servers stay, but none with a real project, whose folder names would clash
  // with this fixture's and add parent prefixes to every project label.
  if (channel === 'mcp:list')
    return {
      ...original,
      servers: [
        ...original.servers.filter((server) => server.projectPaths.length === 0),
        ...(ungranted ? [fixtureMcpServer(first)] : [])
      ]
    }
  // Mirrors getPluginDetail (src/main/db/queries.ts): null for an unknown plugin, and every field
  // PluginDetail reads, or its scoping throws and blanks the renderer.
  if (channel === 'plugins:detail') {
    const plugin = currentPlugins.find((candidate) => candidate.name === args[0])
    return plugin
      ? {
          plugin,
          skills: [],
          components: [],
          totalInvocations: 0,
          errorCount: 0,
          warningCount: 0
        }
      : null
  }
  return original
}

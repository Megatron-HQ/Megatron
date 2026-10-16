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

export function projectTreeFixture(channel, args, original, mode) {
  const unavailable = mode === 'project-tree-unavailable'
  const own = mode === 'project-tree-own'
  const duplicate = mode === 'project-tree-duplicates'
  const first = duplicate ? `${PARENT}\\apps\\Megatron` : FIRST
  const second = duplicate ? `${PARENT}\\clients\\Megatron` : SECOND
  const projects = [
    {
      path: PARENT,
      kind: own ? 'repository' : 'folder',
      status: unavailable ? 'unavailable' : 'available'
    },
    { path: first, kind: 'repository', status: unavailable ? 'missing' : 'available' },
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
  plugins.push(fixturePlugin('user-tool', [fixtureInstall('user', null)]))
  plugins.push(fixturePlugin('unassigned-tool', [fixtureInstall('local', null)]))
  if (own) plugins.push(fixturePlugin('folder-tool', [fixtureInstall('local', PARENT)]))
  const skills = [first, second].flatMap((repo, repoIndex) =>
    ['build', 'review', 'test'].map((name, index) =>
      fixtureSkill(name, repo, 900001 + repoIndex * 10 + index)
    )
  )
  if (own) skills.push(fixtureSkill('folder-skill', PARENT, 900100))
  if (channel === 'folders:list')
    return [
      { path: PARENT, granted_at: '' },
      { path: first, granted_at: '' }
    ]
  if (channel === 'projects:list') return projects
  if (channel === 'plugins:list') return plugins
  if (channel === 'skills:list')
    return {
      ...original,
      skills: [...original.skills.filter((skill) => skill.source_type !== 'project'), ...skills],
      scanComplete: true,
      scanSummary: { outcome: 'complete', completedAt: '2026-10-15T12:00:00.000Z', sources: [] }
    }
  if (channel === 'plugins:detail')
    return {
      plugin: plugins.find((plugin) => plugin.name === args[0]),
      skills: [],
      totalInvocations: 0,
      errorCount: 0,
      warningCount: 0
    }
  return original
}

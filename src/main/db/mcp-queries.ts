import type Database from 'better-sqlite3'
import { CHARS_PER_TOKEN } from '../ingest/skill-parser'
import type {
  McpConfigProblem,
  McpDeclarationDetail,
  McpDeclarationScope,
  McpKeyName,
  McpLintFinding,
  McpServerDetail,
  McpServerKind,
  McpServerList,
  McpServerRow,
  McpShadow,
  McpToolUsage,
  McpTransport
} from '../../shared/ipc'
import {
  connectorDisplayName,
  pluginServerPrefix,
  resolveQualifiedName,
  sanitizeMcpServerName
} from './mcp-identity'
import { lintMcpServer } from './mcp-lint'
import { normalizeProjectPath } from '../../shared/project-path'

// One row per MCP server out of the Declarations, plugin components, /mcp switches, and tool calls
// a Scan indexed (docs/mcp-servers.md, Server identity and Precedence).

interface DeclarationRow {
  scope: 'local' | 'project' | 'user'
  project_path: string
  name: string
  transport: McpTransport | null
  problem: McpConfigProblem | null
  location: string | null
  env_keys: string
  header_keys: string
  arg_count: number
  has_literal_credential: number
  approval: 'approved' | 'rejected' | 'pending' | null
  source_path: string
}

interface PluginServerRow {
  plugin_name: string
  marketplace: string
  install_path: string
  project_path: string
  server_name: string
  detail: string | null
  source_path: string | null
  disabled_reason: string | null
}

interface CallGroupRow {
  qualified_name: string
  calls: number
  errors: number
  denied: number
  result_chars: number
  result_images: number
  last_used_at: string
}

interface ToolCalls {
  tool: string
  group: CallGroupRow
}

interface ServerIdentity {
  id: string
  name: string
  kind: McpServerKind
  prefix: string
  declarations: DeclarationRow[]
  plugins: PluginServerRow[]
  tools: ToolCalls[]
  ambiguousCalls: number
  prefixCollision: boolean
}

interface IndexSnapshot {
  identities: Map<string, ServerIdentity>
  allDeclarations: DeclarationRow[]
  disabledToggles: { project_path: string; server_name: string }[]
}

export interface DefinitionTokenBaseline {
  byPrefix: ReadonlyMap<string, number>
  measuredAt: string
}

const SCOPE_ORDER: McpDeclarationScope[] = ['local', 'project', 'user', 'plugin']
const CONNECTOR_NAME_PREFIX = 'claude.ai '
const PLUGIN_TRANSPORTS = new Set<string>(['stdio', 'http', 'sse', 'ws'])
const PLUGIN_PROBLEMS: Record<string, McpConfigProblem> = {
  'missing type': 'url_without_type',
  'unknown type': 'unknown_type'
}

function addIdentity(
  identities: Map<string, ServerIdentity>,
  id: string,
  name: string,
  kind: McpServerKind,
  prefix: string
): ServerIdentity {
  let identity = identities.get(id)
  if (identity === undefined) {
    identity = {
      id,
      name,
      kind,
      prefix,
      declarations: [],
      plugins: [],
      tools: [],
      ambiguousCalls: 0,
      prefixCollision: false
    }
    identities.set(id, identity)
  }
  return identity
}

function readPluginServers(db: Database.Database): PluginServerRow[] {
  return db
    .prepare(
      `SELECT r.name AS plugin_name, r.marketplace, r.install_path, r.project_path,
         c.name AS server_name, c.detail, c.source_path, r.disabled_reason
       FROM plugin_components c JOIN plugin_registry r ON r.install_path = c.install_path
       WHERE c.kind = 'mcp'
       ORDER BY r.name, r.marketplace, r.scope, r.project_path`
    )
    .all() as PluginServerRow[]
}

function readCallGroups(db: Database.Database): CallGroupRow[] {
  return db
    .prepare(
      `SELECT qualified_name, COUNT(*) AS calls,
         SUM(CASE WHEN is_error = 1 AND COALESCE(is_denied, 0) = 0 THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN is_denied = 1 THEN 1 ELSE 0 END) AS denied,
         SUM(COALESCE(result_chars, 0)) AS result_chars,
         SUM(COALESCE(result_images, 0)) AS result_images,
         MAX(invoked_at) AS last_used_at
       FROM mcp_tool_calls GROUP BY qualified_name`
    )
    .all() as CallGroupRow[]
}

// Calls are credited by the prefix their tool names carry. A prefix two servers share credits
// neither: the transcript alone cannot tell them apart.
function creditCalls(identities: Map<string, ServerIdentity>, groups: CallGroupRow[]): void {
  const byPrefix = new Map<string, ServerIdentity[]>()
  const indexByPrefix = (identity: ServerIdentity): void => {
    byPrefix.set(identity.prefix, [...(byPrefix.get(identity.prefix) ?? []), identity])
  }
  for (const identity of identities.values()) indexByPrefix(identity)
  const known = new Set(byPrefix.keys())

  for (const group of groups) {
    const resolved = resolveQualifiedName(group.qualified_name, known)
    if (resolved === null) continue
    let owners = byPrefix.get(resolved.prefix)
    if (owners === undefined) {
      const connectorName = connectorDisplayName(resolved.prefix)
      const observed =
        connectorName === null
          ? addIdentity(
              identities,
              `observed:${resolved.prefix}`,
              resolved.prefix,
              'observed',
              resolved.prefix
            )
          : addIdentity(
              identities,
              `connector:${resolved.prefix}`,
              connectorName,
              'connector',
              resolved.prefix
            )
      indexByPrefix(observed)
      owners = [observed]
    }
    if (owners.length === 1) owners[0].tools.push({ tool: resolved.tool, group })
    else for (const owner of owners) owner.ambiguousCalls += group.calls
  }
  for (const owners of byPrefix.values())
    if (owners.length > 1) for (const owner of owners) owner.prefixCollision = true
}

function readSnapshot(db: Database.Database): IndexSnapshot {
  const identities = new Map<string, ServerIdentity>()
  const allDeclarations = db
    .prepare('SELECT * FROM mcp_declarations ORDER BY name, scope, project_path')
    .all() as DeclarationRow[]
  for (const declaration of allDeclarations)
    addIdentity(
      identities,
      `configured:${declaration.name}`,
      declaration.name,
      'configured',
      sanitizeMcpServerName(declaration.name)
    ).declarations.push(declaration)

  for (const plugin of readPluginServers(db)) {
    const name = `plugin:${plugin.plugin_name}:${plugin.server_name}`
    addIdentity(
      identities,
      name,
      name,
      'plugin',
      pluginServerPrefix(plugin.plugin_name, plugin.server_name)
    ).plugins.push(plugin)
  }

  const toggles = db
    .prepare('SELECT project_path, server_name, toggle FROM mcp_server_toggles')
    .all() as { project_path: string; server_name: string; toggle: 'disabled' | 'enabled' }[]
  for (const { server_name: name } of toggles)
    if (name.startsWith(CONNECTOR_NAME_PREFIX)) {
      const prefix = sanitizeMcpServerName(name)
      addIdentity(identities, `connector:${prefix}`, name, 'connector', prefix)
    }

  creditCalls(identities, readCallGroups(db))
  return {
    identities,
    allDeclarations,
    disabledToggles: toggles.filter((toggle) => toggle.toggle === 'disabled')
  }
}

// A plugin's stored detail is the label plugin-components wrote: '<transport> · <where>'.
function parsePluginDetail(detail: string | null): {
  transport: McpTransport | null
  problem: McpConfigProblem | null
  location: string | null
} {
  const [kind = '', location = null] = (detail ?? '').split(' · ')
  return {
    transport: PLUGIN_TRANSPORTS.has(kind) ? (kind as McpTransport) : null,
    problem: PLUGIN_PROBLEMS[kind] ?? null,
    location
  }
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function toRow(identity: ServerIdentity, findings: McpLintFinding[]): McpServerRow {
  const plugins = identity.plugins.map((plugin) => parsePluginDetail(plugin.detail))
  const ranked = [
    ...SCOPE_ORDER.slice(0, 3).flatMap((scope) =>
      identity.declarations.filter((declaration) => declaration.scope === scope)
    ),
    ...plugins
  ]
  const groups = identity.tools.map(({ group }) => group)
  const lastUsed = groups.map((group) => group.last_used_at).sort()
  return {
    id: identity.id,
    name: identity.name,
    kind: identity.kind,
    prefix: identity.prefix,
    transports: distinct(
      ranked
        .map((entry) => entry.transport)
        .filter((value): value is McpTransport => value !== null)
    ).sort(),
    location: ranked.find((entry) => entry.location !== null)?.location ?? null,
    scopes: SCOPE_ORDER.filter((scope) =>
      scope === 'plugin'
        ? identity.plugins.length > 0
        : identity.declarations.some((declaration) => declaration.scope === scope)
    ),
    projectCount: distinct(
      identity.declarations
        .filter((declaration) => declaration.project_path !== '')
        .map((declaration) => declaration.project_path)
    ).length,
    calls: groups.reduce((total, group) => total + group.calls, 0),
    errors: groups.reduce((total, group) => total + group.errors, 0),
    denied: groups.reduce((total, group) => total + group.denied, 0),
    ambiguousCalls: identity.ambiguousCalls,
    lastUsedAt: lastUsed.at(-1) ?? null,
    hasProblem: ranked.some((entry) => entry.problem !== null),
    hasLiteralCredential: identity.declarations.some(
      (declaration) => declaration.has_literal_credential === 1
    ),
    hasPendingApproval: identity.declarations.some(
      (declaration) => declaration.approval === 'pending'
    ),
    prefixCollision: identity.prefixCollision,
    pluginDisabled:
      identity.plugins.length > 0 &&
      identity.plugins.every((plugin) => plugin.disabled_reason !== null),
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    notices: findings.filter((finding) => finding.severity === 'info').length
  }
}

function byName(first: { name: string }, second: { name: string }): number {
  return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })
}

export function listMcpServers(db: Database.Database): McpServerList {
  const snapshot = readSnapshot(db)
  const window = db
    .prepare('SELECT MIN(invoked_at) AS first, MAX(invoked_at) AS last FROM mcp_tool_calls')
    .get() as { first: string | null; last: string | null }
  const ungranted = db
    .prepare("SELECT COUNT(*) AS count FROM mcp_project_state WHERE mcp_json = 'ungranted'")
    .get() as { count: number }
  return {
    servers: [...snapshot.identities.values()]
      .map((identity) => {
        const declarations = declarationDetails(db, identity, snapshot)
        return toRow(identity, findingsFor(identity, declarations, snapshot))
      })
      .sort(byName),
    firstCallAt: window.first,
    lastCallAt: window.last,
    ungrantedProjects: ungranted.count
  }
}

// Claude Code's rule for one name in one project: local, else an approved project server, else the
// user one. A declaration it skips (a config problem) never wins.
function winnerIn(project: string, sameName: DeclarationRow[]): DeclarationRow | null {
  const loads = (declaration: DeclarationRow): boolean =>
    declaration.problem === null &&
    (declaration.scope === 'user' || declaration.project_path === project) &&
    (declaration.scope !== 'project' || declaration.approval === 'approved')
  for (const scope of ['local', 'project', 'user'] as const) {
    const winner = sameName.find((declaration) => declaration.scope === scope && loads(declaration))
    if (winner !== undefined) return winner
  }
  return null
}

function shadowBy(project: string | null, winner: DeclarationRow): McpShadow {
  return {
    projectPath: project,
    byScope: winner.scope,
    byProjectPath: winner.scope === 'user' ? null : winner.project_path
  }
}

function declarationShadows(declaration: DeclarationRow, sameName: DeclarationRow[]): McpShadow[] {
  if (declaration.problem !== null) return []
  if (declaration.scope === 'project' && declaration.approval !== 'approved') return []
  const projects =
    declaration.scope === 'user'
      ? distinct(sameName.map((other) => other.project_path).filter((path) => path !== '')).sort()
      : [declaration.project_path]
  return projects.flatMap((project) => {
    const winner = winnerIn(project, sameName)
    return winner === null || winner === declaration ? [] : [shadowBy(project, winner)]
  })
}

function keyNames(json: string): McpKeyName[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as McpKeyName[]) : []
  } catch {
    return []
  }
}

function configuredDetail(
  declaration: DeclarationRow,
  sameName: DeclarationRow[]
): McpDeclarationDetail {
  return {
    scope: declaration.scope,
    projectPath: declaration.project_path === '' ? null : declaration.project_path,
    plugin: null,
    transport: declaration.transport,
    problem: declaration.problem,
    location: declaration.location,
    env: keyNames(declaration.env_keys),
    headers: keyNames(declaration.header_keys),
    argCount: declaration.arg_count,
    hasLiteralCredential: declaration.has_literal_credential === 1,
    approval: declaration.approval,
    sourcePath: declaration.source_path,
    shadowedIn: declarationShadows(declaration, sameName)
  }
}

// A plugin server loses to the enabled Declaration whose endpoint it duplicates: a user one in every
// project (per-project overrides of that user server are not followed), a local or project one
// where it wins its name and its /mcp switch is on.
function pluginShadows(
  db: Database.Database,
  plugin: PluginServerRow,
  snapshot: IndexSnapshot
): McpShadow[] {
  const duplicates = db
    .prepare(
      `SELECT scope, project_path, name FROM mcp_endpoint_duplicates
       WHERE install_path = ? AND server_name = ?`
    )
    .all(plugin.install_path, plugin.server_name) as {
    scope: string
    project_path: string
    name: string
  }[]
  const shadows = duplicates.flatMap((duplicate): McpShadow[] => {
    const sameName = snapshot.allDeclarations.filter((row) => row.name === duplicate.name)
    const declaration = sameName.find(
      (row) => row.scope === duplicate.scope && row.project_path === duplicate.project_path
    )
    if (declaration === undefined || declaration.problem !== null) return []
    if (declaration.scope === 'user') return [shadowBy(null, declaration)]
    const project = declaration.project_path
    const switchedOff = snapshot.disabledToggles.some(
      (toggle) => toggle.project_path === project && toggle.server_name === declaration.name
    )
    return !switchedOff && winnerIn(project, sameName) === declaration
      ? [shadowBy(project, declaration)]
      : []
  })
  return shadows.sort((first, second) =>
    (first.projectPath ?? '').localeCompare(second.projectPath ?? '')
  )
}

function pluginDetail(
  db: Database.Database,
  plugin: PluginServerRow,
  snapshot: IndexSnapshot
): McpDeclarationDetail {
  return {
    scope: 'plugin',
    projectPath: plugin.project_path === '' ? null : plugin.project_path,
    plugin: { name: plugin.plugin_name, marketplace: plugin.marketplace },
    ...parsePluginDetail(plugin.detail),
    env: [],
    headers: [],
    argCount: null,
    hasLiteralCredential: false,
    approval: null,
    sourcePath: plugin.source_path,
    shadowedIn: pluginShadows(db, plugin, snapshot)
  }
}

function toolUsage(identity: ServerIdentity): McpToolUsage[] {
  const byTool = new Map<string, McpToolUsage & { chars: number }>()
  for (const { tool, group } of identity.tools) {
    const usage = byTool.get(tool) ?? {
      tool,
      calls: 0,
      errors: 0,
      denied: 0,
      resultTokens: 0,
      resultImages: 0,
      lastUsedAt: null,
      chars: 0
    }
    usage.calls += group.calls
    usage.errors += group.errors
    usage.denied += group.denied
    usage.chars += group.result_chars
    usage.resultImages += group.result_images
    if (usage.lastUsedAt === null || group.last_used_at > usage.lastUsedAt)
      usage.lastUsedAt = group.last_used_at
    byTool.set(tool, usage)
  }
  return [...byTool.values()]
    .map(({ chars, ...usage }) => ({ ...usage, resultTokens: Math.round(chars / CHARS_PER_TOKEN) }))
    .sort((first, second) => second.calls - first.calls || first.tool.localeCompare(second.tool))
}

function declarationDetails(
  db: Database.Database,
  identity: ServerIdentity,
  snapshot: IndexSnapshot
): McpDeclarationDetail[] {
  return [
    ...identity.declarations.map((declaration) =>
      configuredDetail(declaration, identity.declarations)
    ),
    ...identity.plugins.map((plugin) => pluginDetail(db, plugin, snapshot))
  ]
}

function findingsFor(
  identity: ServerIdentity,
  declarations: McpDeclarationDetail[],
  snapshot: IndexSnapshot
): McpLintFinding[] {
  const sharedWith = [...snapshot.identities.values()]
    .filter((other) => other !== identity && other.prefix === identity.prefix)
    .map((other) => other.name)
    .sort()
  return lintMcpServer({ name: identity.name, prefix: identity.prefix, declarations, sharedWith })
}

export interface KnownMcpPrefixes {
  everywhere: ReadonlySet<string>
  // Keyed by normalizeProjectPath: local and project servers load only in their own project.
  byProject: ReadonlyMap<string, ReadonlySet<string>>
}

// For the missing-mcp-server skill rule: every prefix a skill's mcp__ reference may name.
export function knownMcpPrefixes(db: Database.Database): KnownMcpPrefixes {
  const everywhere = new Set<string>()
  const byProject = new Map<string, Set<string>>()
  for (const identity of readSnapshot(db).identities.values()) {
    if (identity.kind !== 'configured') {
      everywhere.add(identity.prefix)
      continue
    }
    for (const declaration of identity.declarations) {
      if (declaration.scope === 'user') {
        everywhere.add(identity.prefix)
        continue
      }
      const key = normalizeProjectPath(declaration.project_path)
      byProject.set(key, (byProject.get(key) ?? new Set()).add(identity.prefix))
    }
  }
  return { everywhere, byProject }
}

export function getMcpServerDetail(
  db: Database.Database,
  id: string,
  baseline: DefinitionTokenBaseline | null
): McpServerDetail | null {
  const snapshot = readSnapshot(db)
  const identity = snapshot.identities.get(id)
  if (identity === undefined) return null

  const declarations = declarationDetails(db, identity, snapshot)
  const findings = findingsFor(identity, declarations, snapshot)
  const disabledIn = distinct(
    snapshot.disabledToggles
      .filter((toggle) => toggle.server_name === identity.name)
      .map((toggle) => toggle.project_path)
  ).sort()
  const connectorsDisabledIn =
    identity.kind === 'connector'
      ? (
          db
            .prepare(
              `SELECT project_path FROM mcp_project_state WHERE connectors_disabled = 1
               ORDER BY project_path`
            )
            .all() as { project_path: string }[]
        ).map((row) => row.project_path)
      : []
  const tokens = baseline?.byPrefix.get(identity.prefix)
  return {
    server: toRow(identity, findings),
    declarations,
    disabledIn,
    connectorsDisabledIn,
    tools: toolUsage(identity),
    findings,
    definitionTokens:
      baseline === null || tokens === undefined ? null : { tokens, measuredAt: baseline.measuredAt }
  }
}

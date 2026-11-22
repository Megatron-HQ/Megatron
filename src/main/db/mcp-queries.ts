import type Database from 'better-sqlite3'
import { CHARS_PER_TOKEN } from '../ingest/skill-parser'
import type {
  McpConfigProblem,
  McpConfiguredScope,
  McpDeclarationRef,
  McpProjectApprovals,
  McpDeclarationDetail,
  McpDeclarationScope,
  McpConnectionCheck,
  McpKeyName,
  McpLintFinding,
  McpLiveStatus,
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
import type { CommandLookup } from '../command-lookup'
import { knownMcpCallsSql, usageHistorySince } from './known-calls'
import { normalizeProjectPath } from '../../shared/project-path'
import { isPathAllowed } from '../permissions'

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
  command_is_bare: number | null
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
  // Recorded tool names on a prefix two servers share, credited to neither.
  ambiguousNames: Set<string>
  allDeclarations: DeclarationRow[]
  disabledToggles: { project_path: string; server_name: string }[]
  // From the general connection check, by tool prefix.
  liveByPrefix: Map<string, { status: McpLiveStatus; checkedAt: string }>
}

// This session's connection checks (docs/mcp-servers.md, Live check), never stored in the index.
export interface McpChecks {
  general: McpConnectionCheck | null
  projects: McpConnectionCheck[]
}

const NO_CHECKS: McpChecks = { general: null, projects: [] }

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
       FROM ${knownMcpCallsSql(db)} c GROUP BY qualified_name`
    )
    .all() as CallGroupRow[]
}

// Calls are credited by the prefix their tool names carry. A prefix two servers share credits
// neither: the transcript alone cannot tell them apart. Returns those uncredited tool names.
function creditCalls(identities: Map<string, ServerIdentity>, groups: CallGroupRow[]): Set<string> {
  const ambiguousNames = new Set<string>()
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
    else {
      ambiguousNames.add(group.qualified_name)
      for (const owner of owners) owner.ambiguousCalls += group.calls
    }
  }
  for (const owners of byPrefix.values())
    if (owners.length > 1) for (const owner of owners) owner.prefixCollision = true
  return ambiguousNames
}

// The general check names servers the index can't see: a connector never called, or one managed
// by an organization. Its exact names also replace a called connector's best-effort label.
function addCheckedServers(
  identities: Map<string, ServerIdentity>,
  check: McpConnectionCheck | null
): Map<string, { status: McpLiveStatus; checkedAt: string }> {
  const liveByPrefix = new Map<string, { status: McpLiveStatus; checkedAt: string }>()
  if (check === null) return liveByPrefix
  for (const { name, status } of check.servers) {
    const prefix = sanitizeMcpServerName(name)
    liveByPrefix.set(prefix, { status, checkedAt: check.checkedAt })
    const known = [...identities.values()].filter((identity) => identity.prefix === prefix)
    if (known.length > 0) {
      for (const identity of known) if (identity.kind === 'connector') identity.name = name
      continue
    }
    if (name.startsWith(CONNECTOR_NAME_PREFIX))
      addIdentity(identities, `connector:${prefix}`, name, 'connector', prefix)
    else addIdentity(identities, `observed:${prefix}`, name, 'observed', prefix)
  }
  return liveByPrefix
}

function readSnapshot(
  db: Database.Database,
  general: McpConnectionCheck | null = null
): IndexSnapshot {
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

  const liveByPrefix = addCheckedServers(identities, general)
  const ambiguousNames = creditCalls(identities, readCallGroups(db))
  return {
    liveByPrefix,
    identities,
    ambiguousNames,
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

function toRow(
  identity: ServerIdentity,
  findings: McpLintFinding[],
  snapshot: IndexSnapshot
): McpServerRow {
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
    projectPaths: distinct(
      [...identity.declarations, ...identity.plugins]
        .map((entry) => entry.project_path)
        .filter((path) => path !== '')
    ).sort(),
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
    notices: findings.filter((finding) => finding.severity === 'info').length,
    liveStatus: snapshot.liveByPrefix.get(identity.prefix) ?? null
  }
}

function byName(first: { name: string }, second: { name: string }): number {
  return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })
}

export function listMcpServers(
  db: Database.Database,
  general: McpConnectionCheck | null = null,
  // Main's PATH lookup for the not-found rule; without it the rule is silent.
  lookupCommand?: (program: string) => CommandLookup
): McpServerList {
  const snapshot = readSnapshot(db, general)
  const lastCallAt = db
    .prepare(`SELECT MAX(invoked_at) FROM ${knownMcpCallsSql(db)} c`)
    .pluck()
    .get() as string | null
  return {
    servers: [...snapshot.identities.values()]
      .map((identity) => {
        const declarations = declarationDetails(db, identity, snapshot)
        return toRow(
          identity,
          findingsFor(identity, declarations, snapshot, lookupCommand),
          snapshot
        )
      })
      .sort(byName),
    callsSince: usageHistorySince(db),
    lastCallAt,
    lastCheckedAt: general?.checkedAt ?? null
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
    shadowedIn: declarationShadows(declaration, sameName),
    commandIsBare: declaration.command_is_bare === 1
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
    shadowedIn: pluginShadows(db, plugin, snapshot),
    // A plugin's stored detail keeps only the program's basename, so whether it was given with a
    // folder is unknown: the not-found rule stays silent for plugins.
    commandIsBare: false
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

// A call this recent shows the server starts, so the not-found rule trusts it over Megatron's PATH.
const RECENT_CALL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function calledSince(identity: ServerIdentity, cutoff: string): boolean {
  return identity.tools.some((tool) => tool.group.last_used_at >= cutoff)
}

function findingsFor(
  identity: ServerIdentity,
  declarations: McpDeclarationDetail[],
  snapshot: IndexSnapshot,
  lookupCommand?: (program: string) => CommandLookup
): McpLintFinding[] {
  const sharedWith = [...snapshot.identities.values()]
    .filter((other) => other !== identity && other.prefix === identity.prefix)
    .map((other) => other.name)
    .sort()
  return lintMcpServer({
    name: identity.name,
    prefix: identity.prefix,
    declarations,
    sharedWith,
    lookupCommand,
    calledRecently: calledSince(
      identity,
      new Date(Date.now() - RECENT_CALL_WINDOW_MS).toISOString()
    )
  })
}

export type McpActionVerb = 'remove' | 'logout'

export type McpActionTarget =
  | { ok: true; name: string; scope: McpConfiguredScope; projectPath: string | null }
  | { ok: false; error: string }

const REMOTE_TRANSPORTS = new Set<McpTransport>(['http', 'sse', 'ws'])
const CONNECTORS_PAGE = 'https://claude.ai/customize/connectors'
const UNKNOWN_SERVER_MESSAGE =
  'Megatron no longer finds this server. Refresh the list and try again.'
const OBSERVED_SERVER_MESSAGE =
  "Megatron only knows this server from its tool calls, so it can't tell Claude Code which " +
  'declaration to change.'
const NOTHING_TO_LOG_OUT_MESSAGE =
  'Only remote servers (HTTP, SSE, WebSocket) sign in, so this one has nothing to log out of.'

function samePath(first: string, second: string): boolean {
  return normalizeProjectPath(first) === normalizeProjectPath(second)
}

function managedElsewhere(identity: ServerIdentity): string {
  if (identity.kind === 'plugin') {
    const plugins = distinct(identity.plugins.map((plugin) => plugin.plugin_name)).join(', ')
    return `Managed by plugin ${plugins}. Change it from the plugin.`
  }
  if (identity.kind === 'connector')
    return `Managed in claude.ai. Disconnect it at ${CONNECTORS_PAGE}.`
  return OBSERVED_SERVER_MESSAGE
}

// The one Declaration an action may change, checked against the index rather than trusted from the
// renderer: names can hold spaces and anything else, so the name comes from here.
export function mcpActionTarget(
  db: Database.Database,
  ref: McpDeclarationRef,
  verb: McpActionVerb
): McpActionTarget {
  const identity = readSnapshot(db).identities.get(ref.serverId)
  if (identity === undefined) return { ok: false, error: UNKNOWN_SERVER_MESSAGE }
  if (identity.kind !== 'configured') return { ok: false, error: managedElsewhere(identity) }
  const declaration = identity.declarations.find(
    (row) =>
      row.scope === ref.scope &&
      (ref.projectPath === null
        ? row.project_path === ''
        : row.project_path !== '' && samePath(row.project_path, ref.projectPath))
  )
  if (declaration === undefined) {
    const where = ref.projectPath === null ? '' : ' in that project'
    return {
      ok: false,
      error: `${identity.name} has no ${ref.scope} declaration${where} any more. Refresh the list and try again.`
    }
  }
  if (verb === 'logout' && !REMOTE_TRANSPORTS.has(declaration.transport as McpTransport))
    return { ok: false, error: NOTHING_TO_LOG_OUT_MESSAGE }
  return {
    ok: true,
    name: declaration.name,
    scope: declaration.scope,
    projectPath: declaration.project_path === '' ? null : declaration.project_path
  }
}

const SCOPE_NAMES: Record<McpConfiguredScope, string> = {
  user: 'User scope',
  local: "This project's local scope",
  project: "This project's .mcp.json"
}

function declaresIn(
  row: DeclarationRow,
  scope: McpConfiguredScope,
  projectPath: string | null
): boolean {
  return (
    row.scope === scope &&
    (projectPath === null
      ? row.project_path === ''
      : row.project_path !== '' && samePath(row.project_path, projectPath))
  )
}

// Why a server can't be added under this name (#50, docs/mcp-servers.md, Writes), or null. The
// same name in another scope or project is allowed: precedence decides which one loads. A tool
// prefix another server already carries is refused, since calls on a shared prefix credit neither
// (Prefix collision); a prefix only past calls carry is an Observed server the new one takes over.
export function mcpAddConflict(
  db: Database.Database,
  name: string,
  scope: McpConfiguredScope,
  projectPath: string | null
): string | null {
  const snapshot = readSnapshot(db)
  if (
    snapshot.allDeclarations.some((row) => row.name === name && declaresIn(row, scope, projectPath))
  )
    return `${SCOPE_NAMES[scope]} already declares ${name}. Remove it first, or choose another name.`
  const prefix = sanitizeMcpServerName(name)
  const other = [...snapshot.identities.values()].find(
    (identity) =>
      identity.prefix === prefix &&
      identity.kind !== 'observed' &&
      identity.id !== `configured:${name}`
  )
  return other === undefined
    ? null
    : `Its tools would be named mcp__${prefix}__…, like ${other.name}'s, so neither server's calls could be told apart. Choose another name.`
}

// The configured Declaration an add should have left, or null when Claude Code didn't save it.
export function findMcpDeclaration(
  db: Database.Database,
  name: string,
  scope: McpConfiguredScope,
  projectPath: string | null
): { serverId: string; approval: DeclarationRow['approval'] } | null {
  const row = readSnapshot(db).allDeclarations.find(
    (declaration) => declaration.name === name && declaresIn(declaration, scope, projectPath)
  )
  return row === undefined ? null : { serverId: `configured:${name}`, approval: row.approval }
}

export type McpResetTarget =
  { ok: true; projectPath: string; approvals: McpProjectApprovals } | { ok: false; error: string }

const NOTHING_TO_RESET_MESSAGE =
  "Megatron hasn't read a .mcp.json in this project, so there are no choices to reset. Grant the " +
  'folder in Manage Folders and rescan if it has one.'

// reset-project-choices clears a project's approve/reject choices for its .mcp.json servers; only
// a project whose .mcp.json the index read has any to show before and after.
export function mcpResetTarget(db: Database.Database, projectPath: string): McpResetTarget {
  const state = (
    db.prepare("SELECT project_path FROM mcp_project_state WHERE mcp_json = 'read'").all() as {
      project_path: string
    }[]
  ).find((row) => samePath(row.project_path, projectPath))
  if (state === undefined) return { ok: false, error: NOTHING_TO_RESET_MESSAGE }
  return {
    ok: true,
    projectPath: state.project_path,
    approvals: mcpProjectApprovals(db, state.project_path)
  }
}

export function mcpProjectApprovals(
  db: Database.Database,
  projectPath: string
): McpProjectApprovals {
  const approvals: McpProjectApprovals = { approved: 0, pending: 0, rejected: 0 }
  const rows = db
    .prepare("SELECT project_path, approval FROM mcp_declarations WHERE scope = 'project'")
    .all() as { project_path: string; approval: DeclarationRow['approval'] }[]
  for (const row of rows)
    if (row.approval !== null && samePath(row.project_path, projectPath))
      approvals[row.approval] += 1
  return approvals
}

export interface McpCallOwner {
  id: string
  name: string
  kind: McpServerKind
}

// Each recorded tool name's server, by the same crediting the MCP section uses, so a window of
// calls read elsewhere (Usage) credits exactly as the server list does.
export function mcpCallOwners(db: Database.Database): Map<string, McpCallOwner | 'ambiguous'> {
  const snapshot = readSnapshot(db)
  const owners = new Map<string, McpCallOwner | 'ambiguous'>()
  for (const identity of snapshot.identities.values())
    for (const { group } of identity.tools)
      owners.set(group.qualified_name, {
        id: identity.id,
        name: identity.name,
        kind: identity.kind
      })
  for (const name of snapshot.ambiguousNames) owners.set(name, 'ambiguous')
  return owners
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

// Only one of the server's own declaring files, and only one Megatron may read: the renderer names
// a path, so main never opens a folder the index didn't put there.
export function revealableMcpSource(
  db: Database.Database,
  id: string,
  path: string
): string | null {
  const identity = readSnapshot(db).identities.get(id)
  if (identity === undefined) return null
  const sources = [
    ...identity.declarations.map((declaration) => declaration.source_path),
    ...identity.plugins.map((plugin) => plugin.source_path)
  ]
  return sources.includes(path) && isPathAllowed(path) ? path : null
}

export function getMcpServerDetail(
  db: Database.Database,
  id: string,
  baseline: DefinitionTokenBaseline | null,
  checks: McpChecks = NO_CHECKS,
  lookupCommand?: (program: string) => CommandLookup
): McpServerDetail | null {
  const snapshot = readSnapshot(db, checks.general)
  const identity = snapshot.identities.get(id)
  if (identity === undefined) return null

  const declarations = declarationDetails(db, identity, snapshot)
  const findings = findingsFor(identity, declarations, snapshot, lookupCommand)
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
    server: toRow(identity, findings, snapshot),
    declarations,
    disabledIn,
    connectorsDisabledIn,
    tools: toolUsage(identity),
    findings,
    projectStatuses: checks.projects.flatMap((check) => {
      const server = check.servers.find(
        (candidate) => sanitizeMcpServerName(candidate.name) === identity.prefix
      )
      return server === undefined || check.projectPath === null
        ? []
        : [{ projectPath: check.projectPath, status: server.status, checkedAt: check.checkedAt }]
    }),
    definitionTokens:
      baseline === null || tokens === undefined ? null : { tokens, measuredAt: baseline.measuredAt }
  }
}

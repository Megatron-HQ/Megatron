import type Database from 'better-sqlite3'
import { join } from 'path'
import { claudeConfig, isPathAllowed } from '../permissions'
import type { ScanIssue, ScanTaskResult } from '../../shared/ipc'
import {
  isHiddenProject,
  isWithinProjectPath,
  normalizeProjectPath
} from '../../shared/project-path'
import { isRecord, readJson, type JsonRead } from './claude-settings'
import { mcpEndpointKey, summarizeMcpServer } from './mcp-server-config'

// Reads every MCP server Declaration outside plugins, plus the per-project state that decides
// whether Claude Code loads one (docs/mcp-servers.md, Sources). Only MCP and trust fields of
// .claude.json are read: its project entries also hold prompt text and session metrics.

type Scope = 'user' | 'local' | 'project'
type Approval = 'approved' | 'rejected' | 'pending'
type McpJsonState = 'read' | 'missing' | 'ungranted' | 'unavailable' | 'invalid'

interface Declaration {
  scope: Scope
  projectPath: string
  name: string
  config: Record<string, unknown>
  sourcePath: string
  approval: Approval | null
}

// One folder, however many spellings of it .claude.json holds ('C:/x', 'c:\x').
interface ProjectGroup {
  path: string
  entries: Record<string, unknown>[]
}

interface ApprovalLists {
  enabled: Set<string>
  disabled: Set<string>
  enableAll: boolean
}

const USER_PROJECT_PATH = ''

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function settingsValue(read: JsonRead): Record<string, unknown> {
  return read.status === 'ok' && isRecord(read.value) ? read.value : {}
}

function issueFor(read: JsonRead, path: string): ScanIssue | null {
  if (read.reason === 'scan_limit') return { code: 'scan_limit', path }
  if (read.status === 'invalid') return { code: 'settings_invalid', path }
  if (read.status === 'unavailable') return { code: 'source_unavailable', path }
  return null
}

function groupProjects(
  projects: Record<string, unknown>,
  candidates: readonly string[]
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  const add = (path: string, entry: Record<string, unknown>): void => {
    const key = normalizeProjectPath(path)
    const group = groups.get(key) ?? { path, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  for (const [path, entry] of Object.entries(projects)) add(path, isRecord(entry) ? entry : {})
  for (const path of candidates) add(path, {})
  return [...groups.values()]
}

// Claude Code trusts a folder once its trust dialog was accepted there or in a folder above it.
function isTrusted(path: string, projects: Record<string, unknown>): boolean {
  return Object.entries(projects).some(
    ([key, entry]) =>
      isRecord(entry) && entry.hasTrustDialogAccepted === true && isWithinProjectPath(path, key)
  )
}

function addApprovals(
  into: ApprovalLists,
  source: Record<string, unknown>,
  canApprove: boolean
): void {
  for (const name of stringList(source.disabledMcpjsonServers)) into.disabled.add(name)
  if (!canApprove) return
  for (const name of stringList(source.enabledMcpjsonServers)) into.enabled.add(name)
  if (source.enableAllProjectMcpServers === true) into.enableAll = true
}

// A repo's own committed settings can reject its servers but approve them only once trusted;
// settings.local.json is the user's own file.
function approvalLists(
  group: ProjectGroup,
  userSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
  localSettings: Record<string, unknown>,
  trusted: boolean
): ApprovalLists {
  const lists: ApprovalLists = { enabled: new Set(), disabled: new Set(), enableAll: false }
  for (const entry of group.entries) addApprovals(lists, entry, true)
  addApprovals(lists, userSettings, true)
  addApprovals(lists, projectSettings, trusted)
  addApprovals(lists, localSettings, true)
  return lists
}

function approvalOf(name: string, lists: ApprovalLists): Approval {
  if (lists.disabled.has(name)) return 'rejected'
  return lists.enableAll || lists.enabled.has(name) ? 'approved' : 'pending'
}

function serversIn(
  source: Record<string, unknown>,
  path: string,
  issues: Map<string, ScanIssue>
): [string, Record<string, unknown>][] {
  if (source.mcpServers === undefined) return []
  if (!isRecord(source.mcpServers)) {
    issues.set(`settings_invalid\0${path}`, { code: 'settings_invalid', path })
    return []
  }
  return Object.entries(source.mcpServers).filter(
    (entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])
  )
}

function readMcpJson(projectPath: string): { state: McpJsonState; read: JsonRead | null } {
  if (!isPathAllowed(projectPath)) return { state: 'ungranted', read: null }
  const read = readJson(join(projectPath, '.mcp.json'))
  if (read.status === 'ok' && isRecord(read.value)) return { state: 'read', read }
  if (read.status === 'ok') return { state: 'invalid', read: { status: 'invalid', value: null } }
  const state: McpJsonState =
    read.status === 'missing' ? 'missing' : read.status === 'invalid' ? 'invalid' : 'unavailable'
  return { state, read }
}

interface ProjectScan {
  declarations: Declaration[]
  state: McpJsonState
  connectorsDisabled: boolean
  toggles: [string, 'disabled' | 'enabled'][]
}

function scanProject(
  group: ProjectGroup,
  projects: Record<string, unknown>,
  userSettings: Record<string, unknown>,
  issues: Map<string, ScanIssue>,
  claudeJsonPath: string
): ProjectScan {
  const declarations: Declaration[] = []
  const seenLocal = new Set<string>()
  for (const entry of group.entries)
    for (const [name, config] of serversIn(entry, claudeJsonPath, issues)) {
      if (seenLocal.has(name)) continue
      seenLocal.add(name)
      declarations.push({
        scope: 'local',
        projectPath: group.path,
        name,
        config,
        sourcePath: claudeJsonPath,
        approval: null
      })
    }

  const projectSettings = settingsValue(readJson(join(group.path, '.claude', 'settings.json')))
  const localSettings = settingsValue(readJson(join(group.path, '.claude', 'settings.local.json')))
  const mcpJsonPath = join(group.path, '.mcp.json')
  const { state, read } = readMcpJson(group.path)
  const issue = read && state !== 'read' ? issueFor(read, mcpJsonPath) : null
  if (issue) issues.set(`${issue.code}\0${issue.path}`, issue)
  if (state === 'read' && read) {
    const lists = approvalLists(
      group,
      userSettings,
      projectSettings,
      localSettings,
      isTrusted(group.path, projects)
    )
    for (const [name, config] of serversIn(settingsValue(read), mcpJsonPath, issues))
      declarations.push({
        scope: 'project',
        projectPath: group.path,
        name,
        config,
        sourcePath: mcpJsonPath,
        approval: approvalOf(name, lists)
      })
  }

  const toggles: ProjectScan['toggles'] = []
  for (const entry of group.entries) {
    for (const name of stringList(entry.disabledMcpServers)) toggles.push([name, 'disabled'])
    for (const name of stringList(entry.enabledMcpServers)) toggles.push([name, 'enabled'])
  }
  const connectorsDisabled =
    userSettings.disableClaudeAiConnectors === true ||
    projectSettings.disableClaudeAiConnectors === true ||
    localSettings.disableClaudeAiConnectors === true
  return { declarations, state, connectorsDisabled, toggles }
}

interface EndpointDuplicate {
  installPath: string
  serverName: string
  declaration: Declaration
}

// Compared in memory and dropped: both sides of the comparison may carry credentials.
function endpointDuplicates(
  declarations: Declaration[],
  pluginEndpoints: ReadonlyMap<string, string>
): EndpointDuplicate[] {
  const byEndpoint = new Map<string, Declaration[]>()
  for (const declaration of declarations) {
    const endpoint = mcpEndpointKey(declaration.config)
    if (endpoint === null) continue
    byEndpoint.set(endpoint, [...(byEndpoint.get(endpoint) ?? []), declaration])
  }
  return [...pluginEndpoints].flatMap(([key, endpoint]) => {
    const separator = key.lastIndexOf('\0')
    const installPath = key.slice(0, separator)
    const serverName = key.slice(separator + 1)
    return (byEndpoint.get(endpoint) ?? []).map((declaration) => ({
      installPath,
      serverName,
      declaration
    }))
  })
}

function writeScan(
  db: Database.Database,
  declarations: Declaration[],
  duplicates: EndpointDuplicate[],
  states: [string, McpJsonState | null, boolean][],
  toggles: [string, string, 'disabled' | 'enabled'][],
  keptProjects: string[]
): void {
  const insertDeclaration = db.prepare(
    `INSERT OR REPLACE INTO mcp_declarations (scope, project_path, name, transport, problem,
       location, env_keys, header_keys, arg_count, has_literal_credential, approval, source_path)
     VALUES (@scope, @projectPath, @name, @transport, @problem, @location, @envKeys, @headerKeys,
       @argCount, @hasLiteralCredential, @approval, @sourcePath)`
  )
  const insertState = db.prepare(
    'INSERT INTO mcp_project_state (project_path, mcp_json, connectors_disabled) VALUES (?, ?, ?)'
  )
  const insertDuplicate = db.prepare(
    `INSERT OR IGNORE INTO mcp_endpoint_duplicates (install_path, server_name, scope, project_path,
       name) VALUES (?, ?, ?, ?, ?)`
  )
  const insertToggle = db.prepare(
    'INSERT OR IGNORE INTO mcp_server_toggles (project_path, server_name, toggle) VALUES (?, ?, ?)'
  )
  db.transaction(() => {
    // A project whose .mcp.json exists but can't be read keeps its last known servers.
    db.prepare(
      `DELETE FROM mcp_declarations
       WHERE scope <> 'project' OR project_path NOT IN (SELECT value FROM json_each(?))`
    ).run(JSON.stringify(keptProjects))
    db.prepare('DELETE FROM mcp_project_state').run()
    db.prepare('DELETE FROM mcp_server_toggles').run()
    db.prepare('DELETE FROM mcp_endpoint_duplicates').run()
    for (const declaration of declarations) {
      const summary = summarizeMcpServer(declaration.config)
      insertDeclaration.run({
        scope: declaration.scope,
        projectPath: declaration.projectPath,
        name: declaration.name,
        transport: summary.transport,
        problem: summary.problem,
        location: summary.location,
        envKeys: JSON.stringify(summary.env),
        headerKeys: JSON.stringify(summary.headers),
        argCount: summary.argCount,
        hasLiteralCredential: summary.hasLiteralCredential ? 1 : 0,
        approval: declaration.approval,
        sourcePath: declaration.sourcePath
      })
    }
    for (const [path, state, disabled] of states) insertState.run(path, state, disabled ? 1 : 0)
    for (const [path, name, toggle] of toggles) insertToggle.run(path, name, toggle)
    for (const { installPath, serverName, declaration } of duplicates)
      insertDuplicate.run(
        installPath,
        serverName,
        declaration.scope,
        declaration.projectPath,
        declaration.name
      )
  })()
}

export interface McpDeclarationScanOptions {
  // Folders a Scan found that Claude Code may never have opened; their .mcp.json still declares
  // servers for the next session there.
  candidateProjects?: readonly string[]
  // `${installPath}\0${server}` -> endpoint key, from this Scan's plugin registry pass.
  pluginEndpoints?: ReadonlyMap<string, string>
  // Folders the user hid (hidden-projects.ts). Their groups are skipped, but trust still reads
  // every `projects` entry, since that is how Claude Code decides it.
  hiddenProjects?: readonly string[]
}

export function scanMcpDeclarations(
  db: Database.Database,
  {
    candidateProjects = [],
    pluginEndpoints = new Map(),
    hiddenProjects = []
  }: McpDeclarationScanOptions = {}
): ScanTaskResult {
  const { claudeJson, settings } = claudeConfig()
  const root = readJson(claudeJson)
  const rootIssue = issueFor(root, claudeJson)
  // Without .claude.json no scope is knowable; the last known Declarations stand.
  if (rootIssue) return { status: 'partial', issues: [rootIssue] }

  const issues = new Map<string, ScanIssue>()
  const config = settingsValue(root)
  const projects = isRecord(config.projects) ? config.projects : {}
  const userSettings = settingsValue(readJson(settings))

  const declarations: Declaration[] = serversIn(config, claudeJson, issues).map(
    ([name, server]) => ({
      scope: 'user',
      projectPath: USER_PROJECT_PATH,
      name,
      config: server,
      sourcePath: claudeJson,
      approval: null
    })
  )
  const states: [string, McpJsonState | null, boolean][] = [
    [USER_PROJECT_PATH, null, userSettings.disableClaudeAiConnectors === true]
  ]
  const toggles: [string, string, 'disabled' | 'enabled'][] = []
  const keptProjects: string[] = []
  for (const group of groupProjects(projects, candidateProjects)) {
    if (isHiddenProject(group.path, hiddenProjects)) continue
    const scan = scanProject(group, projects, userSettings, issues, claudeJson)
    declarations.push(...scan.declarations)
    states.push([group.path, scan.state, scan.connectorsDisabled])
    for (const [name, toggle] of scan.toggles) toggles.push([group.path, name, toggle])
    if (scan.state === 'unavailable') keptProjects.push(group.path)
  }

  const duplicates = endpointDuplicates(declarations, pluginEndpoints)
  writeScan(db, declarations, duplicates, states, toggles, keptProjects)
  return issues.size === 0
    ? { status: 'complete' }
    : { status: 'partial', issues: [...issues.values()] }
}

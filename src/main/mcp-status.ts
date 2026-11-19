import { mkdirSync } from 'fs'
import { join } from 'path'
import type {
  McpConnectionCheck,
  McpConnectionCheckResult,
  McpLiveServer,
  McpLiveStatus
} from '../shared/ipc'
import { normalizeProjectPath } from '../shared/project-path'
import { runClaude } from './claude-process'
import { allowedStatSync, isPathAllowed } from './permissions'

// The on-demand Live check (docs/mcp-servers.md): `claude mcp list` starts every approved stdio
// server and contacts every remote one, and prints each server's command line or URL, credentials
// included. Only the leading name and the trailing status survive the parse.

const LIST_ARGS = ['mcp', 'list']
const CHECK_TIMEOUT_MS = 120_000
const CHECK_TIMEOUT_MESSAGE =
  'claude mcp list did not finish within 2 minutes. A slow MCP server can hold it up.'
const UNREADABLE_OUTPUT_MESSAGE = "Megatron couldn't read the output of claude mcp list."
export type McpFolderPurpose = 'check' | 'change'
const FOLDER_REFUSALS: Record<McpFolderPurpose, { ungranted: string; missing: string }> = {
  check: {
    ungranted: "Grant this project's folder in Manage Folders before checking its servers.",
    missing: 'This project folder is missing, so its servers cannot be checked.'
  },
  change: {
    ungranted:
      "Grant this project's folder in Manage Folders before changing its servers, so Megatron " +
      'can read the result.',
    missing: 'This project folder is missing, so its servers cannot be changed.'
  }
}
const GET_TIMEOUT_MS = 60_000
const GET_TIMEOUT_MESSAGE = 'claude mcp get did not finish within a minute.'
const UNREADABLE_GET_MESSAGE = "Megatron couldn't read the server's status from claude mcp get."
const GET_STATUS_LINE = /^\s*Status:\s*(.+)$/
const GENERAL_FOLDER = 'mcp-check'
const NAME_SEPARATOR = ': '
const STATUS_SEPARATOR = ' - '
const NO_SERVERS = /No MCP servers configured/i

// Matched against the status text with its leading glyph (✔ ! ✗ ⏸ ⊘ -) stripped, so a console that
// mangles the glyphs still reads. Order matters: "Connected · tools fetch failed" before "Connected".
// Read from Claude Code 2.1.327's own status strings, 2026-11-18.
const STATUS_WORDING: [RegExp, McpLiveStatus][] = [
  [/^Connected\s*\S.*fail/i, 'degraded'],
  [/^Connected$/i, 'connected'],
  [/^Needs authentication/i, 'needs_auth'],
  [/^(Failed to connect|Connection error)/i, 'failed'],
  [/^Pending approval/i, 'pending_approval'],
  [/^Rejected/i, 'rejected'],
  [/^Disabled for this project/i, 'disabled'],
  [/^Not configured/i, 'not_configured']
]

function statusOf(text: string): McpLiveStatus | null {
  const wording = text.replace(/^[^A-Za-z]+/, '').trim()
  return STATUS_WORDING.find(([pattern]) => pattern.test(wording))?.[1] ?? null
}

// The status is the last ` - ` segment that reads as one: a command line can itself hold ` - `.
function parseLine(line: string): McpLiveServer | null {
  // Indented lines are a failed server's issue text: an error that may quote a URL or token.
  if (line.trim() === '' || /^\s/.test(line)) return null
  const nameEnd = line.indexOf(NAME_SEPARATOR)
  if (nameEnd <= 0) return null
  let separator = line.lastIndexOf(STATUS_SEPARATOR)
  while (separator > nameEnd) {
    const status = statusOf(line.slice(separator + STATUS_SEPARATOR.length))
    if (status !== null) return { name: line.slice(0, nameEnd), status }
    separator = line.lastIndexOf(STATUS_SEPARATOR, separator - 1)
  }
  return null
}

export function parseMcpList(output: string): McpLiveServer[] {
  const servers = new Map<string, McpLiveServer>()
  for (const line of output.split(/\r?\n/)) {
    const server = parseLine(line)
    if (server !== null && !servers.has(server.name)) servers.set(server.name, server)
  }
  return [...servers.values()]
}

// `claude mcp get` prints one server's scope, status, and URL or command line; only the status
// line is read (docs/mcp-servers.md, Writes).
export function parseMcpGetStatus(output: string): McpLiveStatus | null {
  for (const line of output.split(/\r?\n/)) {
    const match = GET_STATUS_LINE.exec(line)
    if (match !== null) return statusOf(match[1])
  }
  return null
}

export type McpServerCheck = { ok: true; status: McpLiveStatus } | { ok: false; error: string }

// One server's status, health-checked by the CLI: how a logout is confirmed. `--` keeps a name
// that starts with `-` from reading as an option.
export async function checkMcpServer(name: string, cwd: string): Promise<McpServerCheck> {
  const run = await runClaude(['mcp', 'get', '--', name], {
    cwd,
    timeoutMs: GET_TIMEOUT_MS,
    timeoutMessage: GET_TIMEOUT_MESSAGE
  })
  if (!run.ok) return { ok: false, error: run.error }
  const status = parseMcpGetStatus(run.stdout)
  return status === null ? { ok: false, error: UNREADABLE_GET_MESSAGE } : { ok: true, status }
}

export type McpCheckFolder = { ok: true; cwd: string } | { ok: false; error: string }

// The general check runs from an empty app-private folder, so no project's .mcp.json or local
// servers ride along; a project check runs only from a folder the user granted. Actions on a
// user-scope server run from the same folder for the same reason.
export function mcpCheckFolder(
  projectPath: string | null,
  userDataDir: string,
  purpose: McpFolderPurpose = 'check'
): McpCheckFolder {
  if (projectPath === null) {
    const cwd = join(userDataDir, GENERAL_FOLDER)
    mkdirSync(cwd, { recursive: true })
    return { ok: true, cwd }
  }
  const refusals = FOLDER_REFUSALS[purpose]
  if (!isPathAllowed(projectPath)) return { ok: false, error: refusals.ungranted }
  if (allowedStatSync(projectPath)?.isDirectory() !== true)
    return { ok: false, error: refusals.missing }
  return { ok: true, cwd: projectPath }
}

let generalCheck: McpConnectionCheck | null = null
const projectChecks = new Map<string, McpConnectionCheck>()
const inFlight = new Map<string, Promise<McpConnectionCheckResult>>()

function checkKey(projectPath: string | null): string {
  return projectPath === null ? '' : normalizeProjectPath(projectPath)
}

async function runCheck(
  projectPath: string | null,
  cwd: string
): Promise<McpConnectionCheckResult> {
  const run = await runClaude(LIST_ARGS, {
    cwd,
    timeoutMs: CHECK_TIMEOUT_MS,
    timeoutMessage: CHECK_TIMEOUT_MESSAGE
  })
  if (!run.ok) return { ok: false, error: run.error }
  const servers = parseMcpList(run.stdout)
  if (servers.length === 0 && !NO_SERVERS.test(run.stdout))
    return { ok: false, error: UNREADABLE_OUTPUT_MESSAGE }
  const check: McpConnectionCheck = { projectPath, checkedAt: new Date().toISOString(), servers }
  if (projectPath === null) generalCheck = check
  else projectChecks.set(checkKey(projectPath), check)
  return { ok: true, check }
}

// One run per folder at a time: a double click must not start every server twice.
export function checkMcpConnections(
  projectPath: string | null,
  userDataDir: string
): Promise<McpConnectionCheckResult> {
  const folder = mcpCheckFolder(projectPath, userDataDir)
  if (!folder.ok) return Promise.resolve({ ok: false, error: folder.error })
  const key = checkKey(projectPath)
  let running = inFlight.get(key)
  if (running === undefined) {
    running = runCheck(projectPath, folder.cwd).finally(() => inFlight.delete(key))
    inFlight.set(key, running)
  }
  return running
}

export function latestMcpChecks(): {
  general: McpConnectionCheck | null
  projects: McpConnectionCheck[]
} {
  return { general: generalCheck, projects: [...projectChecks.values()] }
}

// After an MCP action, every kept status may be stale; a run in flight still lands.
export function forgetMcpChecks(): void {
  generalCheck = null
  projectChecks.clear()
}

// Tests only: the checks are module state for the app session.
export function resetMcpChecks(): void {
  generalCheck = null
  projectChecks.clear()
  inFlight.clear()
}

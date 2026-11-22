import { isAbsolute } from 'path'
import type { McpAddInput, McpAddTransport, McpConfiguredScope, McpKeyValue } from '../shared/ipc'
import { summarizeMcpServer } from './ingest/mcp-server-config'

// Adding an MCP server (#50, docs/mcp-servers.md, Writes). The input crosses IPC from the
// renderer, so everything is checked here; the config reaches the CLI only on stdin.

const MAX_NAME_LENGTH = 100
const MAX_TEXT_LENGTH = 8192
const MAX_ARGS = 100
const MAX_ENTRIES = 50
const SCOPES = new Set<McpConfiguredScope>(['local', 'project', 'user'])
const TRANSPORTS = new Set<McpAddTransport>(['stdio', 'http', 'sse', 'ws'])
const URL_PROTOCOLS: Record<Exclude<McpAddTransport, 'stdio'>, string[]> = {
  http: ['https:', 'http:'],
  sse: ['https:', 'http:'],
  ws: ['wss:', 'ws:']
}
// What a shell or Claude Code expands as ${NAME}, and an HTTP header's token characters.
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
// Claude Code's own rule for a server name (verified 2026-11-22, 2.1.330: add-json refuses any
// other character), checked here so the form says so before the CLI runs.
const SERVER_NAME = /^[A-Za-z0-9_-]+$/

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function boundedText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max && !value.includes('\0')
}

function parseEntries(value: unknown, label: string, namePattern: RegExp): Parsed<McpKeyValue[]> {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES)
    return { ok: false, error: `Give at most ${MAX_ENTRIES} ${label}.` }
  const seen = new Set<string>()
  const entries: McpKeyValue[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !boundedText(entry.name) || !boundedText(entry.value))
      return { ok: false, error: `Each of the ${label} needs a name and a value.` }
    if (!namePattern.test(entry.name))
      return {
        ok: false,
        error: `${entry.name || 'An empty name'} isn't a valid name for ${label}.`
      }
    const key = label === 'headers' ? entry.name.toLowerCase() : entry.name
    if (seen.has(key)) return { ok: false, error: `${entry.name} appears twice in the ${label}.` }
    seen.add(key)
    entries.push({ name: entry.name, value: entry.value })
  }
  return { ok: true, value: entries }
}

function parseName(value: unknown): Parsed<string> {
  if (typeof value !== 'string') return { ok: false, error: 'Give the server a name.' }
  const name = value.trim()
  if (name === '') return { ok: false, error: 'Give the server a name.' }
  if (name.length > MAX_NAME_LENGTH)
    return { ok: false, error: `Keep the name to ${MAX_NAME_LENGTH} characters.` }
  if (!SERVER_NAME.test(name))
    return { ok: false, error: 'Use only letters, numbers, hyphens and underscores in the name.' }
  return { ok: true, value: name }
}

function scopeFolderError(scope: McpConfiguredScope, projectPath: unknown): string | null {
  if (scope === 'user')
    return projectPath === null ? null : 'A user-scope server belongs to no project.'
  return typeof projectPath === 'string' && !projectPath.includes('\0') && isAbsolute(projectPath)
    ? null
    : 'Choose the project folder for this server.'
}

function urlError(transport: Exclude<McpAddTransport, 'stdio'>, url: unknown): string | null {
  if (!boundedText(url) || url.trim() === '') return 'Give the server its URL.'
  try {
    return URL_PROTOCOLS[transport].includes(new URL(url.trim()).protocol)
      ? null
      : `A ${transport === 'ws' ? 'WebSocket' : 'web'} server's URL starts with ${URL_PROTOCOLS[transport].map((protocol) => `${protocol}//`).join(' or ')}.`
  } catch {
    return "That URL can't be read."
  }
}

export function parseMcpAddInput(input: unknown): Parsed<McpAddInput> {
  if (!isRecord(input)) return { ok: false, error: 'Megatron could not read the server details.' }
  const name = parseName(input.name)
  if (!name.ok) return name
  const scope = input.scope as McpConfiguredScope
  if (!SCOPES.has(scope)) return { ok: false, error: 'Choose user, local or project scope.' }
  const folderError = scopeFolderError(scope, input.projectPath)
  if (folderError !== null) return { ok: false, error: folderError }
  const transport = input.transport as McpAddTransport
  if (!TRANSPORTS.has(transport))
    return { ok: false, error: 'Choose stdio, HTTP, SSE or WebSocket.' }

  const base = {
    name: name.value,
    scope,
    projectPath: scope === 'user' ? null : (input.projectPath as string),
    transport
  }
  if (transport === 'stdio') {
    if (!boundedText(input.command) || input.command.trim() === '')
      return { ok: false, error: 'Give the command that starts the server.' }
    if (
      !Array.isArray(input.args) ||
      input.args.length > MAX_ARGS ||
      !input.args.every((arg) => boundedText(arg))
    )
      return { ok: false, error: `Give at most ${MAX_ARGS} arguments, each one line of text.` }
    const env = parseEntries(input.env, 'environment variables', ENV_NAME)
    if (!env.ok) return env
    return {
      ok: true,
      value: {
        ...base,
        command: input.command.trim(),
        args: input.args as string[],
        url: '',
        env: env.value,
        headers: []
      }
    }
  }
  const error = urlError(transport, input.url)
  if (error !== null) return { ok: false, error }
  const headers = parseEntries(input.headers, 'headers', HEADER_NAME)
  if (!headers.ok) return headers
  return {
    ok: true,
    value: {
      ...base,
      command: '',
      args: [],
      url: (input.url as string).trim(),
      env: [],
      headers: headers.value
    }
  }
}

const asObject = (entries: McpKeyValue[]): Record<string, string> =>
  Object.fromEntries(entries.map((entry) => [entry.name, entry.value]))

// The JSON Claude Code stores for the server, as `add-json` reads it.
export function mcpServerConfig(input: McpAddInput): Record<string, unknown> {
  if (input.transport === 'stdio')
    return {
      type: 'stdio',
      command: input.command,
      ...(input.args.length > 0 ? { args: input.args } : {}),
      ...(input.env.length > 0 ? { env: asObject(input.env) } : {})
    }
  return {
    type: input.transport,
    url: input.url,
    ...(input.headers.length > 0 ? { headers: asObject(input.headers) } : {})
  }
}

// A project's .mcp.json is shared through git, so a credential-looking literal is refused there,
// judged by the scanner's own check so the add and the mcp-inlined-credential lint never disagree.
// Local and user scope are this machine's own .claude.json; the form warns there instead.
export function mcpAddRefusal(input: McpAddInput): string | null {
  if (input.scope !== 'project') return null
  const summary = summarizeMcpServer(mcpServerConfig(input))
  if (!summary.hasLiteralCredential) return null
  const keys = [...summary.env, ...summary.headers].filter((key) => key.literal)
  const example = keys[0]?.name ?? 'API_KEY'
  const where =
    keys.length > 0
      ? `a literal value in ${keys.map((key) => key.name).join(', ')}`
      : 'what looks like a credential in its arguments or URL'
  return `A project's .mcp.json is shared through git, so it can't hold ${where}. Use a reference such as \${${example}} instead, and set ${example} in your environment.`
}

// `--` ends the options (a name may start with `-`); `-` makes add-json read the JSON from stdin.
export function mcpAddArgs(name: string, scope: McpConfiguredScope): string[] {
  return ['mcp', 'add-json', '--scope', scope, '--', name, '-']
}

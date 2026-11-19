import type { McpConfigProblem, McpTransport } from '../../shared/ipc'
import { isRecord } from './claude-settings'

// One MCP server entry, reduced to what Megatron may store (docs/mcp-servers.md, Stored config):
// configs in the wild inline credentials in args, env, headers, and URLs, so no value survives.

// Each McpConfigProblem makes Claude Code skip the server, so it never loads.
export type { McpConfigProblem, McpTransport }

export interface McpKeyName {
  name: string
  // false when the value expands a `${VAR}` reference; a literal sits in the config file itself.
  literal: boolean
}

export interface McpServerSummary {
  transport: McpTransport | null
  problem: McpConfigProblem | null
  // URL host (and port) or command basename.
  location: string | null
  env: McpKeyName[]
  headers: McpKeyName[]
  argCount: number
  hasLiteralCredential: boolean
}

const TRANSPORT_BY_TYPE: Record<string, McpTransport> = {
  stdio: 'stdio',
  http: 'http',
  'streamable-http': 'http',
  sse: 'sse',
  ws: 'ws'
}

// `${VAR}` and `${VAR:-default}`, the two expansions Claude Code applies to MCP config values.
const VARIABLE_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/g
const CREDENTIAL_NAME =
  /token|secret|passw(?:or)?d|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth|cookie|session/i
const CREDENTIAL_FLAG = /^--?(?:api[-_]?key|token|secret|password|passwd|access[-_]?key|auth|key)$/i
const CREDENTIAL_FLAG_WITH_VALUE =
  /^--?(?:api[-_]?key|token|secret|password|passwd|access[-_]?key|auth|key)=(.*)$/i
const AUTH_SCHEME = /^\s*(?:bearer|basic|token)\b/i
// Vendor prefixes whose presence alone marks a credential, wherever it appears.
const KNOWN_TOKEN =
  /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{3,}|gh[pousr]_[A-Za-z0-9]{4,}|github_pat_|glpat-|xox[abporse]-|AKIA[0-9A-Z]{12,}|[sr]k_live_|AIza[0-9A-Za-z_-]{10,}|ya29\.)/
const RANDOM_LOOKING = /^[A-Za-z0-9_\-+=]{32,}$/

function transportOf(config: Record<string, unknown>): {
  transport: McpTransport | null
  problem: McpConfigProblem | null
} {
  const command = typeof config.command === 'string' ? config.command.trim() : ''
  const url = typeof config.url === 'string' ? config.url.trim() : ''
  if (config.type === undefined) {
    if (url !== '' && command === '') return { transport: null, problem: 'url_without_type' }
    return { transport: 'stdio', problem: command === '' ? 'no_endpoint' : null }
  }
  const transport = typeof config.type === 'string' ? TRANSPORT_BY_TYPE[config.type] : undefined
  if (transport === undefined) return { transport: null, problem: 'unknown_type' }
  const endpoint = transport === 'stdio' ? command : url
  return { transport, problem: endpoint === '' ? 'no_endpoint' : null }
}

function urlHost(url: string): string | null {
  try {
    const { host } = new URL(url)
    // An unexpanded `${VAR}` can parse into a host; show nothing rather than a fragment of it.
    return /^[\w.-]+(:\d+)?$/.test(host) ? host : null
  } catch {
    return null
  }
}

// ponytail: cut at the first space so inline args never leak; a command path with a space in it
// shows only its first word. Parse the path properly if a real server ships one.
function commandName(command: string): string | null {
  const program = command.trim().split(/\s+/)[0]
  return program.split(/[\\/]/).pop() || null
}

function withoutReferences(value: string): string {
  return value.replace(VARIABLE_REFERENCE, '')
}

function looksLikeToken(value: string): boolean {
  const text = withoutReferences(value).trim()
  if (KNOWN_TOKEN.test(text)) return true
  return RANDOM_LOOKING.test(text) && /[a-z]/.test(text) && /[A-Z]/.test(text) && /\d/.test(text)
}

function isLiteralCredential(name: string, value: unknown, stripScheme = false): boolean {
  if (typeof value !== 'string') return false
  if (looksLikeToken(value)) return true
  let literal = withoutReferences(value)
  if (stripScheme) literal = literal.replace(AUTH_SCHEME, '')
  return CREDENTIAL_NAME.test(name) && literal.trim() !== ''
}

function keyNames(map: unknown): McpKeyName[] {
  if (!isRecord(map)) return []
  return Object.entries(map).map(([name, value]) => ({
    name,
    literal: typeof value !== 'string' || withoutReferences(value) === value
  }))
}

function stringArgs(config: Record<string, unknown>): string[] {
  return Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === 'string')
    : []
}

function argsHoldCredential(args: string[]): boolean {
  return args.some((arg, index) => {
    if (looksLikeToken(arg)) return true
    const inline = CREDENTIAL_FLAG_WITH_VALUE.exec(arg)
    if (inline) return withoutReferences(inline[1]).trim() !== ''
    const next = args[index + 1]
    return CREDENTIAL_FLAG.test(arg) && next !== undefined && withoutReferences(next).trim() !== ''
  })
}

// URL keeps userinfo percent-encoded, so a `${VAR}` there reads `$%7BVAR%7D` until decoded.
function safelyDecoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function urlHoldsCredential(url: string): boolean {
  if (looksLikeToken(url)) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (withoutReferences(safelyDecoded(parsed.username + parsed.password)) !== '') return true
  return [...parsed.searchParams].some(([name, value]) => isLiteralCredential(name, value))
}

function holdsLiteralCredential(config: Record<string, unknown>): boolean {
  const env = isRecord(config.env) ? Object.entries(config.env) : []
  const headers = isRecord(config.headers) ? Object.entries(config.headers) : []
  return (
    env.some(([name, value]) => isLiteralCredential(name, value)) ||
    headers.some(([name, value]) => isLiteralCredential(name, value, true)) ||
    argsHoldCredential(stringArgs(config)) ||
    (typeof config.command === 'string' && looksLikeToken(config.command)) ||
    (typeof config.url === 'string' && urlHoldsCredential(config.url))
  )
}

export function summarizeMcpServer(config: Record<string, unknown>): McpServerSummary {
  const { transport, problem } = transportOf(config)
  const url = typeof config.url === 'string' ? config.url : null
  const command = typeof config.command === 'string' ? config.command : null
  const usesUrl = transport === null || transport !== 'stdio'
  return {
    transport,
    problem,
    location: usesUrl && url ? urlHost(url) : command ? commandName(command) : null,
    env: keyNames(config.env),
    headers: keyNames(config.headers),
    argCount: Array.isArray(config.args) ? config.args.length : 0,
    hasLiteralCredential: holdsLiteralCredential(config)
  }
}

// In-memory only (docs/mcp-servers.md, Endpoint comparison): the key holds the full URL or
// command line, credentials included, so it is compared during a Scan and never stored.
// Claude Code's rule: URLs are equal up to scheme/host case, default port, and a trailing slash.
export function mcpEndpointKey(config: Record<string, unknown>): string | null {
  const { transport, problem } = transportOf(config)
  if (transport === null || problem !== null) return null
  if (transport === 'stdio')
    return `stdio:${JSON.stringify([String(config.command).trim(), ...stringArgs(config)])}`
  try {
    const url = new URL(String(config.url).trim())
    const path = url.pathname.replace(/\/+$/, '')
    const userinfo = url.username || url.password ? `${url.username}:${url.password}@` : ''
    return `url:${url.protocol}//${userinfo}${url.host}${path}${url.search}`
  } catch {
    return null
  }
}

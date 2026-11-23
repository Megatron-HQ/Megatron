import type { McpAddInput, McpAddTransport, McpConfiguredScope } from '../../../shared/ipc'
import {
  MCP_ENV_NAME,
  MCP_HEADER_NAME,
  MCP_VARIABLE_REFERENCE,
  mcpServerNameError,
  mcpUrlError
} from '../../../shared/mcp-add-rules'

export interface McpAddValue {
  name: string
  value: string
  literal: boolean
}

interface McpAddFields {
  transport: McpAddTransport
  command: string
  argsText: string
  url: string
  env: McpAddValue[]
  headers: McpAddValue[]
}

export interface McpAddDraft extends McpAddFields {
  name: string
  scope: McpConfiguredScope
  projectPath: string | null
}

type PasteResult =
  { ok: true; name: string | null; fields: McpAddFields } | { ok: false; error: string }

const PASTED_TRANSPORTS = new Map<string, McpAddTransport>([
  ['stdio', 'stdio'],
  ['http', 'http'],
  ['streamable-http', 'http'],
  ['sse', 'sse'],
  ['ws', 'ws']
])

function emptyFields(transport: McpAddTransport): McpAddFields {
  return { transport, command: '', argsText: '', url: '', env: [], headers: [] }
}

export function emptyMcpAddDraft(projectPath: string | null): McpAddDraft {
  return {
    ...emptyFields('stdio'),
    name: '',
    scope: projectPath === null ? 'user' : 'local',
    projectPath
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function pastedValues(value: unknown): McpAddValue[] | null {
  if (value === undefined) return []
  if (!isRecord(value)) return null
  const entries: McpAddValue[] = []
  for (const [name, text] of Object.entries(value)) {
    if (typeof text !== 'string') return null
    entries.push({ name, value: text, literal: !MCP_VARIABLE_REFERENCE.test(text) })
  }
  return entries
}

// JSON string syntax is only needed for arguments that cannot round-trip on a plain line.
function argumentLine(argument: string): string {
  return argument.trim() === '' || /[\r\n]/.test(argument) || argument.startsWith('"')
    ? JSON.stringify(argument)
    : argument
}

function argumentsFromText(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      if (!line.startsWith('"')) return line
      try {
        const value: unknown = JSON.parse(line)
        return typeof value === 'string' ? value : line
      } catch {
        return line
      }
    })
}

export function parsePastedMcpJson(text: string): PasteResult {
  let pasted: unknown
  try {
    pasted = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Paste a valid JSON server configuration.' }
  }
  if (!isRecord(pasted)) return { ok: false, error: 'Paste one server as a JSON object.' }

  let config = pasted
  let name: string | null = null
  const bare = [pasted.command, pasted.url, pasted.type].some(
    (field) => field !== undefined && !isRecord(field)
  )
  if ('mcpServers' in pasted || (!bare && Object.values(pasted).some(isRecord))) {
    const wrapper = 'mcpServers' in pasted ? pasted.mcpServers : pasted
    const entries = isRecord(wrapper) ? Object.entries(wrapper) : []
    if (entries.length !== 1 || !isRecord(entries[0][1]))
      return { ok: false, error: 'Paste the configuration for one server at a time.' }
    name = entries[0][0]
    config = entries[0][1]
  }

  const type = config.type ?? (typeof config.command === 'string' ? 'stdio' : 'http')
  const transport = typeof type === 'string' ? PASTED_TRANSPORTS.get(type) : undefined
  if (!transport) return { ok: false, error: 'Choose a supported transport type in the JSON.' }
  if (!('command' in config || 'url' in config))
    return { ok: false, error: 'The server JSON needs a command or a url.' }

  const fields = emptyFields(transport)
  if (transport === 'stdio') {
    if (typeof config.command !== 'string')
      return { ok: false, error: 'A stdio server needs a command string.' }
    const args = config.args ?? []
    if (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string'))
      return { ok: false, error: 'Give arguments as an array of strings.' }
    const env = pastedValues(config.env)
    if (!env) return { ok: false, error: 'Give environment variables as an object of strings.' }
    return {
      ok: true,
      name,
      fields: {
        ...fields,
        command: config.command,
        argsText: args.map(argumentLine).join('\n'),
        env
      }
    }
  }
  if (typeof config.url !== 'string')
    return { ok: false, error: 'A remote server needs a url string.' }
  const headers = pastedValues(config.headers)
  if (!headers) return { ok: false, error: 'Give headers as an object of strings.' }
  return { ok: true, name, fields: { ...fields, url: config.url, headers } }
}

function activeValues(draft: McpAddDraft): McpAddValue[] {
  return draft.transport === 'stdio' ? draft.env : draft.headers
}

export function hasLiteralValues(draft: McpAddDraft): boolean {
  return activeValues(draft).some((entry) => entry.literal)
}

export function mcpAddDraftErrors(draft: McpAddDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  const nameError = mcpServerNameError(draft.name)
  if (nameError) errors.name = nameError
  if (draft.scope !== 'user' && !draft.projectPath)
    errors.project = 'Choose the project folder for this server.'

  const stdio = draft.transport === 'stdio'
  if (draft.transport !== 'stdio') {
    const urlError = mcpUrlError(draft.transport, draft.url)
    if (urlError) errors.url = urlError
  } else if (draft.command.trim() === '') {
    errors.command = 'Give the command that starts the server.'
  }

  const field = stdio ? 'env' : 'headers'
  const namePattern = stdio ? MCP_ENV_NAME : MCP_HEADER_NAME
  const names = new Set<string>()
  for (const [index, entry] of activeValues(draft).entries()) {
    const key = `${field}.${index}`
    const name = stdio ? entry.name : entry.name.toLowerCase()
    if (!namePattern.test(entry.name)) errors[key] = 'Give this value a valid name.'
    else if (names.has(name)) errors[key] = 'This name is already used above.'
    else if (!entry.literal && !MCP_VARIABLE_REFERENCE.test(entry.value))
      errors[key] = 'Use an environment variable reference such as ${TOKEN}.'
    names.add(name)
  }
  return errors
}

export function mcpAddInput(draft: McpAddDraft): McpAddInput {
  const stdio = draft.transport === 'stdio'
  const values = activeValues(draft).map(({ name, value }) => ({ name, value }))
  return {
    name: draft.name.trim(),
    scope: draft.scope,
    projectPath: draft.scope === 'user' ? null : draft.projectPath,
    transport: draft.transport,
    command: stdio ? draft.command.trim() : '',
    args: stdio ? argumentsFromText(draft.argsText) : [],
    url: stdio ? '' : draft.url.trim(),
    env: stdio ? values : [],
    headers: stdio ? [] : values
  }
}

export function mcpToolPrefix(name: string): string {
  return `mcp__${name.trim().replace(/[^A-Za-z0-9_-]/g, '_')}__`
}

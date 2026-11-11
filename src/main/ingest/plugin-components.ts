import { createHash } from 'crypto'
import { basename, join, resolve } from 'path'
import type { PluginComponent } from '../../shared/ipc'
import {
  allowedRealpathSync,
  allowedStatSync,
  isWithinGrant,
  readAllowedDirectoryEntries,
  readAllowedFile
} from '../permissions'
import { isRecord, readJson } from './claude-settings'
import { parseFrontmatter } from './skill-parser'

export type ResolvedComponent = Omit<PluginComponent, 'install_path'>

export interface MarketplaceEntryRef {
  value: Record<string, unknown>
  path: string
}

export interface PluginComponentsRead {
  // 'unavailable' when any read failed for a reason other than absence: the caller keeps the
  // cached rows rather than replacing them with a partial set (docs/skill-scanner.md).
  status: 'ok' | 'unavailable'
  components: ResolvedComponent[]
}

interface Declaration {
  value: unknown
  origin: string
}

const AGENT_NAME_MAX_CHARS = 256

class Unavailable extends Error {}

function readText(path: string): string | null {
  const read = readAllowedFile(path)
  if (read.status === 'missing') return null
  if (read.status !== 'ok' || read.contents === null) throw new Unavailable()
  return read.contents.toString('utf8')
}

// Malformed JSON declares nothing — Claude Code fails to load it too.
function readJsonValue(path: string): unknown {
  const read = readJson(path)
  if (read.status === 'unavailable') throw new Unavailable()
  return read.value
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

// Claude Code refuses a component path that resolves outside the plugin root.
function insideRoot(root: string, declared: unknown): string | null {
  if (typeof declared !== 'string' || declared === '') return null
  const path = resolve(root, declared)
  return isWithinGrant(path, root) ? path : null
}

function isMarkdownFile(path: string): boolean {
  return path.endsWith('.md') && allowedStatSync(path)?.isFile() === true
}

function stem(path: string): string {
  return basename(path, '.md')
}

// Every .md below `dir`, with the subfolder names between them — Claude Code turns those into
// `:` name segments.
function walkMarkdown(
  dir: string,
  prefix: string[] = [],
  seen = new Set<string>()
): { segments: string[]; path: string }[] {
  const listing = readAllowedDirectoryEntries(dir)
  if (listing.status === 'missing') return []
  if (listing.status !== 'ok') throw new Unavailable()
  const canonical = allowedRealpathSync(dir)
  if (canonical === null || seen.has(canonical)) return []
  seen.add(canonical)

  return listing.entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    const type =
      entry.type === 'symlink'
        ? allowedStatSync(path)?.isDirectory()
          ? 'directory'
          : 'file'
        : entry.type
    if (type === 'directory') return walkMarkdown(path, [...prefix, entry.name], seen)
    return type === 'file' && isMarkdownFile(path) ? [{ segments: prefix, path }] : []
  })
}

// [] unless the path is a readable .md file, so every caller can flatMap it.
function markdownComponent(
  kind: 'agent' | 'command',
  path: string | null,
  segments: string[] = []
): ResolvedComponent[] {
  if (path === null || !isMarkdownFile(path)) return []
  const text = readText(path)
  if (text === null) return []
  const frontmatter = parseFrontmatter(text, stem(path))
  // An agent's frontmatter name replaces only its file segment; a command is its file name.
  const own =
    kind === 'agent' && frontmatter.name.length <= AGENT_NAME_MAX_CHARS
      ? frontmatter.name
      : stem(path)
  return [
    { kind, name: [...segments, own].join(':'), detail: frontmatter.description, source_path: path }
  ]
}

function resolveAgents(root: string, declarations: Declaration[]): ResolvedComponent[] {
  if (declarations.length === 0)
    return walkMarkdown(join(root, 'agents')).flatMap(({ segments, path }) =>
      markdownComponent('agent', path, segments)
    )
  // The manifest key takes files only, and a listed file loads without its subfolder names.
  return declarations.flatMap(({ value }) =>
    toList(value).flatMap((item) => markdownComponent('agent', insideRoot(root, item)))
  )
}

function resolveCommands(root: string, declarations: Declaration[]): ResolvedComponent[] {
  const fromPath = (path: string | null): ResolvedComponent[] =>
    path !== null && allowedStatSync(path)?.isDirectory()
      ? walkMarkdown(path).flatMap(({ segments, path: file }) =>
          markdownComponent('command', file, segments)
        )
      : markdownComponent('command', path)
  if (declarations.length === 0) return fromPath(join(root, 'commands'))

  return declarations.flatMap(({ value, origin }) => {
    if (!isRecord(value)) return toList(value).flatMap((item) => fromPath(insideRoot(root, item)))
    // The object map: each entry sets exactly one of `source` or `content`.
    return Object.entries(value).flatMap(([name, entry]): ResolvedComponent[] => {
      if (!isRecord(entry) || (entry.source === undefined) === (entry.content === undefined))
        return []
      const description = typeof entry.description === 'string' ? entry.description : null
      if (typeof entry.content === 'string')
        return [{ kind: 'command', name, detail: description, source_path: origin }]
      return markdownComponent('command', insideRoot(root, entry.source)).map((file) => ({
        ...file,
        name,
        detail: description ?? file.detail
      }))
    })
  })
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
// shows only its first word. Parse the path properly if a real plugin ships one.
function commandName(command: string): string | null {
  const program = command.trim().split(/\s+/)[0]
  return program.split(/[\\/]/).pop() || null
}

// Configs in the wild inline credentials, so only the transport and the host or program are kept.
function mcpDetail(config: Record<string, unknown>): string | null {
  const command = typeof config.command === 'string' ? config.command : null
  const url = typeof config.url === 'string' ? config.url : null
  const transport =
    typeof config.type === 'string' ? config.type : command ? 'stdio' : url ? 'http' : null
  const where = url ? urlHost(url) : command ? commandName(command) : null
  return [transport, where].filter(Boolean).join(' · ') || null
}

function isBundle(declared: string): boolean {
  return declared.endsWith('.mcpb') || declared.endsWith('.dxt')
}

// A bundle's server is named by its own manifest.json, which exists on disk only once Claude Code
// has extracted it. Layout read from Claude Code 2.1.322's binary: `.mcpb-cache/` holds
// `<first 8 hex of md5(declared source)>.metadata.json`, whose `extractedPath` holds the manifest.
function extractedBundleName(root: string, declared: string): string | null {
  const hash = createHash('md5').update(declared).digest('hex').slice(0, 8)
  const metadata = readJsonValue(join(root, '.mcpb-cache', `${hash}.metadata.json`))
  const extracted = isRecord(metadata) ? insideRoot(root, metadata.extractedPath) : null
  if (extracted === null) return null
  const manifest = readJsonValue(join(extracted, 'manifest.json'))
  return isRecord(manifest) && typeof manifest.name === 'string' && manifest.name !== ''
    ? manifest.name
    : null
}

function resolveMcp(root: string, declarations: Declaration[]): ResolvedComponent[] {
  const servers = new Map<string, ResolvedComponent>()
  const addMap = (map: unknown, origin: string): void => {
    // `.mcp.json` and a referenced file may wrap the map in `mcpServers` or not.
    const flat = isRecord(map) && isRecord(map.mcpServers) ? map.mcpServers : map
    if (!isRecord(flat)) return
    for (const [name, config] of Object.entries(flat))
      if (isRecord(config))
        servers.set(name, { kind: 'mcp', name, detail: mcpDetail(config), source_path: origin })
  }

  const defaultPath = join(root, '.mcp.json')
  addMap(readJsonValue(defaultPath), defaultPath)
  for (const { value, origin } of declarations)
    for (const item of toList(value)) {
      if (isRecord(item)) {
        addMap(item, origin)
        continue
      }
      if (typeof item !== 'string') continue
      if (isBundle(item)) {
        const remote = /^https?:\/\//.test(item)
        const path = remote ? null : insideRoot(root, item)
        if (!remote && path === null) continue
        const name =
          extractedBundleName(root, item) ??
          basename(remote ? new URL(item).pathname : item).replace(/\.(mcpb|dxt)$/, '')
        servers.set(name, { kind: 'mcp', name, detail: 'bundle', source_path: path ?? origin })
        continue
      }
      const path = insideRoot(root, item)
      if (path !== null) addMap(readJsonValue(path), path)
    }
  return [...servers.values()]
}

function resolveHooks(root: string, declarations: Declaration[]): ResolvedComponent[] {
  const events = new Map<string, ResolvedComponent>()
  const addEvents = (map: unknown, origin: string): void => {
    if (!isRecord(map)) return
    for (const [event, matchers] of Object.entries(map))
      if (Array.isArray(matchers) && matchers.length > 0)
        events.set(event, { kind: 'hook', name: event, detail: null, source_path: origin })
  }
  // A hooks file must carry the `hooks` wrapper; an inline manifest object is the bare event map.
  const addFile = (path: string | null): void => {
    if (path === null) return
    const value = readJsonValue(path)
    if (isRecord(value)) addEvents(value.hooks, path)
  }

  addFile(join(root, 'hooks', 'hooks.json'))
  for (const { value, origin } of declarations)
    for (const item of toList(value)) {
      if (isRecord(item)) addEvents(item, origin)
      else addFile(insideRoot(root, item))
    }
  return [...events.values()]
}

function resolveLsp(root: string, declarations: Declaration[]): ResolvedComponent[] {
  const servers = new Map<string, ResolvedComponent>()
  const addMap = (map: unknown, origin: string): void => {
    if (!isRecord(map)) return
    for (const [name, config] of Object.entries(map)) {
      if (!isRecord(config)) continue
      const extensions = isRecord(config.extensionToLanguage)
        ? Object.keys(config.extensionToLanguage).join(' ')
        : ''
      servers.set(name, { kind: 'lsp', name, detail: extensions || null, source_path: origin })
    }
  }

  const defaultPath = join(root, '.lsp.json')
  addMap(readJsonValue(defaultPath), defaultPath)
  for (const { value, origin } of declarations)
    for (const item of toList(value)) {
      if (isRecord(item)) {
        addMap(item, origin)
        continue
      }
      const path = insideRoot(root, item)
      if (path !== null) addMap(readJsonValue(path), path)
    }
  return [...servers.values()]
}

// Rules from Claude Code's plugins reference (docs/skill-scanner.md, Plugin components): the
// `agents` and `commands` keys replace their default directory, while hooks, MCP, and LSP merge
// with their default file. A marketplace entry is the manifest when plugin.json is absent.
export function resolvePluginComponents(
  root: string,
  entry: MarketplaceEntryRef | null
): PluginComponentsRead {
  try {
    const manifestPath = join(root, '.claude-plugin', 'plugin.json')
    const manifestRead = readJson(manifestPath)
    if (manifestRead.status === 'unavailable') throw new Unavailable()
    const hasManifest = manifestRead.status !== 'missing'
    const manifest = isRecord(manifestRead.value) ? manifestRead.value : {}

    const own = (key: string): Declaration[] =>
      manifest[key] === undefined ? [] : [{ value: manifest[key], origin: manifestPath }]
    const fromEntry = (key: string): Declaration[] =>
      entry === null || entry.value[key] === undefined
        ? []
        : [{ value: entry.value[key], origin: entry.path }]
    // A strict entry (the default) appends to plugin.json; a non-strict one may not add these.
    const appends = !hasManifest || entry?.value.strict !== false
    const appended = (key: string): Declaration[] => [
      ...own(key),
      ...(appends ? fromEntry(key) : [])
    ]

    return {
      status: 'ok',
      components: [
        ...resolveAgents(root, appended('agents')),
        ...resolveCommands(root, appended('commands')),
        ...resolveMcp(root, [...own('mcpServers'), ...fromEntry('mcpServers')]),
        // An entry's hooks load only in the inline object form.
        ...resolveHooks(root, [
          ...own('hooks'),
          ...(appends && isRecord(entry?.value.hooks) ? fromEntry('hooks') : [])
        ]),
        ...resolveLsp(root, [...own('lspServers'), ...fromEntry('lspServers')])
      ]
    }
  } catch (error) {
    if (error instanceof Unavailable) return { status: 'unavailable', components: [] }
    throw error
  }
}

import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths, revokePath } from '../permissions'
import { resolvePluginComponents, type ResolvedComponent } from './plugin-components'

let tmpDir: string
let root: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-components-'))
  root = join(tmpDir, 'plugin')
  mkdirSync(root)
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

// Values that aren't strings are written as JSON, so a fixture reads like the plugin it mirrors.
function write(files: Record<string, unknown>): void {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  }
}

function md(frontmatter: Record<string, string>): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\nBody`
}

function resolve(entry: Record<string, unknown> | null = null): ResolvedComponent[] {
  const result = resolvePluginComponents(
    root,
    entry && { value: entry, path: join(tmpDir, 'marketplace.json') }
  )
  expect(result.status).toBe('ok')
  return result.components
}

function names(components: ResolvedComponent[], kind: ResolvedComponent['kind']): string[] {
  return components
    .filter((component) => component.kind === kind)
    .map((component) => component.name)
    .sort()
}

describe('agents', () => {
  it('scans agents/ recursively, joining subfolders with colons', () => {
    write({
      'agents/reviewer.md': md({ description: 'Reviews code' }),
      'agents/review/security.md': md({ name: 'audit' }),
      'agents/deep/er/tester.md': md({}),
      'agents/reviewer.md.tmpl': md({}),
      'agents/openai.yaml': 'name: x'
    })

    const components = resolve()

    expect(names(components, 'agent')).toEqual(['deep:er:tester', 'review:audit', 'reviewer'])
    expect(components.find((c) => c.name === 'reviewer')).toEqual({
      kind: 'agent',
      name: 'reviewer',
      detail: 'Reviews code',
      source_path: join(root, 'agents', 'reviewer.md')
    })
  })

  it('falls back to the file name when frontmatter name exceeds 256 characters', () => {
    write({ 'agents/long.md': md({ name: 'x'.repeat(257) }) })

    expect(names(resolve(), 'agent')).toEqual(['long'])
  })

  it('replaces the default scan with the manifest key, dropping subfolder names', () => {
    write({
      '.claude-plugin/plugin.json': {
        name: 'p',
        agents: ['./custom/review/security.md', './custom', '../outside.md', './missing.md']
      },
      'custom/review/security.md': md({}),
      'agents/default.md': md({})
    })
    writeFileSync(join(tmpDir, 'outside.md'), md({}))

    expect(names(resolve(), 'agent')).toEqual(['security'])
  })

  it('accepts a single path string for the manifest key', () => {
    write({
      '.claude-plugin/plugin.json': { name: 'p', agents: './a/one.md' },
      'a/one.md': md({})
    })

    expect(names(resolve(), 'agent')).toEqual(['one'])
  })
})

describe('commands', () => {
  it('scans commands/ recursively with colon segments and frontmatter descriptions', () => {
    write({
      'commands/deploy.md': md({ description: 'Deploy it' }),
      'commands/db/migrate.md': md({}),
      'commands/help.toml': 'x'
    })

    const components = resolve()

    expect(names(components, 'command')).toEqual(['db:migrate', 'deploy'])
    expect(components.find((c) => c.name === 'deploy')?.detail).toBe('Deploy it')
  })

  it('replaces the default scan with a manifest array (vercel shape)', () => {
    write({
      '.claude-plugin/plugin.json': {
        name: 'vercel',
        commands: ['./commands/deploy.md', './commands/env.md']
      },
      'commands/deploy.md': md({}),
      'commands/env.md': md({}),
      'commands/_conventions.md': '# Conventions'
    })

    expect(names(resolve(), 'command')).toEqual(['deploy', 'env'])
  })

  it('scans a manifest directory path recursively', () => {
    write({
      '.claude-plugin/plugin.json': { name: 'p', commands: ['./commands/', './extras'] },
      'commands/a.md': md({}),
      'extras/sub/b.md': md({})
    })

    expect(names(resolve(), 'command')).toEqual(['a', 'sub:b'])
  })

  it('reads an object map with source and content entries', () => {
    write({
      '.claude-plugin/plugin.json': {
        name: 'p',
        commands: {
          status: { source: './commands/status.md', argumentHint: '[env]' },
          about: { content: 'Explain this plugin.', description: 'About it' },
          broken: { source: './nope.md' }
        }
      },
      'commands/status.md': md({ description: 'Show status' })
    })

    const components = resolve()

    expect(names(components, 'command')).toEqual(['about', 'status'])
    expect(components.find((c) => c.name === 'status')).toMatchObject({
      detail: 'Show status',
      source_path: join(root, 'commands', 'status.md')
    })
    expect(components.find((c) => c.name === 'about')).toMatchObject({
      detail: 'About it',
      source_path: join(root, '.claude-plugin', 'plugin.json')
    })
  })
})

describe('MCP servers', () => {
  it('reads a wrapped .mcp.json, storing only the transport and URL host', () => {
    write({
      '.mcp.json': {
        mcpServers: {
          vercel: {
            type: 'http',
            url: 'https://user:secret@mcp.vercel.com:8443/path?token=abc',
            headers: { Authorization: 'Bearer secret' }
          }
        }
      }
    })

    expect(resolve()).toEqual([
      {
        kind: 'mcp',
        name: 'vercel',
        detail: 'http · mcp.vercel.com:8443',
        source_path: join(root, '.mcp.json')
      }
    ])
  })

  it('reads a flat .mcp.json, storing only the command basename for stdio', () => {
    write({
      '.mcp.json': {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--key=secret'] },
        local: { command: '${CLAUDE_PLUGIN_ROOT}/bin/server', env: { TOKEN: 'secret' } },
        inline: { command: 'node --token=secret/abc server.js' },
        windows: { command: 'C:\\tools\\srv.exe' }
      }
    })

    const details = Object.fromEntries(resolve().map((c) => [c.name, c.detail]))

    expect(details).toEqual({
      playwright: 'stdio · npx',
      local: 'stdio · server',
      inline: 'stdio · node',
      windows: 'stdio · srv.exe'
    })
  })

  it('never stores a host it cannot parse', () => {
    write({ '.mcp.json': { api: { type: 'sse', url: '${API_URL}/mcp' } } })

    expect(resolve()[0].detail).toBe('sse')
  })

  it('merges the manifest key after .mcp.json, a later name replacing an earlier one', () => {
    write({
      '.mcp.json': { mcpServers: { shared: { command: 'old' }, kept: { command: 'kept' } } },
      '.claude-plugin/plugin.json': {
        name: 'p',
        mcpServers: ['./mcp/servers.json', { shared: { command: 'new' } }]
      },
      'mcp/servers.json': { mcpServers: { extra: { type: 'http', url: 'https://x.dev' } } }
    })

    const components = resolve()

    expect(Object.fromEntries(components.map((c) => [c.name, c.detail]))).toEqual({
      shared: 'stdio · new',
      kept: 'stdio · kept',
      extra: 'http · x.dev'
    })
    expect(components.find((c) => c.name === 'shared')?.source_path).toBe(
      join(root, '.claude-plugin', 'plugin.json')
    )
  })

  it('names an unextracted bundle after its file', () => {
    write({
      '.claude-plugin/plugin.json': {
        name: 'p',
        mcpServers: ['./bundles/server.mcpb', 'https://example.com/dl/other.dxt']
      },
      'bundles/server.mcpb': 'zip'
    })

    expect(resolve().map((c) => [c.name, c.detail])).toEqual([
      ['server', 'bundle'],
      ['other', 'bundle']
    ])
  })

  it('names an extracted bundle from its cached manifest, as Claude Code 2.1.322 does', () => {
    const declared = './bundles/server.mcpb'
    const hash = createHash('md5').update(declared).digest('hex').slice(0, 8)
    const extractedPath = join(root, '.mcpb-cache', 'abc123')
    write({
      '.claude-plugin/plugin.json': { name: 'p', mcpServers: declared },
      'bundles/server.mcpb': 'zip',
      [`.mcpb-cache/${hash}.metadata.json`]: { extractedPath, cachedAt: 'x', lastChecked: 'x' },
      '.mcpb-cache/abc123/manifest.json': { name: 'real-server' }
    })

    expect(resolve().map((c) => [c.name, c.detail])).toEqual([['real-server', 'bundle']])
  })
})

describe('hooks', () => {
  it('merges hooks/hooks.json with every manifest form', () => {
    write({
      'hooks/hooks.json': { hooks: { PostToolUse: [{ hooks: [] }], Stop: [{ hooks: [] }] } },
      '.claude-plugin/plugin.json': {
        name: 'p',
        hooks: ['./config/extra.json', { SessionStart: [{ hooks: [] }] }, './config/bare.json']
      },
      'config/extra.json': { hooks: { UserPromptSubmit: [{ hooks: [] }] } },
      // An event map without the "hooks" wrapper fails to load in Claude Code.
      'config/bare.json': { Notification: [{ hooks: [] }] }
    })

    expect(names(resolve(), 'hook')).toEqual([
      'PostToolUse',
      'SessionStart',
      'Stop',
      'UserPromptSubmit'
    ])
  })

  it('accepts a single manifest path (ponytail shape)', () => {
    write({
      '.claude-plugin/plugin.json': { name: 'p', hooks: './hooks/claude-codex-hooks.json' },
      'hooks/claude-codex-hooks.json': { hooks: { SessionStart: [{ hooks: [] }] } }
    })

    expect(names(resolve(), 'hook')).toEqual(['SessionStart'])
  })
})

describe('LSP servers', () => {
  it('merges a flat .lsp.json with the manifest key, keeping extensions', () => {
    write({
      '.lsp.json': { gopls: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
      '.claude-plugin/plugin.json': {
        name: 'p',
        lspServers: { rust: { command: 'ra', extensionToLanguage: { '.rs': 'rust' } } }
      }
    })

    expect(resolve().map((c) => [c.name, c.detail])).toEqual([
      ['gopls', '.go'],
      ['rust', '.rs']
    ])
  })
})

describe('marketplace entry', () => {
  it('is the manifest when the plugin has no plugin.json (typescript-lsp shape)', () => {
    write({ README: 'x' })

    const components = resolve({
      name: 'typescript-lsp',
      strict: false,
      lspServers: {
        typescript: {
          command: 'typescript-language-server',
          extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' }
        }
      }
    })

    expect(components).toEqual([
      {
        kind: 'lsp',
        name: 'typescript',
        detail: '.ts .tsx',
        source_path: join(tmpDir, 'marketplace.json')
      }
    ])
  })

  it('appends agents and commands to a strict plugin.json', () => {
    write({
      '.claude-plugin/plugin.json': { name: 'p', agents: ['./a/one.md'] },
      'a/one.md': md({}),
      'a/two.md': md({}),
      'commands/c.md': md({})
    })

    const components = resolve({ name: 'p', agents: ['./a/two.md'], commands: ['./commands/c.md'] })

    expect(names(components, 'agent')).toEqual(['one', 'two'])
    expect(names(components, 'command')).toEqual(['c'])
  })

  it('appends nothing when strict is false, but still merges MCP and LSP servers', () => {
    write({
      '.claude-plugin/plugin.json': { name: 'p' },
      'agents/one.md': md({}),
      'a/two.md': md({})
    })

    const components = resolve({
      name: 'p',
      strict: false,
      agents: ['./a/two.md'],
      mcpServers: { remote: { type: 'http', url: 'https://r.dev' } }
    })

    expect(names(components, 'agent')).toEqual(['one'])
    expect(names(components, 'mcp')).toEqual(['remote'])
  })
})

describe('scan integrity', () => {
  it('reports unavailable when the plugin root cannot be read', () => {
    write({ 'agents/a.md': md({}) })
    revokePath(tmpDir)

    expect(resolvePluginComponents(root, null).status).toBe('unavailable')
  })

  it('treats a malformed config file as declaring nothing', () => {
    write({ '.mcp.json': '{not json', 'hooks/hooks.json': '{' })

    expect(resolve()).toEqual([])
  })
})

import { mkdirSync } from 'fs'
import { join } from 'path'
import type {
  ContextBaselineResult,
  ContextCategory,
  ContextCategoryGroup,
  ContextSection,
  ContextUsage
} from '../shared/ipc'
import { runClaude } from './claude-process'

// `--no-session-persistence` keeps the run out of ~/.claude/projects; /context is computed
// locally, so the run makes no API call and costs nothing (docs/usage-analytics.md).
const CONTEXT_ARGS = ['-p', '/context', '--output-format', 'json', '--no-session-persistence']
const CONTEXT_TIMEOUT_MS = 60_000
const CONTEXT_TIMEOUT_MESSAGE =
  "Claude Code's /context did not finish within 60 seconds. A slow MCP server or SessionStart " +
  'hook can hold it up.'
// /context lists every deferred MCP tool, one row each — far past execFile's 1 MB default.
const CONTEXT_MAX_BUFFER = 10 * 1024 * 1024
const UNREADABLE_OUTPUT_MESSAGE = "Megatron couldn't read Claude Code's /context output."

function parseTokenCell(cell: string): number | null {
  const match = /^(?:~|<\s*)?(\d+(?:\.\d+)?)\s*([km])?$/i.exec(cell.trim())
  if (match === null) return null
  const scale = match[2] === undefined ? 1 : match[2].toLowerCase() === 'k' ? 1_000 : 1_000_000
  return Math.round(Number(match[1]) * scale)
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseSections(markdown: string): ContextSection[] {
  const sections: ContextSection[] = []
  let current: ContextSection | null = null
  for (const line of markdown.split('\n')) {
    if (line.startsWith('### ')) {
      current = { title: line.slice(4).trim(), columns: [], rows: [] }
      sections.push(current)
      continue
    }
    if (current === null || !line.trim().startsWith('|')) continue
    const cells = splitRow(line)
    if (current.columns.length === 0) {
      current.columns = cells
      continue
    }
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    const tokensIndex = current.columns.findIndex((column) => column.toLowerCase() === 'tokens')
    current.rows.push({
      cells,
      tokens: tokensIndex === -1 ? null : parseTokenCell(cells[tokensIndex] ?? '')
    })
  }
  return sections.filter((section) => section.columns.length > 0)
}

function categoryGroup(name: string): ContextCategoryGroup {
  const key = name.trim().toLowerCase()
  if (key.endsWith('(deferred)')) return 'deferred'
  if (key === 'free space') return 'free'
  if (key === 'autocompact buffer') return 'buffer'
  return 'used'
}

export function parseContextMarkdown(markdown: string): ContextUsage | null {
  const model = /\*\*Model:\*\*\s*(.+?)\s*$/m.exec(markdown)?.[1]
  const tokens = /\*\*Tokens:\*\*\s*(\S+)\s*\/\s*(\S+)\s*\(([^)]+)\)/.exec(markdown)
  if (model === undefined || tokens === null) return null
  const totalTokens = parseTokenCell(tokens[1])
  const windowTokens = parseTokenCell(tokens[2])
  if (totalTokens === null || windowTokens === null) return null

  const sections = parseSections(markdown)
  const categoryTable = sections.find(
    (section) =>
      section.columns[0]?.toLowerCase() === 'category' &&
      section.columns.some((column) => column.toLowerCase() === 'tokens')
  )
  if (categoryTable === undefined) return null
  const tokensIndex = categoryTable.columns.findIndex((column) => column.toLowerCase() === 'tokens')

  const categories: ContextCategory[] = categoryTable.rows.flatMap((row) => {
    const display = row.cells[tokensIndex] ?? ''
    const value = parseTokenCell(display)
    const name = row.cells[0] ?? ''
    return value === null || name === ''
      ? []
      : [{ name, display, tokens: value, group: categoryGroup(name) }]
  })
  if (categories.length === 0) return null

  return {
    model,
    totalDisplay: tokens[1],
    totalTokens,
    windowDisplay: tokens[2],
    windowTokens,
    percentDisplay: tokens[3].trim(),
    categories,
    sections: sections.filter((section) => section !== categoryTable)
  }
}

async function measure(userDataDir: string): Promise<ContextBaselineResult> {
  // A fixed empty folder, so the measurement is the global baseline: no project CLAUDE.md,
  // project skills, or project MCP servers ride along.
  const cwd = join(userDataDir, 'context-baseline')
  mkdirSync(cwd, { recursive: true })
  const run = await runClaude(CONTEXT_ARGS, {
    cwd,
    timeoutMs: CONTEXT_TIMEOUT_MS,
    timeoutMessage: CONTEXT_TIMEOUT_MESSAGE,
    maxBuffer: CONTEXT_MAX_BUFFER
  })
  if (!run.ok) return { ok: false, error: run.error }

  let envelope: unknown
  try {
    envelope = JSON.parse(run.stdout)
  } catch {
    return { ok: false, error: UNREADABLE_OUTPUT_MESSAGE, raw: run.stdout.trim() }
  }
  const result =
    typeof envelope === 'object' && envelope !== null
      ? (envelope as { is_error?: unknown; result?: unknown })
      : {}
  if (result.is_error === true) {
    return {
      ok: false,
      error: typeof result.result === 'string' ? result.result : UNREADABLE_OUTPUT_MESSAGE
    }
  }
  if (typeof result.result !== 'string') {
    return { ok: false, error: UNREADABLE_OUTPUT_MESSAGE, raw: run.stdout.trim() }
  }
  const usage = parseContextMarkdown(result.result)
  return usage === null
    ? { ok: false, error: UNREADABLE_OUTPUT_MESSAGE, raw: result.result }
    : { ok: true, usage, measuredAt: new Date().toISOString() }
}

let inFlight: Promise<ContextBaselineResult> | null = null

// The panel's first open and a Refresh can overlap; one CLI run (≈4 s, starts MCP servers and
// SessionStart hooks) serves both.
export function measureContextBaseline(userDataDir: string): Promise<ContextBaselineResult> {
  inFlight ??= measure(userDataDir).finally(() => {
    inFlight = null
  })
  return inFlight
}

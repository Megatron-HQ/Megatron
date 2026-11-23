import type Database from 'better-sqlite3'
import { CHARS_PER_TOKEN } from '../ingest/skill-parser'
import { groupProjectCounts } from '../../shared/usage-projects'
import type { ProjectIdentity } from '../../shared/project-identity'
import type {
  McpUsageServerRow,
  McpUsageStats,
  McpUsageWindow,
  SkillStatsWindowKey
} from '../../shared/ipc'
import { mcpCallOwners, type McpCallOwner } from './mcp-queries'
import { buildSkillTrend } from './queries'
import { knownMcpCallsSql, usageHistorySince } from './known-calls'

// Usage → MCP servers: calls in rolling windows, credited exactly as the MCP section credits them
// (docs/mcp-servers.md, Usage panel).

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOWS: { key: SkillStatsWindowKey; days: number }[] = [
  { key: '24h', days: 1 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 }
]
const LONGEST_WINDOW_DAYS = 30

interface CallRow {
  qualified_name: string
  session_id: string
  project: string
  invoked_at: string
  is_error: number | null
  is_denied: number | null
  result_chars: number | null
}

interface ServerTally {
  owner: McpCallOwner
  calls: number
  errors: number
  denied: number
  chars: number
}

const isDenied = (row: CallRow): boolean => row.is_denied === 1
const isError = (row: CallRow): boolean => row.is_error === 1 && !isDenied(row)
const estimatedTokens = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN)

function readCalls(db: Database.Database, since: string): CallRow[] {
  return db
    .prepare(
      `SELECT c.qualified_name, c.session_id, c.project, c.invoked_at, c.is_error, c.is_denied,
         c.result_chars
       FROM ${knownMcpCallsSql(db)} c
       WHERE c.invoked_at >= ? AND c.project IS NOT NULL`
    )
    .all(since) as CallRow[]
}

function toServerRow({ owner, calls, errors, denied, chars }: ServerTally): McpUsageServerRow {
  const answered = calls - denied
  return {
    ...owner,
    calls,
    errors,
    denied,
    errorRate: answered > 0 ? errors / answered : null,
    resultTokens: estimatedTokens(chars)
  }
}

function rankServers(
  rows: CallRow[],
  owners: Map<string, McpCallOwner | 'ambiguous'>
): McpUsageServerRow[] {
  const tallies = new Map<string, ServerTally>()
  for (const row of rows) {
    const owner = owners.get(row.qualified_name)
    if (owner === undefined || owner === 'ambiguous') continue
    const tally = tallies.get(owner.id) ?? { owner, calls: 0, errors: 0, denied: 0, chars: 0 }
    tally.calls += 1
    if (isError(row)) tally.errors += 1
    if (isDenied(row)) tally.denied += 1
    tally.chars += row.result_chars ?? 0
    tallies.set(owner.id, tally)
  }
  return [...tallies.values()]
    .map(toServerRow)
    .sort((first, second) => second.calls - first.calls || first.name.localeCompare(second.name))
}

function countByProject(rows: CallRow[], identity: ProjectIdentity): McpUsageWindow['byProject'] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.project, (counts.get(row.project) ?? 0) + 1)
  return groupProjectCounts(
    [...counts].map(([project, count]) => ({ project, count })),
    identity
  )
}

function reduceWindow(
  calls: CallRow[],
  owners: Map<string, McpCallOwner | 'ambiguous'>,
  identity: ProjectIdentity,
  now: Date,
  key: SkillStatsWindowKey,
  days: number
): McpUsageWindow {
  const startAt = new Date(now.getTime() - days * DAY_MS).toISOString()
  const rows = calls.filter((row) => row.invoked_at >= startAt)
  const byServer = rankServers(rows, owners)
  return {
    window: key,
    startAt,
    endAt: new Date(now.getTime() + 1).toISOString(),
    calls: rows.length,
    errors: rows.filter(isError).length,
    denied: rows.filter(isDenied).length,
    resultTokens: estimatedTokens(rows.reduce((sum, row) => sum + (row.result_chars ?? 0), 0)),
    serverCount: byServer.length,
    sessionCount: new Set(rows.map((row) => row.session_id)).size,
    ambiguousCalls: rows.filter((row) => owners.get(row.qualified_name) === 'ambiguous').length,
    trend: buildSkillTrend(rows, now, key, days),
    byServer,
    byProject: countByProject(rows, identity)
  }
}

export function getMcpUsageStats(
  db: Database.Database,
  identity: ProjectIdentity,
  now: Date = new Date()
): McpUsageStats {
  const calls = readCalls(db, new Date(now.getTime() - LONGEST_WINDOW_DAYS * DAY_MS).toISOString())
  const owners = mcpCallOwners(db)
  const [last24h, last7d, last30d] = WINDOWS.map(({ key, days }) =>
    reduceWindow(calls, owners, identity, now, key, days)
  )
  return { callsSince: usageHistorySince(db), last24h, last7d, last30d }
}

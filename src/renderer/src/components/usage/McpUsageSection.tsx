import { useReducedMotion } from 'motion/react'
import { ChartBlock } from './ChartBlock'
import { InvocationTrend } from './InvocationTrend'
import { ProjectRankedList } from './ProjectRankedList'
import { RankedList } from './RankedList'
import { WindowStat } from './SkillsSection'
import { formatCount } from './chart-utils'
import { TextLink } from '@/components/TextLink'
import { WhatsNewDot } from '@/components/whats-new/WhatsNewDot'
import { anchorProps } from '@/lib/whats-new'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import type {
  McpUsageServerRow,
  McpUsageStats,
  McpUsageWindow,
  SkillStatsWindowKey
} from '../../../../shared/ipc'

const STAT_ROW =
  'grid grid-cols-2 items-start gap-x-10 gap-y-4 @min-[48rem]:flex @min-[48rem]:flex-wrap'
const STAT_DIVIDER = 'mt-1 hidden h-9 w-px bg-border @min-[48rem]:block'

const WINDOW_LABELS: Record<SkillStatsWindowKey, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days'
}

function selectedWindow(stats: McpUsageStats, key: SkillStatsWindowKey): McpUsageWindow {
  if (key === '24h') return stats.last24h
  if (key === '7d') return stats.last7d
  return stats.last30d
}

function formatErrorRate(rate: number | null): string {
  if (rate === null) return '—'
  if (rate > 0 && rate < 0.001) return '<0.1%'
  return `${(rate * 100).toFixed(1)}%`
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function McpUsageSection({
  stats,
  windowKey,
  onSelectServer,
  resolveProjectLabel
}: {
  stats: McpUsageStats
  windowKey: SkillStatsWindowKey
  onSelectServer: (id: string) => void
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const window = selectedWindow(stats, windowKey)
  const empty = window.calls === 0
  const emptyMessage = `No MCP tool calls in the last ${WINDOW_LABELS[windowKey]}`
  // Transcripts Claude Code has pruned take their calls with them (docs/mcp-servers.md, Retention).
  const truncatedSince =
    stats.callsSince !== null && stats.callsSince > window.startAt ? stats.callsSince : null

  return (
    <section className="flex flex-col gap-6 py-8">
      {/* Four stats outgrow one row at the minimum window, and a wrapped row would strand a
          divider, so a narrow panel lays them out two by two without dividers. */}
      <div className="@container">
        <div className={STAT_ROW}>
          <WindowStat
            label="Calls"
            value={window.calls}
            window={windowKey}
            reduceMotion={reduceMotion}
          />
          <span aria-hidden className={STAT_DIVIDER} />
          <WindowStat
            label="Servers used"
            value={window.serverCount}
            window={windowKey}
            reduceMotion={reduceMotion}
          />
          <span aria-hidden className={STAT_DIVIDER} />
          <WindowStat
            label="Errors"
            value={window.errors}
            window={windowKey}
            reduceMotion={reduceMotion}
          />
          <span aria-hidden className={STAT_DIVIDER} />
          <WindowStat
            label="Result tokens (est.)"
            value={window.resultTokens}
            window={windowKey}
            reduceMotion={reduceMotion}
          />
        </div>
      </div>
      {truncatedSince !== null && (
        <p className="-mt-3 text-[11px] text-muted-foreground">
          Calls since {formatShortDate(truncatedSince)}, when Megatron&rsquo;s record of them
          begins.
        </p>
      )}

      <ChartBlock label="Calls over time" empty={empty} emptyMessage={emptyMessage}>
        <InvocationTrend data={window.trend} window={windowKey} nounSingular="MCP call" />
      </ChartBlock>

      <div className="flex flex-col gap-2" {...anchorProps('usage-mcp')}>
        <ChartBlock
          label="Top servers"
          labelAdornment={<WhatsNewDot anchor="usage-mcp" />}
          empty={window.byServer.length === 0}
          emptyMessage={emptyMessage}
        >
          <RankedList
            items={window.byServer.map((server) => ({
              id: server.id,
              label: server.name,
              fullLabel: server.name,
              value: server.calls,
              actionLabel: `Open ${server.name} detail`,
              onSelect: () => onSelectServer(server.id)
            }))}
            formatValue={formatCount}
            noun="servers"
          />
        </ChartBlock>
        {window.ambiguousCalls > 0 && (
          <p className="max-w-[620px] text-[11px] text-muted-foreground">
            {formatCount(window.ambiguousCalls)}{' '}
            {window.ambiguousCalls === 1 ? 'call uses' : 'calls use'} a tool name two servers share,
            so neither server is credited with {window.ambiguousCalls === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      <ChartBlock
        label="Errors and result weight"
        empty={window.byServer.length === 0}
        emptyMessage={emptyMessage}
      >
        <McpServerTable rows={window.byServer} onSelectServer={onSelectServer} />
      </ChartBlock>

      <ChartBlock label="By project" empty={empty} emptyMessage={emptyMessage}>
        <ProjectRankedList
          items={window.byProject.map((project) => ({
            label: resolveProjectLabel(project.project),
            value: project.count,
            fullLabel: project.project
          }))}
          formatValue={formatCount}
          noun="projects"
        />
      </ChartBlock>
    </section>
  )
}

function McpServerTable({
  rows,
  onSelectServer
}: {
  rows: McpUsageServerRow[]
  onSelectServer: (id: string) => void
}): React.JSX.Element {
  const numeric = 'text-right font-mono text-[12px] tabular-nums'
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[620px] text-[11px] text-muted-foreground">
        Error rate counts failed calls among those that weren&apos;t refused; refusals by your
        permission rules or auto mode are counted apart. Result tokens are estimated from the size
        of what each tool returned.
      </p>
      <div className="overflow-x-auto">
        {/* No minimum width: at the minimum window a sideways scroll would hide Result tokens,
            so the number columns stay slim (~350px) and the Server column takes the rest. */}
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="h-7 border-b border-border text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              <th className="pr-4 font-medium">Server</th>
              <th className="w-14 text-right font-medium">Calls</th>
              <th className="w-14 text-right font-medium">Errors</th>
              <th className="w-20 text-right font-medium">Error rate</th>
              <th className="w-16 text-right font-medium">Refused</th>
              <th className="w-28 text-right font-medium">Result tokens</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="h-8 border-b border-border last:border-b-0">
                <td className="max-w-0 pr-4">
                  <TextLink
                    className="min-w-0 text-[13px]"
                    aria-label={`Open ${row.name} detail`}
                    onClick={() => onSelectServer(row.id)}
                  >
                    <span className="truncate" title={row.name}>
                      {row.name}
                    </span>
                  </TextLink>
                </td>
                <td className={`${numeric} text-foreground`}>{formatCount(row.calls)}</td>
                <td className={`${numeric} text-muted-foreground`}>{formatCount(row.errors)}</td>
                <td className={`${numeric} text-muted-foreground`}>
                  {formatErrorRate(row.errorRate)}
                </td>
                <td className={`${numeric} text-muted-foreground`}>{formatCount(row.denied)}</td>
                <td className={`${numeric} text-muted-foreground`}>
                  {formatCount(row.resultTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

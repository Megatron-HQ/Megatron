import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FolderOpen, Info, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import { EntityGlyph } from '@/components/EntityGlyph'
import { GlideTitle } from '@/components/GlideTitle'
import { McpStatusBadge } from '@/components/McpBadges'
import { ProjectName } from '@/components/ProjectName'
import { TextLink } from '@/components/TextLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { mcpSourceLabel } from '@/lib/mcp-filter'
import { formatRelativeTime } from '@/lib/relative-time'
import { mcpTitleGlideId, useSettle } from '@/lib/transitions'
import { useProjectLabel } from '@/lib/use-project-label'
import { cn } from '@/lib/utils'
import type {
  McpDeclarationDetail,
  McpDeclarationScope,
  McpLintFinding,
  McpServerDetail,
  McpServerRow,
  McpShadow,
  McpToolUsage
} from '../../../shared/ipc'

const SCOPE_LABEL: Record<McpDeclarationScope, string> = {
  local: 'Local',
  project: 'Project',
  user: 'User',
  plugin: 'Plugin'
}

const APPROVAL_LABEL = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Waiting for approval'
} as const

interface McpDetailProps {
  id: string
  // From the list row, so the header and its title glide render before the query returns.
  summary?: McpServerRow
  onBack: () => void
}

export function McpDetail({ id, summary, onBack }: McpDetailProps): React.JSX.Element {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['mcp-detail', id],
    queryFn: () => window.api.getMcpServerDetail(id)
  })
  const settle = useSettle(isPending)
  const name = data?.server.name ?? summary?.name ?? id

  if (isPending || isError || !data) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <McpHeader id={id} name={name} server={summary} onBack={onBack} />
        {isPending ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <p>Could not load this server.</p>
            <TextLink onClick={() => void refetch()}>Retry</TextLink>
            <TextLink onClick={onBack}>Back</TextLink>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium">Server not found</p>
            <p className="max-w-[320px] text-sm text-muted-foreground">
              It may have been removed since the last scan.
            </p>
            <Button
              onClick={onBack}
              className="mt-2 bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90"
            >
              Back to MCP servers
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <McpHeader id={id} name={name} server={data.server} onBack={onBack} />
      <motion.div {...settle} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          <McpStats detail={data} />
          {data.server.ambiguousCalls > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {data.server.ambiguousCalls.toLocaleString()} more calls carry this server&apos;s tool
              prefix, which another server shares, so they count for neither.
            </p>
          )}
          <Findings findings={data.findings} />
          <Declarations serverId={id} declarations={data.declarations} />
          <SwitchedOff detail={data} />
          <Tools tools={data.tools} />
        </div>
      </motion.div>
    </div>
  )
}

function McpHeader({
  id,
  name,
  server,
  onBack
}: {
  id: string
  name: string
  server?: McpServerRow
  onBack: () => void
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label="Back to MCP servers"
        className="shrink-0 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
      </Button>
      <EntityGlyph entity="mcp" disabled={server?.pluginDisabled ?? false} />
      <GlideTitle
        as="h2"
        glideId={mcpTitleGlideId(id)}
        level="detail"
        className="min-w-0 truncate text-base font-semibold"
      >
        {name}
      </GlideTitle>
      {server && (
        <>
          <Badge
            variant="outline"
            className="shrink-0 text-[11px] font-normal text-muted-foreground"
          >
            {mcpSourceLabel(server)}
          </Badge>
          <McpStatusBadge server={server} />
        </>
      )}
    </div>
  )
}

function Caption({ label, count }: { label: string; count?: number }): React.JSX.Element {
  return (
    <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {label}
      {count !== undefined && ` · ${count.toLocaleString()}`}
    </h3>
  )
}

function Stat({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0" title={title}>
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="min-w-0 truncate font-mono text-xs tabular-nums">{value}</p>
    </div>
  )
}

function McpStats({ detail }: { detail: McpServerDetail }): React.JSX.Element {
  const { server, definitionTokens } = detail
  return (
    <Card className="py-4 shadow-none">
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 sm:grid-cols-5">
        <Stat label="Calls" value={server.calls === 0 ? 'None' : server.calls.toLocaleString()} />
        <Stat
          label="Errors"
          value={server.errors.toLocaleString()}
          title="Failures the server returned. Refusals by your permission rules are counted apart."
        />
        <Stat
          label="Refused"
          value={server.denied.toLocaleString()}
          title="Calls your permission rules or auto mode refused."
        />
        <Stat
          label="Last used"
          value={server.lastUsedAt ? formatRelativeTime(server.lastUsedAt) : 'Never'}
        />
        <Stat
          label="Definitions"
          value={
            definitionTokens ? `${definitionTokens.tokens.toLocaleString()} tokens` : 'Not measured'
          }
          title={
            definitionTokens
              ? "The size of this server's tool definitions in Claude Code's last /context run. With tool search on, they load only when used."
              : "Open Usage → Resident tax to measure the size of this server's tool definitions."
          }
        />
      </CardContent>
    </Card>
  )
}

function Findings({ findings }: { findings: McpLintFinding[] }): React.JSX.Element | null {
  if (findings.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Findings" count={findings.length} />
      <ul className="flex flex-col gap-1.5">
        {findings.map((finding, index) => {
          const Icon = finding.severity === 'warning' ? TriangleAlert : Info
          return (
            <li key={`${finding.ruleId}:${index}`} className="flex items-start gap-2 text-[13px]">
              <Icon
                aria-label={finding.severity === 'warning' ? 'Warning' : 'Notice'}
                className={cn(
                  'mt-0.5 size-3.5 shrink-0',
                  finding.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                )}
              />
              <span className="min-w-0 break-words">{finding.message}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function shadowText(shadow: McpShadow, label: (path: string) => string): string {
  const where = shadow.projectPath === null ? 'every project' : label(shadow.projectPath)
  return `${where} (${SCOPE_LABEL[shadow.byScope].toLowerCase()})`
}

function Declarations({
  serverId,
  declarations
}: {
  serverId: string
  declarations: McpDeclarationDetail[]
}): React.JSX.Element | null {
  const resolveProjectLabel = useProjectLabel()
  if (declarations.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Declarations" count={declarations.length} />
      <ul className="flex flex-col gap-2">
        {declarations.map((declaration, index) => {
          const keys = [
            ...declaration.env.map((key) => ({ ...key, kind: 'env' })),
            ...declaration.headers.map((key) => ({ ...key, kind: 'header' }))
          ]
          const where = [declaration.transport ?? 'skipped', declaration.location]
            .filter(Boolean)
            .join(' · ')
          return (
            <li
              key={`${declaration.scope}:${declaration.projectPath ?? ''}:${index}`}
              className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="shrink-0 font-medium">{SCOPE_LABEL[declaration.scope]}</span>
                {declaration.plugin && (
                  <span className="truncate text-muted-foreground">
                    {declaration.plugin.name}@{declaration.plugin.marketplace}
                  </span>
                )}
                {declaration.projectPath && (
                  <span title={declaration.projectPath} className="min-w-0 truncate">
                    <ProjectName label={resolveProjectLabel(declaration.projectPath)} />
                  </span>
                )}
                {declaration.approval && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[11px] font-normal text-muted-foreground"
                  >
                    {APPROVAL_LABEL[declaration.approval]}
                  </Badge>
                )}
                {declaration.sourcePath && (
                  <TextLink
                    onClick={() =>
                      void window.api.revealMcpSource(serverId, declaration.sourcePath!)
                    }
                    title={declaration.sourcePath}
                    className="ml-auto flex shrink-0 items-center gap-1 text-[11px]"
                  >
                    <FolderOpen aria-hidden="true" className="size-3" />
                    Reveal file
                  </TextLink>
                )}
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={where}>
                {where}
                {declaration.argCount !== null &&
                  declaration.argCount > 0 &&
                  ` · ${declaration.argCount} ${declaration.argCount === 1 ? 'arg' : 'args'}`}
              </p>
              {keys.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {keys.map((key) => (
                    <Badge
                      key={`${key.kind}:${key.name}`}
                      variant="outline"
                      title={
                        key.literal
                          ? `${key.kind === 'env' ? 'Environment variable' : 'Header'} with a value written into the file`
                          : `${key.kind === 'env' ? 'Environment variable' : 'Header'} read from \${VAR}`
                      }
                      className="font-mono text-[11px] font-normal text-muted-foreground"
                    >
                      {key.name}
                      {key.literal && <span className="text-warning"> literal</span>}
                    </Badge>
                  ))}
                </div>
              )}
              {declaration.shadowedIn.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Loses in{' '}
                  {declaration.shadowedIn
                    .map((shadow) => shadowText(shadow, resolveProjectLabel))
                    .join(', ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SwitchedOff({ detail }: { detail: McpServerDetail }): React.JSX.Element | null {
  const resolveProjectLabel = useProjectLabel()
  const places = [
    ...detail.disabledIn.map((path) => ({
      key: `server:${path}`,
      text: resolveProjectLabel(path)
    })),
    ...detail.connectorsDisabledIn.map((path) => ({
      key: `connectors:${path}`,
      text:
        path === ''
          ? 'Every project: claude.ai connectors are off in user settings'
          : `${resolveProjectLabel(path)}: claude.ai connectors are off`
    }))
  ]
  if (places.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Switched off" count={places.length} />
      <ul className="flex flex-col gap-1 text-[13px]">
        {places.map((place) => (
          <li key={place.key} className="truncate">
            {place.text}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Tools({ tools }: { tools: McpToolUsage[] }): React.JSX.Element | null {
  if (tools.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Tools used" count={tools.length} />
      <div className="overflow-hidden rounded-md bg-muted px-3 py-2">
        <table className="w-full table-fixed text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-auto py-1 font-medium">Tool</th>
              <th className="w-[70px] py-1 text-right font-medium">Calls</th>
              <th className="w-[70px] py-1 text-right font-medium">Errors</th>
              <th className="w-[70px] py-1 text-right font-medium max-[1000px]:hidden">Refused</th>
              <th
                className="w-[100px] py-1 text-right font-medium"
                title="Estimated from the characters each call returned"
              >
                Returned
              </th>
              {/* Wide enough for "59 minutes ago" in mono, so a row never wraps to two lines. */}
              <th className="w-[130px] py-1 text-right font-medium max-[1000px]:hidden">
                Last used
              </th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {tools.map((tool) => (
              <tr key={tool.tool}>
                <td className="truncate py-1" title={tool.tool}>
                  {tool.tool}
                </td>
                <td className="py-1 text-right">{tool.calls.toLocaleString()}</td>
                <td className="py-1 text-right">{tool.errors.toLocaleString()}</td>
                <td className="py-1 text-right max-[1000px]:hidden">
                  {tool.denied.toLocaleString()}
                </td>
                <td className="py-1 text-right" title={`${tool.resultImages} images`}>
                  ~{tool.resultTokens.toLocaleString()} tok
                </td>
                <td className="truncate py-1 text-right whitespace-nowrap max-[1000px]:hidden">
                  {tool.lastUsedAt ? formatRelativeTime(tool.lastUsedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

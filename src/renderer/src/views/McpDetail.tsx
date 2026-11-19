import { useState } from 'react'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { motion } from 'motion/react'
import { EntityGlyph } from '@/components/EntityGlyph'
import { GlideTitle } from '@/components/GlideTitle'
import { McpConnectionBadge, McpStatusBadge } from '@/components/McpBadges'
import { ProjectName } from '@/components/ProjectName'
import { TextLink } from '@/components/TextLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  McpActionError,
  mcpActionMessage,
  mcpDeclarationActions,
  mcpDeclarationRef
} from '@/lib/mcp-action'
import { MCP_USAGE_QUERY_KEY } from '@/lib/mcp-usage-query'
import { mcpSourceLabel } from '@/lib/mcp-filter'
import { formatRelativeTime } from '@/lib/relative-time'
import { mcpTitleGlideId, useSettle } from '@/lib/transitions'
import { useProjectLabel } from '@/lib/use-project-label'
import { cn } from '@/lib/utils'
import type {
  McpDeclarationDetail,
  McpDeclarationRef,
  McpDeclarationScope,
  McpLintFinding,
  McpServerDetail,
  McpServerRow,
  McpShadow,
  McpToolUsage
} from '../../../shared/ipc'

// One key for every MCP action: main runs one at a time, so the view disables them all together.
const MCP_ACTION_KEY = ['mcp-action'] as const
const CONNECTORS_PAGE = 'https://claude.ai/customize/connectors'

type McpActionKind = 'remove' | 'logout' | 'reset'

// cardKey ties a pending state or an error to the Declaration card it came from.
type McpActionVariables =
  | { kind: 'remove' | 'logout'; serverId: string; cardKey: string; ref: McpDeclarationRef }
  | { kind: 'reset'; serverId: string; cardKey: string; projectPath: string }

interface McpActionRequest {
  kind: McpActionKind
  declaration: McpDeclarationDetail
}

const PENDING_LABEL: Record<McpActionKind, string> = {
  remove: 'Removing…',
  logout: 'Logging out…',
  reset: 'Resetting…'
}

function cardKey(declaration: McpDeclarationDetail): string {
  return `${declaration.scope}:${declaration.projectPath ?? ''}`
}

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
  // Per-project connection checks (docs/mcp-servers.md, Live check), only from a granted folder.
  canCheckProject: (path: string) => boolean
  onCheckProject: (path: string) => void
  checkingProject: string | null
  projectCheckError: { projectPath: string | null; message: string } | null
  // MCP actions (docs/mcp-servers.md, Writes): a local or project one runs only from a granted
  // folder, the same rule the connection check follows.
  onActionSuccess: (message: string) => void
  onOpenPlugin: (name: string, marketplace: string) => void
  // A remove that took the server's last Declaration leaves nothing here to show.
  onServerGone: () => void
}

export function McpDetail({
  id,
  summary,
  onBack,
  canCheckProject,
  onCheckProject,
  checkingProject,
  projectCheckError,
  onActionSuccess,
  onOpenPlugin,
  onServerGone
}: McpDetailProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['mcp-detail', id],
    queryFn: () => window.api.getMcpServerDetail(id)
  })
  const settle = useSettle(isPending)
  const name = data?.server.name ?? summary?.name ?? id
  const [confirming, setConfirming] = useState<McpActionRequest | null>(null)

  const actionStates = useMutationState({
    filters: { mutationKey: MCP_ACTION_KEY, exact: true },
    select: (mutation) => ({
      status: mutation.state.status,
      variables: mutation.state.variables as McpActionVariables | undefined,
      error: mutation.state.error
    })
  })
  const latest = actionStates.at(-1)
  const anyPending = actionStates.some((state) => state.status === 'pending')
  const ownLatest = latest?.variables?.serverId === id ? latest : undefined
  const pending =
    ownLatest?.status === 'pending' && ownLatest.variables
      ? { cardKey: ownLatest.variables.cardKey, kind: ownLatest.variables.kind }
      : null
  const failure =
    ownLatest?.status === 'error' && ownLatest.variables
      ? {
          cardKey: ownLatest.variables.cardKey,
          message: ownLatest.error?.message ?? 'The action failed. Try again.',
          unconfirmed: ownLatest.error instanceof McpActionError && ownLatest.error.unconfirmed
        }
      : null

  const actionMutation = useMutation({
    mutationKey: MCP_ACTION_KEY,
    networkMode: 'always',
    retry: false,
    mutationFn: async (variables: McpActionVariables) => {
      try {
        const result =
          variables.kind === 'reset'
            ? await window.api.resetMcpProjectChoices(variables.projectPath)
            : variables.kind === 'remove'
              ? await window.api.removeMcpServer(variables.ref)
              : await window.api.logoutMcpServer(variables.ref)
        const message = mcpActionMessage(result)
        onActionSuccess(message)
        return message
      } finally {
        // Even a failed or unconfirmed action may have changed the files, and a remove can move
        // the server's calls to another row (Usage credits by the same index).
        await Promise.all(
          [['mcp-servers'], ['mcp-detail'], MCP_USAGE_QUERY_KEY].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey })
          )
        )
        if (variables.kind === 'remove' && queryClient.getQueryData(['mcp-detail', id]) === null)
          onServerGone()
      }
    }
  })

  function runAction({ kind, declaration }: McpActionRequest): void {
    // Synchronous, and it survives an unmount: a quick back and reopen can't start a second run.
    if (queryClient.isMutating({ mutationKey: MCP_ACTION_KEY, exact: true }) > 0) return
    const key = cardKey(declaration)
    if (kind === 'reset') {
      if (declaration.projectPath === null) return
      actionMutation.mutate({
        kind,
        serverId: id,
        cardKey: key,
        projectPath: declaration.projectPath
      })
      return
    }
    const ref = mcpDeclarationRef(id, declaration)
    if (ref !== null) actionMutation.mutate({ kind, serverId: id, cardKey: key, ref })
  }

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
          <Connection
            detail={data}
            canCheckProject={canCheckProject}
            onCheckProject={onCheckProject}
            checkingProject={checkingProject}
            projectCheckError={projectCheckError}
          />
          <Findings findings={data.findings} />
          <Declarations
            serverId={id}
            declarations={data.declarations}
            canChangeProject={canCheckProject}
            anyPending={anyPending}
            pending={pending}
            failure={failure}
            onRequest={setConfirming}
            onOpenPlugin={onOpenPlugin}
          />
          {data.server.kind === 'connector' && <ConnectorChanges />}
          <SwitchedOff detail={data} />
          <Tools tools={data.tools} />
        </div>
      </motion.div>
      <McpActionDialog
        name={name}
        request={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const request = confirming
          setConfirming(null)
          if (request) runAction(request)
        }}
      />
    </div>
  )
}

// Connectors live on the user's claude.ai account; the CLI won't change them (docs/mcp-servers.md,
// Connector logout).
function ConnectorChanges(): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Changes" />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
        Managed in claude.ai, where its sign-in lives.
        <TextLink
          onClick={() => void window.api.openExternal(CONNECTORS_PAGE)}
          className="flex items-center gap-1 text-[13px] text-foreground"
        >
          Open connector settings
          <ExternalLink aria-hidden="true" className="size-3" />
        </TextLink>
      </p>
    </section>
  )
}

function projectPhrase(path: string | null, label: (path: string) => string): string {
  return path === null ? '' : ` in ${label(path)}`
}

function McpActionDialog({
  name,
  request,
  onCancel,
  onConfirm
}: {
  name: string
  request: McpActionRequest | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const declaration = request?.declaration
  const scope = declaration ? SCOPE_LABEL[declaration.scope].toLowerCase() : ''
  const where = declaration ? projectPhrase(declaration.projectPath, resolveProjectLabel) : ''
  const project = declaration?.projectPath ? resolveProjectLabel(declaration.projectPath) : ''
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        {request?.kind === 'remove' ? (
          <DialogHeader>
            <DialogTitle className="break-words">
              Remove {name} from {scope} scope{where}?
            </DialogTitle>
            <DialogDescription>
              Claude Code deletes this declaration. It can&apos;t be undone, and Megatron keeps no
              copy of its settings. Claude Code sessions already running keep the server until they
              restart.
            </DialogDescription>
            {declaration?.scope === 'project' && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-warning"
                />
                <span>
                  This edits {project}&apos;s .mcp.json, a file your team may share through version
                  control.
                </span>
              </p>
            )}
          </DialogHeader>
        ) : request?.kind === 'logout' ? (
          <DialogHeader>
            <DialogTitle className="break-words">Log out of {name}?</DialogTitle>
            <DialogDescription>
              Claude Code forgets this server&apos;s sign-in on this computer, and the next session
              asks you to sign in again. Sign back in from Claude Code with /mcp.
            </DialogDescription>
          </DialogHeader>
        ) : (
          <DialogHeader>
            <DialogTitle className="break-words">Reset .mcp.json choices in {project}?</DialogTitle>
            <DialogDescription>
              Every server in this project&apos;s .mcp.json waits for approval again, and Claude
              Code asks at its next session. Approvals written in a settings file stay.
            </DialogDescription>
          </DialogHeader>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {/* Remove destroys, so it takes the destructive variant; the others are the one lime
              CTA, as in the connection-check confirm (DESIGN.md, One Stamp Rule). */}
          <Button
            type="button"
            variant={request?.kind === 'remove' ? 'destructive' : 'default'}
            onClick={onConfirm}
            className={cn(
              request?.kind !== 'remove' &&
                'bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90'
            )}
          >
            {request?.kind === 'remove'
              ? 'Remove'
              : request?.kind === 'logout'
                ? 'Log out'
                : 'Reset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// The general check covers user servers, connectors, and user plugins; a local or project server
// only answers from its own project, checked one project at a time.
function Connection({
  detail,
  canCheckProject,
  onCheckProject,
  checkingProject,
  projectCheckError
}: {
  detail: McpServerDetail
  canCheckProject: (path: string) => boolean
  onCheckProject: (path: string) => void
  checkingProject: string | null
  projectCheckError: { projectPath: string | null; message: string } | null
}): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const projects = [
    ...new Set(
      detail.declarations
        .filter((declaration) => declaration.scope === 'local' || declaration.scope === 'project')
        .flatMap((declaration) => (declaration.projectPath ? [declaration.projectPath] : []))
    )
  ].sort()
  const statusIn = (path: string): McpServerDetail['projectStatuses'][number] | undefined =>
    detail.projectStatuses.find((entry) => entry.projectPath === path)
  return (
    <section className="flex flex-col gap-2">
      <Caption label="Connection" />
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {(detail.server.liveStatus !== null || projects.length === 0) && (
          <li className="flex items-center gap-2">
            <span className="text-muted-foreground">General check</span>
            <McpConnectionBadge live={detail.server.liveStatus} />
          </li>
        )}
        {projects.map((path) => {
          const status = statusIn(path)
          const checking = checkingProject === path
          return (
            <li key={path} className="flex min-w-0 items-center gap-2">
              <span title={path} className="min-w-0 truncate">
                <ProjectName label={resolveProjectLabel(path)} />
              </span>
              <McpConnectionBadge
                live={status ? { status: status.status, checkedAt: status.checkedAt } : null}
              />
              {canCheckProject(path) ? (
                <TextLink
                  onClick={() => onCheckProject(path)}
                  disabled={checkingProject !== null}
                  className="flex shrink-0 items-center gap-1 text-[11px]"
                >
                  {checking ? (
                    <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="size-3" />
                  )}
                  {checking ? 'Checking…' : status ? 'Check again' : 'Check in this project'}
                </TextLink>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  Grant this folder to check it
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {projectCheckError &&
        projectCheckError.projectPath !== null &&
        projects.includes(projectCheckError.projectPath) && (
          <p role="alert" className="text-[11px] text-destructive">
            {projectCheckError.message}
          </p>
        )}
    </section>
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

interface DeclarationActionState {
  canChangeProject: (path: string) => boolean
  anyPending: boolean
  pending: { cardKey: string; kind: McpActionKind } | null
  failure: { cardKey: string; message: string; unconfirmed: boolean } | null
  onRequest: (request: McpActionRequest) => void
  onOpenPlugin: (name: string, marketplace: string) => void
}

function Declarations({
  serverId,
  declarations,
  ...actionState
}: {
  serverId: string
  declarations: McpDeclarationDetail[]
} & DeclarationActionState): React.JSX.Element | null {
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
              <DeclarationActions declaration={declaration} {...actionState} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DeclarationActions({
  declaration,
  canChangeProject,
  anyPending,
  pending,
  failure,
  onRequest,
  onOpenPlugin
}: { declaration: McpDeclarationDetail } & DeclarationActionState): React.JSX.Element | null {
  const plugin = declaration.plugin
  if (plugin !== null)
    return (
      <p className="text-[11px] text-muted-foreground">
        Managed by plugin{' '}
        <TextLink
          onClick={() => onOpenPlugin(plugin.name, plugin.marketplace)}
          className="text-[11px] text-foreground"
        >
          {plugin.name}
        </TextLink>
        . Change it from the plugin.
      </p>
    )
  const actions = mcpDeclarationActions(declaration)
  const key = cardKey(declaration)
  const changeable = declaration.projectPath === null || canChangeProject(declaration.projectPath)
  const disabled = anyPending || !changeable
  const pendingKind = pending?.cardKey === key ? pending.kind : null
  const icon = (kind: McpActionKind, Idle: typeof Trash2): React.JSX.Element =>
    pendingKind === kind ? <Loader2 className="animate-spin" /> : <Idle />
  const ownFailure = failure?.cardKey === key ? failure : null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          onClick={() => onRequest({ kind: 'remove', declaration })}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {icon('remove', Trash2)}
          {pendingKind === 'remove' ? PENDING_LABEL.remove : 'Remove'}
        </Button>
        {actions.logout && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => onRequest({ kind: 'logout', declaration })}
          >
            {icon('logout', LogOut)}
            {pendingKind === 'logout' ? PENDING_LABEL.logout : 'Log out'}
          </Button>
        )}
        {actions.reset && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            onClick={() => onRequest({ kind: 'reset', declaration })}
          >
            {icon('reset', RotateCcw)}
            {pendingKind === 'reset' ? PENDING_LABEL.reset : "Reset this project's choices"}
          </Button>
        )}
        {!changeable && (
          <span className="text-[11px] text-muted-foreground">Grant this folder to change it</span>
        )}
      </div>
      {ownFailure && (
        <p
          role="alert"
          className={cn(
            'flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] break-words whitespace-pre-wrap',
            ownFailure.unconfirmed
              ? 'border-warning/30 bg-warning/10 text-foreground'
              : 'border-destructive/30 bg-destructive/10 font-mono text-destructive'
          )}
        >
          {ownFailure.unconfirmed && (
            <TriangleAlert aria-hidden="true" className="mt-px size-3 shrink-0 text-warning" />
          )}
          <span className="min-w-0">{ownFailure.message}</span>
        </p>
      )}
    </div>
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

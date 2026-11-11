import { useState } from 'react'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Power, RefreshCw, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { GlideTitle } from '@/components/GlideTitle'
import {
  MarketplaceBadge,
  PluginScopeLabel,
  PluginStatusBadge,
  PluginUpdateBadge,
  PluginUpToDateBadge
} from '@/components/PluginBadges'
import { pluginUpdateDetails } from '@/lib/plugin-update'
import { cachePluginActionResult } from '@/lib/plugin-cache'
import {
  performPluginAction,
  type PluginActionVariables,
  type PluginActionVerb
} from '@/lib/plugin-action'
import { pluginTitleGlideId, useSettle } from '@/lib/transitions'
import { isUpdateAvailable } from '../../../shared/version'
import { TextLink } from '@/components/TextLink'
import { useProjectLabel } from '@/lib/use-project-label'
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
import { cn } from '@/lib/utils'
import {
  pluginInstallBlock,
  pluginRowKey,
  scopePluginDetail,
  showsMissingProjectStatus,
  type PluginContext
} from '@/lib/plugin-filter'
import { ProjectAvailabilityNotice } from '@/components/ProjectAvailabilityNotice'
import { missingProjectInstallMessage } from '../../../shared/missing-project'
import { EntityGlyph, type Entity } from '@/components/EntityGlyph'
import { Badge } from '@/components/ui/badge'
import type {
  PluginComponent,
  PluginComponentKind,
  PluginInstall,
  ProjectFolder,
  PluginUpdateProgress,
  PluginUpdatePhase
} from '../../../shared/ipc'

// Identifies one install within a plugin. Scope alone isn't enough — two projects can each hold
// a project-scope install of the same plugin, and they act independently.
function installKey(install: PluginInstall): string {
  return `${install.scope}:${install.project_path ?? ''}`
}

type ActionVerb = PluginActionVerb

interface PluginDetailProps {
  name: string
  marketplace: string
  context?: PluginContext
  availability?: ProjectFolder['status']
  updateProgress?: PluginUpdateProgress
  onBack: () => void
  onViewSkills: (pluginName: string) => void
  onActionSuccess: (message: string) => void
  onManageFolders: () => void
}

function formatVersionDisplay(version: string): string {
  const normalized = version.trim().replace(/^v/i, '')
  if (/^[0-9a-f]{12,40}$/i.test(normalized)) {
    return normalized.slice(0, 7)
  }
  return normalized
}

function versionLabel(version: string): string {
  return `v${formatVersionDisplay(version)}`
}

export function PluginDetail({
  name,
  marketplace,
  context = { kind: 'all' },
  availability,
  updateProgress,
  onBack,
  onViewSkills,
  onActionSuccess,
  onManageFolders
}: PluginDetailProps): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const queryClient = useQueryClient()
  const queryKey = [
    'plugin-detail',
    name,
    marketplace,
    context.kind,
    context.kind === 'project' ? context.path : null
  ]
  const {
    data: rawData,
    isPending,
    isError,
    refetch
  } = useQuery({
    queryKey,
    queryFn: () => window.api.getPluginDetail(name, marketplace)
  })
  const data = rawData
    ? scopePluginDetail(
        rawData,
        context,
        availability !== undefined && availability !== 'available'
      )
    : rawData
  const settle = useSettle(isPending)

  const [uninstallTarget, setUninstallTarget] = useState<PluginInstall | null>(null)
  const mutationKey = ['plugin-action', name, marketplace]
  const actionStates = useMutationState({
    filters: { mutationKey, exact: true },
    select: (mutation) => ({
      status: mutation.state.status,
      variables: mutation.state.variables as PluginActionVariables | undefined,
      error: mutation.state.error
    })
  })
  const actionState = actionStates.at(-1)
  const targetInstall = actionState?.variables
    ? `${actionState.variables.input.scope}:${actionState.variables.input.projectPath ?? ''}`
    : null
  const pendingKey =
    actionState?.status === 'pending' ? `${targetInstall}:${actionState.variables?.verb}` : null
  const actionError =
    actionState?.status === 'error'
      ? {
          install: targetInstall,
          message: actionState.error?.message ?? 'Action failed. Try again.'
        }
      : null
  const actionMutation = useMutation({
    mutationKey,
    networkMode: 'always',
    retry: false,
    mutationFn: async (variables: PluginActionVariables) => {
      try {
        const result = await performPluginAction(variables, window.api)
        await cachePluginActionResult(queryClient, variables.input, result.detail)
        onActionSuccess(result.message)
        return result
      } catch (error) {
        void queryClient.invalidateQueries({ queryKey: ['plugin-detail', name, marketplace] })
        void queryClient.invalidateQueries({ queryKey: ['plugins'] })
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
        throw error
      }
    }
  })

  function runAction(verb: ActionVerb, install: PluginInstall): void {
    // The cache guard is synchronous and survives unmounts, including a rapid back/reopen.
    if (queryClient.isMutating({ mutationKey, exact: true }) > 0) return
    actionMutation.mutate({
      verb,
      input: { name, marketplace, scope: install.scope, projectPath: install.project_path },
      previousVersion: install.installed_version
    })
  }

  // The name comes from the list row, so the header (and its title glide from that row) renders
  // before the query returns; the rest of the header arrives with the data.
  const glideId = pluginTitleGlideId(pluginRowKey(name, marketplace, context))
  if (isPending || isError || !data) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <PluginHeader name={name} glideId={glideId} onBack={onBack} />
        {isPending ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <p>Could not load this plugin.</p>
            <TextLink onClick={() => void refetch()}>Retry</TextLink>
            <TextLink onClick={onBack}>Back</TextLink>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium">Plugin not found</p>
            <p className="max-w-[320px] text-sm text-muted-foreground">
              It may have been removed since the last scan.
            </p>
            <Button
              onClick={onBack}
              className="mt-2 bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90"
            >
              Back to plugins
            </Button>
          </div>
        )}
      </div>
    )
  }

  const { plugin, totalInvocations, errorCount, warningCount } = data
  const updateDetails = pluginUpdateDetails(plugin)
  // One readable install is enough to state the plugin's status; only report Unknown when no
  // install's enablement could be resolved at all.
  const enablementKnown =
    plugin.installs.length === 0 || plugin.installs.some((install) => install.enablement_known)
  const noticeStatus =
    availability === undefined || availability === 'available'
      ? undefined
      : availability === 'missing' || plugin.installs.some((install) => install.project_missing)
        ? 'missing'
        : availability

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PluginHeader name={name} glideId={glideId} onBack={onBack}>
        <MarketplaceBadge marketplace={plugin.marketplace} />
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
          <span title={`Installed version: ${versionLabel(plugin.installed_version)}`}>
            {new Set(plugin.installs.map((install) => install.installed_version)).size > 1
              ? 'Mixed'
              : versionLabel(plugin.installed_version)}
          </span>
          {plugin.available_version && (
            <>
              <span className="text-border">·</span>
              <span
                title={`Marketplace version: ${versionLabel(plugin.available_version)}`}
                className="text-muted-foreground/80"
              >
                mkt: {versionLabel(plugin.available_version)}
              </span>
            </>
          )}
        </div>
        {updateDetails.hasUpdate ? (
          <PluginUpdateBadge
            availableVersion={updateDetails.availableVersion}
            tooltipMessage={updateDetails.message}
          />
        ) : plugin.available_version ? (
          <PluginUpToDateBadge availableVersion={plugin.available_version} />
        ) : null}
        <PluginStatusBadge
          disabledReason={plugin.disabled_reason}
          known={enablementKnown}
          projectMissing={showsMissingProjectStatus(plugin.installs)}
        />
      </PluginHeader>

      <motion.div {...settle} className="flex min-h-0 flex-1 flex-col">
        {context.kind === 'project' && (
          <p
            title={context.path}
            className="shrink-0 truncate border-b border-border px-4 py-1.5 font-mono text-[11px] text-muted-foreground"
          >
            Repository: {resolveProjectLabel(context.path)}
          </p>
        )}
        {noticeStatus && <ProjectAvailabilityNotice status={noticeStatus} />}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-4 py-4">
            <Card className="shadow-none py-4">
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 sm:grid-cols-5">
                <Stat
                  label="Marketplace"
                  value={
                    plugin.available_version ? versionLabel(plugin.available_version) : 'Unknown'
                  }
                  mono
                />
                <Stat
                  label="Skills"
                  value={plugin.skill_count.toLocaleString()}
                  onClick={
                    plugin.skill_count > 0
                      ? () => onViewSkills(`${name}@${marketplace}`)
                      : undefined
                  }
                />
                <Stat
                  label={context.kind === 'all' ? 'Uses' : 'Uses (all projects)'}
                  value={totalInvocations === 0 ? 'Never' : totalInvocations.toLocaleString()}
                  mono
                />
                <Stat label="Lint errors" value={errorCount.toLocaleString()} mono />
                <Stat label="Lint warnings" value={warningCount.toLocaleString()} mono />
              </CardContent>
            </Card>

            <PluginComponents
              pluginName={plugin.name}
              components={data.components}
              disabled={plugin.disabled_reason !== null}
            />

            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Installs
              </p>
              {plugin.installs.map((install) => (
                <InstallRow
                  key={`${installKey(install)}:${install.install_path}`}
                  install={install}
                  fallbackAvailableVersion={plugin.available_version}
                  pendingKey={pendingKey}
                  updatePhase={
                    updateProgress?.input.scope === install.scope &&
                    updateProgress.input.projectPath === install.project_path
                      ? updateProgress.phase
                      : undefined
                  }
                  onManageFolders={onManageFolders}
                  errorMessage={
                    actionError?.install === installKey(install) ? actionError.message : undefined
                  }
                  onEnable={() => runAction('enable', install)}
                  onDisable={() => runAction('disable', install)}
                  onUpdate={() => runAction('update', install)}
                  onUninstallRequest={() => setUninstallTarget(install)}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      <Dialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => !open && setUninstallTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Uninstall {plugin.name}?</DialogTitle>
            <DialogDescription>
              This removes the {uninstallTarget?.scope}-scope install
              {uninstallTarget?.project_path != null && (
                <>
                  {' '}
                  for{' '}
                  <span className="font-mono text-xs break-all">
                    {uninstallTarget.project_path}
                  </span>
                </>
              )}{' '}
              at{' '}
              <span className="font-mono text-xs break-all">{uninstallTarget?.install_path}</span>.
              This can&apos;t be undone from Megatron.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUninstallTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingKey !== null}
              onClick={() => {
                const target = uninstallTarget
                setUninstallTarget(null)
                if (target) runAction('uninstall', target)
              }}
            >
              Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PluginHeader({
  name,
  glideId,
  onBack,
  children
}: {
  name: string
  glideId: string
  onBack: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label="Back to plugins"
        className="shrink-0 text-muted-foreground"
      >
        <ArrowLeft className="size-4" />
      </Button>
      <GlideTitle
        as="h2"
        glideId={glideId}
        level="detail"
        className="min-w-0 truncate text-base font-semibold"
      >
        {name}
      </GlideTitle>
      {children}
    </div>
  )
}

function InstallRow({
  install,
  fallbackAvailableVersion,
  pendingKey,
  updatePhase,
  errorMessage,
  onEnable,
  onDisable,
  onUpdate,
  onUninstallRequest,
  onManageFolders
}: {
  install: PluginInstall
  fallbackAvailableVersion: string | null
  pendingKey: string | null
  updatePhase?: PluginUpdatePhase
  errorMessage?: string
  onEnable: () => void
  onDisable: () => void
  onUpdate: () => void
  onUninstallRequest: () => void
  onManageFolders: () => void
}): React.JSX.Element {
  const isPending = (verb: ActionVerb): boolean => pendingKey === `${installKey(install)}:${verb}`
  const anyPending = pendingKey !== null
  // Per-install, not per-plugin: the same plugin can be off at user scope and on for a project.
  const disabled = install.disabled_reason !== null
  // A project/local install runs its CLI command from the owning project. A missing folder, a
  // missing grant, and a record with no project path each block the action for a different reason.
  const block = pluginInstallBlock(install)
  const actionable = block === null

  const availableVersion = install.available_version ?? fallbackAvailableVersion
  const hasUpdate = isUpdateAvailable(
    install.installed_version,
    availableVersion,
    install.git_commit_sha
  )
  const updateLabel =
    updatePhase === 'marketplace'
      ? 'Refreshing marketplace…'
      : updatePhase === 'verify'
        ? 'Verifying…'
        : 'Updating…'
  const installedDisplay = formatVersionDisplay(install.installed_version)
  const availableDisplay = availableVersion ? formatVersionDisplay(availableVersion) : null
  const targetLabel = availableDisplay ? versionLabel(availableDisplay) : 'latest'

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PluginScopeLabel scope={install.scope} projectPath={install.project_path} />
            <span
              className="font-mono text-xs text-muted-foreground"
              title={`Installed version: ${versionLabel(install.installed_version)}`}
            >
              {versionLabel(installedDisplay)}
            </span>
            {availableVersion && (
              <span
                className="font-mono text-xs text-muted-foreground/70"
                title={`Marketplace version: ${versionLabel(availableVersion)}`}
              >
                (mkt: {targetLabel})
              </span>
            )}
            {hasUpdate ? (
              <PluginUpdateBadge
                availableVersion={availableVersion}
                tooltipMessage={`Update available: ${versionLabel(install.installed_version)} → ${targetLabel}`}
              />
            ) : availableVersion ? (
              <PluginUpToDateBadge availableVersion={availableVersion} />
            ) : null}
            <PluginStatusBadge
              disabledReason={install.disabled_reason}
              known={install.enablement_known}
              projectMissing={install.project_missing}
            />
          </div>
          <p
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={install.install_path}
          >
            {install.install_path}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending || !actionable}
            onClick={disabled ? onEnable : onDisable}
          >
            {isPending('enable') || isPending('disable') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Power className="size-3.5" />
            )}
            {isPending('enable')
              ? 'Enabling…'
              : isPending('disable')
                ? 'Disabling…'
                : disabled
                  ? 'Enable'
                  : 'Disable'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending || !actionable}
            onClick={onUpdate}
            className={cn(hasUpdate && 'border-info/50 text-info hover:bg-info/10 hover:text-info')}
          >
            {isPending('update') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span aria-live="polite">{isPending('update') ? updateLabel : 'Update'}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending || !actionable}
            onClick={onUninstallRequest}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isPending('uninstall') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {isPending('uninstall') ? 'Uninstalling…' : 'Uninstall'}
          </Button>
        </div>
      </div>
      {block === 'needs-grant' ? (
        <p className="text-[11px] text-muted-foreground">
          Grant{' '}
          <button
            type="button"
            onClick={onManageFolders}
            className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {install.project_path}
          </button>{' '}
          to see whether this install is enabled and to change it.
        </p>
      ) : block === 'missing-folder' && install.project_path !== null ? (
        <MissingProjectNote path={install.project_path} />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {actionable
            ? hasUpdate
              ? `Update to ${targetLabel} available. Takes effect after Claude Code restarts.`
              : availableVersion
                ? `Installed version matches marketplace (${targetLabel}). Update takes effect after Claude Code restarts.`
                : 'Update takes effect after Claude Code restarts.'
            : "This install doesn't record its project, so Megatron can't run the CLI from the right directory."}
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words text-destructive"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}

const COMPONENT_PREVIEW_COUNT = 5

// Static rows, with no hover, selection, or focus stop: no component has a view of its own yet.
// MCP servers and agents are entities and get the glyph tile; commands, hooks, and LSP stay
// neutral (DESIGN.md → Entity glyph).
function PluginComponents({
  pluginName,
  components,
  disabled
}: {
  pluginName: string
  components: PluginComponent[]
  disabled: boolean
}): React.JSX.Element {
  const of = (kind: PluginComponentKind): PluginComponent[] =>
    components.filter((component) => component.kind === kind)
  const hooks = of('hook')
  return (
    <>
      <ComponentList label="MCP servers" items={of('mcp')}>
        {(server) => (
          <TileRow key={server.name} entity="mcp" disabled={disabled} component={server} mono />
        )}
      </ComponentList>
      <ComponentList label="Agents" items={of('agent')}>
        {(agent) => (
          <TileRow
            key={agent.name}
            entity="agents"
            disabled={disabled}
            component={agent}
            prefix={`${pluginName}:`}
          />
        )}
      </ComponentList>
      <ComponentList label="Commands" items={of('command')} panel>
        {(command) => (
          <DenseRow key={command.name} component={command} prefix={`/${pluginName}:`} />
        )}
      </ComponentList>
      {hooks.length > 0 && (
        <section className="flex flex-col gap-2">
          <ComponentCaption label="Hooks" count={hooks.length} />
          <div className="flex flex-wrap gap-1.5">
            {hooks.map((hook) => (
              <Badge
                key={hook.name}
                variant="outline"
                className="font-mono text-[11px] font-normal text-muted-foreground"
              >
                {hook.name}
              </Badge>
            ))}
          </div>
        </section>
      )}
      <ComponentList label="LSP servers" items={of('lsp')} panel>
        {(server) => <DenseRow key={server.name} component={server} alignDetail="end" />}
      </ComponentList>
    </>
  )
}

function ComponentCaption({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {label} · {count.toLocaleString()}
    </h3>
  )
}

function ComponentList({
  label,
  items,
  panel = false,
  children
}: {
  label: string
  items: PluginComponent[]
  panel?: boolean
  children: (item: PluginComponent) => React.ReactNode
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null
  const hidden = expanded ? 0 : items.length - COMPONENT_PREVIEW_COUNT
  return (
    <section className="flex flex-col gap-2">
      <ComponentCaption label={label} count={items.length} />
      <div className={cn(panel && 'rounded-md bg-muted px-3 py-2')}>
        <ul className={cn('flex flex-col', panel ? 'gap-1' : 'gap-2.5')}>
          {(hidden > 0 ? items.slice(0, COMPONENT_PREVIEW_COUNT) : items).map(children)}
        </ul>
        {hidden > 0 && (
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
            className={cn(
              'rounded-sm text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              panel ? 'mt-1' : 'mt-2.5'
            )}
          >
            Show all {items.length.toLocaleString()}
          </button>
        )}
      </div>
    </section>
  )
}

// The name as the user types it, with the plugin prefix dimmed.
function ComponentName({
  prefix,
  name,
  className
}: {
  prefix?: string
  name: string
  className?: string
}): React.JSX.Element {
  return (
    <span title={`${prefix ?? ''}${name}`} className={cn('truncate font-mono text-xs', className)}>
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      {name}
    </span>
  )
}

function TileRow({
  entity,
  disabled,
  component,
  prefix,
  mono = false
}: {
  entity: Entity
  disabled: boolean
  component: PluginComponent
  prefix?: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-2.5">
      <EntityGlyph entity={entity} disabled={disabled} />
      <div className="flex min-w-0 flex-col">
        <ComponentName prefix={prefix} name={component.name} />
        {component.detail && (
          <span
            title={component.detail}
            className={cn('truncate text-[11px] text-muted-foreground', mono && 'font-mono')}
          >
            {component.detail}
          </span>
        )}
      </div>
    </li>
  )
}

function DenseRow({
  component,
  prefix,
  alignDetail = 'start'
}: {
  component: PluginComponent
  prefix?: string
  alignDetail?: 'start' | 'end'
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 items-baseline gap-3">
      <ComponentName prefix={prefix} name={component.name} className="max-w-[60%] shrink-0" />
      {component.detail && (
        <span
          title={component.detail}
          className={cn(
            'min-w-0 flex-1 truncate text-[11px] text-muted-foreground',
            alignDetail === 'end' && 'text-right font-mono'
          )}
        >
          {component.detail}
        </span>
      )}
    </li>
  )
}

function MissingProjectNote({ path }: { path: string }): React.JSX.Element {
  const message = missingProjectInstallMessage(path)
  const pathAt = message.indexOf(path)
  return (
    <p className="text-[11px] text-muted-foreground">
      {message.slice(0, pathAt)}
      <span className="break-all font-mono">{path}</span>
      {message.slice(pathAt + path.length)}
    </p>
  )
}

function Stat({
  label,
  value,
  mono,
  onClick
}: {
  label: string
  value: string
  mono?: boolean
  onClick?: () => void
}): React.JSX.Element {
  const content = (
    <p className={cn('min-w-0 truncate text-[13px]', mono && 'font-mono text-xs tabular-nums')}>
      {value}
    </p>
  )
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {onClick ? (
        <TextLink onClick={onClick} className="text-left">
          {content}
        </TextLink>
      ) : (
        content
      )}
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Power, RefreshCw, Trash2 } from 'lucide-react'
import {
  MarketplaceBadge,
  PluginScopeLabel,
  PluginStatusBadge,
  PluginUpdateBadge,
  PluginUpToDateBadge
} from '@/components/PluginBadges'
import { pluginUpdateDetails } from '@/lib/plugin-update'
import {
  performPluginAction,
  type PluginActionVariables,
  type PluginActionVerb
} from '@/lib/plugin-action'
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
  scopePluginDetail,
  showsMissingProjectStatus,
  type PluginContext
} from '@/lib/plugin-filter'
import { ProjectAvailabilityNotice } from '@/components/ProjectAvailabilityNotice'
import { missingProjectInstallMessage } from '../../../shared/missing-project'
import type { PluginInstall, ProjectFolder } from '../../../shared/ipc'

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
        queryClient.setQueriesData(
          { queryKey: ['plugin-detail', name, marketplace] },
          result.detail
        )
        return result
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['plugin-detail', name, marketplace] }),
          queryClient.invalidateQueries({ queryKey: ['plugins'] }),
          queryClient.invalidateQueries({ queryKey: ['skills'] })
        ])
      }
    },
    onSuccess: (result) => onActionSuccess(result.message)
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

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <p>Could not load this plugin.</p>
        <TextLink onClick={() => void refetch()}>Retry</TextLink>
        <TextLink onClick={onBack}>Back</TextLink>
      </div>
    )
  }
  if (!data) {
    return (
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
        <h2 className="min-w-0 truncate text-base font-semibold">{plugin.name}</h2>
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
      </div>

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
                  plugin.skill_count > 0 ? () => onViewSkills(`${name}@${marketplace}`) : undefined
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

function InstallRow({
  install,
  fallbackAvailableVersion,
  pendingKey,
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
  const hasUpdate = isUpdateAvailable(install.installed_version, availableVersion)
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
            className={cn(
              hasUpdate && 'border-warning/50 text-warning hover:bg-warning/10 hover:text-warning'
            )}
          >
            {isPending('update') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {isPending('update') ? 'Updating…' : 'Update'}
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

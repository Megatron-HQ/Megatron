import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Power, RefreshCw, Trash2 } from 'lucide-react'
import { MarketplaceBadge, PluginStatusBadge } from '@/components/PluginBadges'
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
import type { PluginInstall, PluginScope } from '../../../shared/ipc'

type ActionVerb = 'enable' | 'disable' | 'update' | 'uninstall'

interface PluginDetailProps {
  name: string
  marketplace: string
  onBack: () => void
  onViewSkills: (pluginName: string) => void
  onActionSuccess: (message: string) => void
}

export function PluginDetail({
  name,
  marketplace,
  onBack,
  onViewSkills,
  onActionSuccess
}: PluginDetailProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const queryKey = ['plugin-detail', name, marketplace]
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => window.api.getPluginDetail(name, marketplace)
  })

  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const pendingActionRef = useRef(false)
  const [actionError, setActionError] = useState<{ scope: PluginScope; message: string } | null>(
    null
  )
  const [uninstallTarget, setUninstallTarget] = useState<PluginInstall | null>(null)

  async function runAction(verb: ActionVerb, install: PluginInstall): Promise<void> {
    if (pendingActionRef.current) return

    const key = `${install.scope}:${verb}`
    pendingActionRef.current = true
    setPendingKey(key)
    setActionError(null)
    const input = { name, marketplace, scope: install.scope }
    const apiFn = {
      enable: window.api.enablePlugin,
      disable: window.api.disablePlugin,
      update: window.api.updatePlugin,
      uninstall: window.api.uninstallPlugin
    }[verb]
    try {
      const result = await apiFn(input)
      if (!result.ok) {
        setActionError({ scope: install.scope, message: result.stderr ?? 'Action failed.' })
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['plugins'] })
      ])
      onActionSuccess(`${name} ${pastTenseVerb(verb)}`)
    } catch (error) {
      setActionError({
        scope: install.scope,
        message: error instanceof Error ? error.message : 'Action failed unexpectedly. Try again.'
      })
    } finally {
      pendingActionRef.current = false
      setPendingKey(null)
    }
  }

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
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
  const disabled = plugin.disabled_reason !== null

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
        <span className="font-mono text-xs text-muted-foreground">v{plugin.installed_version}</span>
        <PluginStatusBadge disabledReason={plugin.disabled_reason} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          <Card className="shadow-none py-4">
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 sm:grid-cols-4">
              <Stat
                label="Skills"
                value={plugin.skill_count.toLocaleString()}
                onClick={
                  plugin.skill_count > 0 ? () => onViewSkills(`${name}@${marketplace}`) : undefined
                }
              />
              <Stat
                label="Uses"
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
                key={`${install.scope}:${install.install_path}`}
                install={install}
                disabled={disabled}
                pendingKey={pendingKey}
                errorMessage={
                  actionError?.scope === install.scope ? actionError.message : undefined
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
              This removes the {uninstallTarget?.scope}-scope install at{' '}
              <span className="font-mono text-xs">{uninstallTarget?.install_path}</span>. This
              can&apos;t be undone from Megatron.
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
              onClick={async () => {
                const target = uninstallTarget
                setUninstallTarget(null)
                if (target) await runAction('uninstall', target)
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

function pastTenseVerb(verb: ActionVerb): string {
  return {
    enable: 'enabled',
    disable: 'disabled',
    update: 'updated',
    uninstall: 'uninstalled'
  }[verb]
}

function InstallRow({
  install,
  disabled,
  pendingKey,
  errorMessage,
  onEnable,
  onDisable,
  onUpdate,
  onUninstallRequest
}: {
  install: PluginInstall
  disabled: boolean
  pendingKey: string | null
  errorMessage?: string
  onEnable: () => void
  onDisable: () => void
  onUpdate: () => void
  onUninstallRequest: () => void
}): React.JSX.Element {
  const isPending = (verb: ActionVerb): boolean => pendingKey === `${install.scope}:${verb}`
  const anyPending = pendingKey !== null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium capitalize">{install.scope} scope</p>
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
            disabled={anyPending}
            onClick={disabled ? onEnable : onDisable}
          >
            {isPending(disabled ? 'enable' : 'disable') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Power className="size-3.5" />
            )}
            {disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending}
            onClick={onUpdate}
          >
            {isPending('update') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Update
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anyPending}
            onClick={onUninstallRequest}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {isPending('uninstall') ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Uninstall
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Update takes effect after Claude Code restarts.
      </p>
      {errorMessage && (
        <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
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
    <p className={cn('truncate text-[13px]', mono && 'font-mono text-xs tabular-nums')}>{value}</p>
  )
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {onClick ? (
        <button type="button" onClick={onClick} className="text-left hover:underline">
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  )
}

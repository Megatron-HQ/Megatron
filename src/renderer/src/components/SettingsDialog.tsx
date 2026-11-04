import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, Monitor, Moon, RefreshCw, Sun } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TextLink } from '@/components/TextLink'
import { ScanIssueDetails } from '@/components/ScanStatus'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { refreshScanQueries } from '@/lib/refresh-scan-queries'
import { isMissingProjectOnlyScan, preferScanSummary } from '../../../shared/scan-banner'
import type { ScanSummary, ThemePreference } from '../../../shared/ipc'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  version: string
  scanSummary?: ScanSummary
  scanning: boolean
  onManageFolders: () => void
}

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
] as const

export function SettingsDialog({
  open,
  onOpenChange,
  themePreference,
  onThemeChange,
  version,
  scanSummary,
  scanning,
  onManageFolders
}: SettingsDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [rescanPhase, setRescanPhase] = useState<'idle' | 'scanning' | 'refreshing'>('idle')
  const [rescanMessage, setRescanMessage] = useState<string | null>(null)
  const [rescanSummary, setRescanSummary] = useState<ScanSummary | null>(null)
  const latestSummary = preferScanSummary(rescanSummary, scanSummary)
  const isRescanning = rescanPhase !== 'idle'
  const busy = scanning || isRescanning
  const currentRescanMessage =
    rescanSummary === null || latestSummary === rescanSummary ? rescanMessage : null

  async function handleRescan(): Promise<void> {
    setRescanPhase('scanning')
    setRescanMessage(null)
    setRescanSummary(null)
    try {
      const result = await window.api.rescan()
      setRescanSummary(result)
      setRescanPhase('refreshing')
      try {
        await refreshScanQueries(queryClient, true)
      } catch {
        setRescanMessage(
          'The scan finished, but some displayed data could not be reloaded. Try again.'
        )
        return
      }
      setRescanMessage(
        result.outcome === 'complete' || isMissingProjectOnlyScan(result)
          ? 'Scan complete.'
          : result.outcome === 'partial'
            ? 'Some sources could not be refreshed. Review the details below.'
            : 'The scan could not finish. Review the details below.'
      )
    } catch {
      setRescanMessage('Could not complete the scan. Try again.')
    } finally {
      setRescanPhase('idle')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          <section className="flex flex-col gap-2 py-3">
            <p className="text-sm font-medium">Appearance</p>
            <div
              role="radiogroup"
              aria-label="Appearance"
              className="grid grid-cols-3 gap-1 rounded-md border border-border p-1"
            >
              {APPEARANCE_OPTIONS.map(({ value, label, Icon }) => {
                const active = value === themePreference
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onThemeChange(value)}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                )
              })}
            </div>
          </section>

          {busy ? (
            <p role="status" className="py-2 text-xs text-muted-foreground">
              {rescanPhase === 'refreshing'
                ? 'Updating displayed data…'
                : 'Scanning Claude Code data…'}
            </p>
          ) : (
            currentRescanMessage && (
              <p role="status" className="py-2 text-xs text-muted-foreground">
                {currentRescanMessage}
              </p>
            )
          )}
          {!busy && latestSummary && (
            <ScanIssueDetails summary={latestSummary} onManageFolders={onManageFolders} />
          )}
          <section className="flex items-center justify-between gap-4 border-t border-border py-3">
            <div>
              <p className="text-sm font-medium">Index</p>
              <p className="text-xs text-muted-foreground">
                Re-scan Claude Code data for skills, plugins, and usage history.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRescan}
              disabled={isRescanning}
              className="flex shrink-0 items-center gap-1.5"
            >
              <RefreshCw className={cn('size-4', isRescanning && 'animate-spin')} />
              {isRescanning ? 'Rescanning…' : 'Rescan now'}
            </Button>
          </section>

          <section className="flex items-center justify-between gap-4 border-t border-border py-3">
            <div>
              <p className="text-sm font-medium">Project folders</p>
              <p className="text-xs text-muted-foreground">
                Projects or parent folders scanned for project-level skills and plugin settings.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onManageFolders}
              className="flex shrink-0 items-center gap-1.5"
            >
              <Folder className="size-4" />
              Manage…
            </Button>
          </section>

          <section className="flex items-center justify-between gap-4 border-t border-border pt-3">
            <p className="font-mono text-xs text-muted-foreground">Megatron v{version}</p>
            <TextLink
              onClick={() => window.api.revealDataFolder()}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Reveal data folder
            </TextLink>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

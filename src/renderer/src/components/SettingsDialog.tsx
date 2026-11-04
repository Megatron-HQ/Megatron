import { useState } from 'react'
import { Download, Folder, Monitor, Moon, RefreshCw, RotateCw, Sun } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TextLink } from '@/components/TextLink'
import { ScanIssueDetails } from '@/components/ScanStatus'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { ScanSummary, ThemePreference, UpdateState } from '../../../shared/ipc'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  version: string
  scanSummary?: ScanSummary
  onManageFolders: () => void
  updateState?: UpdateState
}

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
] as const

function updateStatusText({ status, version }: UpdateState): string {
  switch (status) {
    case 'unsupported':
      return 'Update checks run in installed builds only.'
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'current':
      return 'Megatron is up to date.'
    case 'available':
      return `Version ${version} is available.`
    case 'downloading':
      return `Downloading version ${version}…`
    case 'ready':
      return `Version ${version} installs when you quit Megatron.`
    case 'error':
      return "Couldn't check for updates. Try again later."
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  themePreference,
  onThemeChange,
  version,
  scanSummary,
  onManageFolders,
  updateState
}: SettingsDialogProps): React.JSX.Element {
  const [isRescanning, setIsRescanning] = useState(false)
  const [rescanMessage, setRescanMessage] = useState<string | null>(null)

  async function handleRescan(): Promise<void> {
    setIsRescanning(true)
    setRescanMessage(null)
    try {
      // The worker has finished when this resolves; the broadcast refreshes query data.
      const result = await window.api.rescan()
      setRescanMessage(
        result.outcome === 'complete'
          ? 'Scan complete.'
          : result.outcome === 'partial'
            ? 'Scan incomplete. Review the source details below.'
            : 'Scan failed. Try again.'
      )
    } catch {
      setRescanMessage('Could not start the scan. Try again.')
    } finally {
      setIsRescanning(false)
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

          {rescanMessage && (
            <p role="status" className="py-2 text-xs text-muted-foreground">
              {rescanMessage}
            </p>
          )}
          {scanSummary && (
            <ScanIssueDetails summary={scanSummary} onManageFolders={onManageFolders} />
          )}
          <section className="flex items-center justify-between gap-4 border-t border-border py-3">
            <div>
              <p className="text-sm font-medium">Index</p>
              <p className="text-xs text-muted-foreground">
                Re-scan <code className="font-mono text-[11px]">~/.claude</code> for skills and
                plugins.
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

          {updateState && (
            <section className="flex flex-col gap-3 border-t border-border py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Updates</p>
                  <p role="status" className="text-xs text-muted-foreground">
                    {updateStatusText(updateState)}
                  </p>
                </div>
                {window.api.platform === 'win32' && updateState.status === 'ready' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.api.installUpdate()}
                    className="flex shrink-0 items-center gap-1.5"
                  >
                    <RotateCw className="size-4" />
                    Restart to update
                  </Button>
                ) : window.api.platform === 'darwin' && updateState.status === 'available' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.api.openUpdateDownload()}
                    className="flex shrink-0 items-center gap-1.5"
                  >
                    <Download className="size-4" />
                    Download
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.api.checkForUpdates()}
                    disabled={['unsupported', 'checking', 'downloading'].includes(
                      updateState.status
                    )}
                    className="flex shrink-0 items-center gap-1.5"
                  >
                    <RefreshCw
                      className={cn('size-4', updateState.status === 'checking' && 'animate-spin')}
                    />
                    Check now
                  </Button>
                )}
              </div>
              {window.api.platform === 'darwin' && updateState.status === 'available' && (
                // Selectable text, not a copy button: the session permission handler denies
                // clipboard access.
                <p className="text-xs text-muted-foreground">
                  Installed with Homebrew? Run{' '}
                  <code className="font-mono text-[11px] text-foreground select-all">
                    brew upgrade --cask megatron
                  </code>
                </p>
              )}
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="auto-update-check" className="text-xs text-muted-foreground">
                  Check for updates automatically
                </label>
                <Switch
                  id="auto-update-check"
                  checked={updateState.autoCheck}
                  onCheckedChange={(checked) => void window.api.setAutoUpdateCheck(checked)}
                />
              </div>
            </section>
          )}

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

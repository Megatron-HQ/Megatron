import { useState } from 'react'
import { Folder, Monitor, Moon, RefreshCw, Sun } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ThemePreference } from '../../../shared/ipc'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  version: string
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
  onManageFolders
}: SettingsDialogProps): React.JSX.Element {
  const [isRescanning, setIsRescanning] = useState(false)

  async function handleRescan(): Promise<void> {
    setIsRescanning(true)
    try {
      // scanAndNotify in main is synchronous — this promise resolving means the rescan and
      // linter are done; the scan:complete broadcast refreshes every query via App.tsx.
      await window.api.rescan()
    } finally {
      setIsRescanning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
                Repository roots scanned for project-level skills.
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
            <button
              type="button"
              onClick={() => window.api.revealDataFolder()}
              className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reveal data folder
            </button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

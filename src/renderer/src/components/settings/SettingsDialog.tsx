import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Tabs } from 'radix-ui'
import {
  FolderCog,
  Info,
  Monitor,
  Moon,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Sun,
  TriangleAlert
} from 'lucide-react'
import appIcon from '../../../../../build/icon-source/icon.svg'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ClaudeCodePane } from '@/components/settings/ClaudeCodePane'
import { SettingRow, SettingsGroup } from '@/components/settings/SettingsGroup'
import { settingsTargetId, type SettingsTarget } from '@/lib/settings-target'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import { refreshScanQueries } from '@/lib/refresh-scan-queries'
import { isMissingProjectOnlyScan, preferScanSummary } from '../../../../shared/scan-banner'
import type {
  AllowedPathRow,
  ClaudeFolderStatus,
  ProjectFolder,
  ScanSummary,
  SettingsPane,
  SkippedGrant,
  ThemePreference,
  UpdateState
} from '../../../../shared/ipc'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pane: SettingsPane
  onPaneChange: (pane: SettingsPane) => void
  // The group a deep link lands on; its caption takes focus when the dialog opens.
  target: SettingsTarget | null
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
  version: string
  scanSummary?: ScanSummary
  scanning: boolean
  onShowWelcome: () => void
  // Null when this build has no release to replay; the row is then absent.
  onShowWhatsNew?: (() => void) | null
  updateState?: UpdateState
  // The rail gear's label suffix; the Updates tab carries the same dot.
  updateNotice: string | null
  claudeFolder?: ClaudeFolderStatus
  home: string
  folders: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  onAddFolders: () => Promise<SkippedGrant[]>
  onNarrowFolder: (path: string) => Promise<SkippedGrant[]>
  onRevokeFolder: (path: string) => Promise<void>
}

const PANES: { pane: SettingsPane; label: string; Icon: typeof Sun }[] = [
  { pane: 'general', label: 'General', Icon: SlidersHorizontal },
  { pane: 'claude-code', label: 'Claude Code', Icon: FolderCog },
  { pane: 'updates', label: 'Updates', Icon: RefreshCw },
  { pane: 'about', label: 'About', Icon: Info }
]

const INSTALL_COMMAND =
  'curl -fsSL https://github.com/Megatron-HQ/Megatron/releases/latest/download/install.sh | bash'

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
] as const

// Each pane scrolls on its own, so switching keeps every pane's place. Inactive panes stay
// mounted (forceMount) and only hide, so the Claude Code pane's folder actions survive a switch.
const PANE_CLASS =
  'min-w-0 flex-1 overflow-y-auto px-8 py-6 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=inactive]:hidden'

function updateStatusText({ status, version, detail }: UpdateState): string {
  switch (status) {
    case 'unsupported':
      return 'Update checks run in installed builds only.'
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates…'
    case 'current':
      return 'Megatron is up to date.'
    case 'downloading':
      return `Downloading version ${version}…`
    case 'ready':
      return `Version ${version} installs when you quit Megatron.`
    case 'manual':
      return `${version ? `Version ${version} is` : 'An update is'} available. Megatron can't update itself here: ${detail}`
    case 'error':
      return "Couldn't check for updates. Try again later."
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  pane,
  onPaneChange,
  target,
  themePreference,
  onThemeChange,
  version,
  scanSummary,
  scanning,
  onShowWelcome,
  onShowWhatsNew,
  updateState,
  updateNotice,
  claudeFolder,
  home,
  folders,
  projectCatalog,
  onAddFolders,
  onNarrowFolder,
  onRevokeFolder
}: SettingsDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [rescanPhase, setRescanPhase] = useState<'idle' | 'scanning' | 'refreshing'>('idle')
  const [rescanMessage, setRescanMessage] = useState<string | null>(null)
  const [rescanSummary, setRescanSummary] = useState<ScanSummary | null>(null)
  const latestSummary = preferScanSummary(rescanSummary, scanSummary)
  const isRescanning = rescanPhase !== 'idle'
  const busy = scanning || isRescanning
  // A paused folder refuses scans in main; the folder group says why.
  const folderPaused = claudeFolder !== undefined && claudeFolder.state !== 'ok'
  // The same condition that shows the folder notice or ScanIssueDetails, so the mark always
  // points at something on the pane.
  const claudeCodeAlert =
    folderPaused || (latestSummary !== undefined && latestSummary.outcome !== 'complete')
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLDivElement>()

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
      <DialogContent
        className="flex h-[min(600px,calc(100vh-4rem))] w-[min(820px,calc(100vw-4rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        onOpenAutoFocus={(event) => {
          // Native focus scrolls the caption into view, so a deep link needs no scroll code.
          const caption = target && document.getElementById(settingsTargetId(target))
          if (!caption) return
          event.preventDefault()
          caption.focus()
        }}
      >
        <Tabs.Root
          orientation="vertical"
          value={pane}
          onValueChange={(next) => onPaneChange(next as SettingsPane)}
          className="flex min-w-0 flex-1"
        >
          <div className="frame-surface flex w-48 shrink-0 flex-col gap-3 border-r border-border bg-frame p-3">
            <DialogTitle className="px-2 pt-1 text-sm">Settings</DialogTitle>
            <Tabs.List
              ref={containerRef}
              aria-label="Settings sections"
              className="relative flex flex-col gap-0.5"
              onMouseLeave={onMouseLeave}
            >
              {highlightRect && (
                <motion.div
                  className="pointer-events-none absolute z-0 rounded-md bg-accent"
                  initial={false}
                  animate={{
                    top: highlightRect.top,
                    left: highlightRect.left,
                    width: highlightRect.width,
                    height: highlightRect.height
                  }}
                  transition={transition}
                />
              )}
              {PANES.map(({ pane: itemPane, label, Icon }) => (
                <Tabs.Trigger
                  key={itemPane}
                  value={itemPane}
                  onMouseEnter={(event) => onItemHover(event.currentTarget)}
                  className={cn(
                    'relative z-10 flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    itemPane === pane
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-accent-foreground'
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                  {itemPane === 'updates' && updateNotice && (
                    <>
                      <span
                        aria-hidden="true"
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-info"
                      />
                      <span className="sr-only"> · {updateNotice}</span>
                    </>
                  )}
                  {itemPane === 'claude-code' && claudeCodeAlert && (
                    <>
                      <TriangleAlert
                        aria-hidden="true"
                        className="ml-auto size-3.5 shrink-0 text-warning"
                      />
                      <span className="sr-only"> · Needs attention</span>
                    </>
                  )}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>

          <Tabs.Content value="general" forceMount className={PANE_CLASS}>
            <div className="flex flex-col gap-6">
              <SettingsGroup title="Appearance">
                <SettingRow title="Theme" description="Follow the system, or keep one theme.">
                  <div
                    role="radiogroup"
                    aria-label="Appearance"
                    className="grid shrink-0 grid-cols-3 gap-1 rounded-md border border-border p-1"
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
                </SettingRow>
              </SettingsGroup>
            </div>
          </Tabs.Content>

          <Tabs.Content value="claude-code" forceMount className={PANE_CLASS}>
            <div className="flex flex-col gap-6">
              <ClaudeCodePane
                claudeFolder={claudeFolder}
                home={home}
                folders={folders}
                projectCatalog={projectCatalog}
                onAddFolders={onAddFolders}
                onNarrowFolder={onNarrowFolder}
                onRevokeFolder={onRevokeFolder}
                scanSummary={latestSummary}
                scanStatus={
                  busy
                    ? rescanPhase === 'refreshing'
                      ? 'Updating displayed data…'
                      : 'Scanning Claude Code data…'
                    : rescanMessage
                }
                busy={busy}
                isRescanning={isRescanning}
                folderPaused={folderPaused}
                onRescan={() => void handleRescan()}
              />
            </div>
          </Tabs.Content>

          <Tabs.Content value="updates" forceMount className={PANE_CLASS}>
            <div className="flex flex-col gap-6">
              {updateState && (
                <SettingsGroup title="Updates">
                  <SettingRow
                    title="Status"
                    description={<span role="status">{updateStatusText(updateState)}</span>}
                  >
                    {updateState.status === 'ready' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => window.api.installUpdate()}
                      >
                        <RotateCw className="size-4" />
                        Restart to update
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
                      >
                        <RefreshCw
                          className={cn(
                            'size-4',
                            updateState.status === 'checking' && 'animate-spin'
                          )}
                        />
                        Check now
                      </Button>
                    )}
                  </SettingRow>
                  {updateState.status === 'manual' && (
                    // Selectable text, not a copy button: the session permission handler denies
                    // clipboard access. install.sh redirects Homebrew installs to brew upgrade.
                    <SettingRow
                      title="Update by hand"
                      description={
                        <>
                          Quit Megatron and run this in Terminal:{' '}
                          <code className="font-mono text-[11px] break-all text-foreground select-all">
                            {INSTALL_COMMAND}
                          </code>
                        </>
                      }
                    />
                  )}
                  <SettingRow title="Check for updates automatically" htmlFor="auto-update-check">
                    <Switch
                      id="auto-update-check"
                      checked={updateState.autoCheck}
                      onCheckedChange={(checked) => void window.api.setAutoUpdateCheck(checked)}
                    />
                  </SettingRow>
                </SettingsGroup>
              )}
            </div>
          </Tabs.Content>

          <Tabs.Content value="about" forceMount className={PANE_CLASS}>
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <img
                  src={appIcon}
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 shrink-0"
                  draggable={false}
                />
                <div>
                  <p className="text-sm font-semibold">Megatron</p>
                  <p className="font-mono text-xs text-muted-foreground">v{version}</p>
                </div>
              </div>
              <SettingsGroup>
                {onShowWhatsNew && (
                  <SettingRow title="What's new" description="Highlights from the latest release.">
                    <Button type="button" variant="outline" size="sm" onClick={onShowWhatsNew}>
                      View
                    </Button>
                  </SettingRow>
                )}
                <SettingRow title="Welcome" description="Replay the introduction and folder setup.">
                  <Button type="button" variant="outline" size="sm" onClick={onShowWelcome}>
                    Show welcome
                  </Button>
                </SettingRow>
                <SettingRow
                  title="Data folder"
                  description="Megatron's index, usage history, and preferences."
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.api.revealDataFolder()}
                  >
                    Reveal
                  </Button>
                </SettingRow>
              </SettingsGroup>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </DialogContent>
    </Dialog>
  )
}

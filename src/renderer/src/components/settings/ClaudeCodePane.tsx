import { useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  Folder,
  FolderPlus,
  Info,
  LoaderCircle,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { ClaudeFolderSettings } from '@/components/ClaudeFolder'
import { ScanIssueDetails } from '@/components/ScanStatus'
import { SettingRow, SettingsGroup } from '@/components/settings/SettingsGroup'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFolderBasename } from '@/lib/source-name'
import { settingsTargetId } from '@/lib/settings-target'
import { cn } from '@/lib/utils'
import { isWithinProjectPath, normalizeProjectPath } from '../../../../shared/project-path'
import {
  GRANT_GUIDANCE,
  type AllowedPathRow,
  type ClaudeFolderStatus,
  type ProjectFolder,
  type ScanSummary,
  type SkippedGrant
} from '../../../../shared/ipc'

interface ClaudeCodePaneProps {
  claudeFolder?: ClaudeFolderStatus
  home: string
  folders: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  onAddFolders: () => Promise<SkippedGrant[]>
  onNarrowFolder: (path: string) => Promise<SkippedGrant[]>
  onRevokeFolder: (path: string) => Promise<void>
  // The Index group's state lives in SettingsDialog, whose nav mark reads the same summary.
  scanSummary?: ScanSummary
  scanStatus: string | null
  busy: boolean
  isRescanning: boolean
  folderPaused: boolean
  onRescan: () => void
}

type FolderAction =
  { kind: 'add' } | { kind: 'narrow'; path: string } | { kind: 'revoke'; path: string }

const ACTION_ERROR: Record<FolderAction['kind'], string> = {
  add: 'Could not add folders. Please try again.',
  narrow: 'Could not change folder access. Please try again.',
  revoke: 'Could not revoke folder access. Please try again.'
}

const ACTION_STATUS: Record<FolderAction['kind'], string> = {
  add: 'Adding folders…',
  narrow: 'Updating folder access…',
  revoke: 'Revoking folder access…'
}

// Mounted inside the dialog's content, so the confirm, skipped and error state resets whenever
// Settings closes.
export function ClaudeCodePane({
  claudeFolder,
  home,
  folders,
  projectCatalog,
  onAddFolders,
  onNarrowFolder,
  onRevokeFolder,
  scanSummary,
  scanStatus,
  busy,
  isRescanning,
  folderPaused,
  onRescan
}: ClaudeCodePaneProps): React.JSX.Element {
  const [pendingAction, setPendingAction] = useState<FolderAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<SkippedGrant[]>([])
  const actionInProgress = useRef(false)
  const loading = pendingAction !== null
  const feedbackRef = useRef<HTMLDivElement>(null)

  // The pane scrolls, and in a small window an action's progress or result lands below the
  // fold, out of sight of the button that started it.
  useEffect(() => {
    feedbackRef.current?.scrollIntoView({ block: 'nearest' })
  }, [pendingAction, error, skipped])

  // Projects that become unreadable with this grant: inside it, not the grant itself, and not
  // reachable through another grant (a link target granted separately).
  function projectsLosingAccess(grant: string): number {
    return projectCatalog.filter(
      (project) =>
        project.kind === 'repository' &&
        normalizeProjectPath(project.path) !== normalizeProjectPath(grant) &&
        isWithinProjectPath(project.path, grant) &&
        !folders.some(
          (other) => other.path !== grant && isWithinProjectPath(project.path, other.path)
        )
    ).length
  }

  async function runAction(action: FolderAction): Promise<void> {
    if (actionInProgress.current) return
    actionInProgress.current = true
    setPendingAction(action)
    setError(null)
    setSkipped([])
    try {
      if (action.kind === 'add') setSkipped(await onAddFolders())
      else if (action.kind === 'narrow') setSkipped(await onNarrowFolder(action.path))
      else await onRevokeFolder(action.path)
      setConfirming(null)
    } catch {
      setError(ACTION_ERROR[action.kind])
    } finally {
      actionInProgress.current = false
      setPendingAction(null)
    }
  }

  return (
    <>
      {claudeFolder && (
        <SettingsGroup id={settingsTargetId('claude-folder')} title="Claude Code folder">
          <div className="px-4 py-3">
            <ClaudeFolderSettings status={claudeFolder} home={home} />
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup id={settingsTargetId('project-folders')} title="Project folders">
        <SettingRow
          title="Folder access"
          description={`${GRANT_GUIDANCE} Linked skills outside these folders require granting their target folder too.`}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runAction({ kind: 'add' })}
            disabled={loading}
          >
            <FolderPlus className="size-4" />
            Add folder…
          </Button>
        </SettingRow>
        {folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-6 text-center">
            <Folder className="size-6 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">No project folders granted</p>
            <p className="text-xs text-muted-foreground">
              Grant a project or parent folder to discover project-level skills.
            </p>
          </div>
        ) : (
          <ItemGroup aria-label="Project folders" className="divide-y divide-border">
            {folders.map((folder) => {
              const name = getFolderBasename(folder.path)
              const pending =
                pendingAction !== null &&
                pendingAction.kind !== 'add' &&
                pendingAction.path === folder.path
              if (confirming === folder.path) {
                const count = projectsLosingAccess(folder.path)
                return (
                  <Item key={folder.path} role="listitem" size="sm">
                    <div role="group" aria-label={`Revoke ${name}`} className="w-full">
                      <p className="text-sm">
                        <span className="font-medium">Revoke {name}?</span>
                        {count > 0 && (
                          <span className="text-muted-foreground">
                            {' '}
                            {count === 1
                              ? '1 project inside it loses access.'
                              : `${count} projects inside it lose access.`}
                          </span>
                        )}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                        {count > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => void runAction({ kind: 'narrow', path: folder.path })}
                          >
                            Keep some folders…
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          autoFocus
                          disabled={loading}
                          onClick={() => setConfirming(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={loading}
                          aria-busy={pending}
                          onClick={() => void runAction({ kind: 'revoke', path: folder.path })}
                        >
                          {pending && (
                            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                          )}
                          Revoke
                        </Button>
                      </div>
                    </div>
                  </Item>
                )
              }
              return (
                <Item key={folder.path} role="listitem" size="sm">
                  <ItemMedia>
                    <Folder className="size-4 text-muted-foreground" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <p className="truncate text-sm font-medium leading-none">{name}</p>
                    <p
                      title={folder.path}
                      className="truncate font-mono text-[11px] text-muted-foreground"
                    >
                      {folder.path}
                    </p>
                  </ItemContent>
                  <ItemActions>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            setSkipped([])
                            setError(null)
                            setConfirming(folder.path)
                          }}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                          aria-label={`Revoke access to ${name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Revoke folder access</TooltipContent>
                    </Tooltip>
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
        {(skipped.length > 0 || pendingAction || error) && (
          <div ref={feedbackRef} className="flex flex-col gap-2 px-4 py-3">
            {skipped.length > 0 && (
              <div role="status" className="flex gap-2 text-xs text-muted-foreground">
                <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
                <ul className="min-w-0 space-y-0.5">
                  {skipped.map((entry) => (
                    <li key={entry.path} className="break-words">
                      {normalizeProjectPath(entry.path) === normalizeProjectPath(entry.coveredBy)
                        ? `${getFolderBasename(entry.path)} is already in the list.`
                        : `${getFolderBasename(entry.path)} is already included in ${getFolderBasename(entry.coveredBy)}.`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pendingAction && (
              <p role="status" className="text-xs text-muted-foreground">
                {ACTION_STATUS[pendingAction.kind]}
              </p>
            )}
            {error && (
              <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id={settingsTargetId('index')} title="Index">
        <SettingRow
          title="Rescan"
          description={
            <>
              Re-scan Claude Code data for skills, plugins, and usage history.
              {scanStatus && (
                <span role="status" className="mt-1 block">
                  {scanStatus}
                </span>
              )}
            </>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRescan}
            disabled={isRescanning || folderPaused}
          >
            <RefreshCw className={cn('size-4', isRescanning && 'animate-spin')} />
            {isRescanning ? 'Rescanning…' : 'Rescan now'}
          </Button>
        </SettingRow>
        {!busy && scanSummary && (
          <ScanIssueDetails
            summary={scanSummary}
            onManageFolders={() =>
              document.getElementById(settingsTargetId('project-folders'))?.focus()
            }
          />
        )}
      </SettingsGroup>
    </>
  )
}

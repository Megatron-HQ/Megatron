import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleAlert,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Info,
  LoaderCircle,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { ClaudeFolderSettings } from '@/components/ClaudeFolder'
import { FolderAccessRow } from '@/components/FolderAccessRow'
import { ScanIssueDetails } from '@/components/ScanStatus'
import { SettingRow, SettingsGroup } from '@/components/settings/SettingsGroup'
import { TextLink } from '@/components/TextLink'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { detectedFolders, ungrantedDetectedFolders } from '@/lib/detected-folders'
import { skippedGrantMessage, useFolderAction } from '@/lib/folder-grant'
import { getFolderBasename } from '@/lib/source-name'
import { settingsTargetId } from '@/lib/settings-target'
import { useUsageProjects } from '@/lib/use-usage-projects'
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
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onNarrowFolder: (path: string) => Promise<SkippedGrant[]>
  onRevokeFolder: (path: string) => Promise<void>
  hiddenProjects: string[]
  onHideFolder: (path: string) => Promise<void>
  onShowFolder: (path: string) => Promise<void>
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
  hiddenProjects,
  onHideFolder,
  onShowFolder,
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
                      {skippedGrantMessage(entry)}
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
        <NotReadableYet
          home={home}
          folders={folders}
          hidden={hiddenProjects}
          onAddFolders={onAddFolders}
          onHideFolder={onHideFolder}
        />
        <HiddenFolders hidden={hiddenProjects} onShowFolder={onShowFolder} />
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

const NOT_READABLE_PREVIEW = 5

// Onboarding's own rows, minus every one a grant covers or the user hid, so the two never
// disagree. Main can't look inside an ungranted folder, so a folder deleted since Claude Code ran
// there stays listed until the user hides it: that is why this is a list and never a count that
// asks to reach zero.
function NotReadableYet({
  home,
  folders,
  hidden,
  onAddFolders,
  onHideFolder
}: {
  home: string
  folders: AllowedPathRow[]
  hidden: string[]
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder: (path: string) => Promise<void>
}): React.JSX.Element | null {
  const { data: catalog, resolveProjectLabel } = useUsageProjects()
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(
    () =>
      ungrantedDetectedFolders(
        detectedFolders(catalog?.locations ?? [], home, resolveProjectLabel),
        folders,
        hidden
      ),
    [catalog, home, resolveProjectLabel, folders, hidden]
  )
  if (rows.length === 0) return null
  return (
    <FolderListSection
      title="Not readable yet"
      count={rows.length}
      description="Claude Code has run in these folders. Add one, or a folder above it, to see its project skills and .mcp.json servers and to manage its plugins. Hide one Megatron can't use, such as a folder that no longer exists."
      showAll={showAll}
      onToggle={() => setShowAll((value) => !value)}
    >
      <ul aria-label="Folders not readable yet" className="flex flex-col">
        {(showAll ? rows : rows.slice(0, NOT_READABLE_PREVIEW)).map((row) => (
          <FolderAccessRow
            key={normalizeProjectPath(row.path)}
            path={row.path}
            label={row.label}
            onAddFolders={onAddFolders}
            onHideFolder={onHideFolder}
          />
        ))}
      </ul>
    </FolderListSection>
  )
}

// The undo for Hide. Hiding is display-only, so Show only brings the folder back into Megatron's
// lists after the rescan it starts; nothing on disk or in Claude Code's files changed either way.
function HiddenFolders({
  hidden,
  onShowFolder
}: {
  hidden: string[]
  onShowFolder: (path: string) => Promise<void>
}): React.JSX.Element | null {
  const { resolveProjectLabel } = useUsageProjects()
  const [showAll, setShowAll] = useState(false)
  if (hidden.length === 0) return null
  return (
    <FolderListSection
      title="Hidden"
      count={hidden.length}
      description="Megatron leaves these folders and everything inside them out of Skills, Plugins, MCP and the folder lists. Usage still counts their sessions."
      showAll={showAll}
      onToggle={() => setShowAll((value) => !value)}
    >
      <ul aria-label="Hidden folders" className="flex flex-col">
        {(showAll ? hidden : hidden.slice(0, NOT_READABLE_PREVIEW)).map((path) => (
          <HiddenFolderRow
            key={normalizeProjectPath(path)}
            path={path}
            label={resolveProjectLabel(path)}
            onShowFolder={onShowFolder}
          />
        ))}
      </ul>
    </FolderListSection>
  )
}

function HiddenFolderRow({
  path,
  label,
  onShowFolder
}: {
  path: string
  label: string
  onShowFolder: (path: string) => Promise<void>
}): React.JSX.Element {
  const show = useFolderAction(() => onShowFolder(path))
  return (
    <li className="flex min-w-0 flex-col gap-1 py-0.5">
      <div className="flex min-h-7 min-w-0 items-center gap-2 text-sm">
        <EyeOff className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <span title={path} className="min-w-0 flex-1 truncate text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={show.pending}
          aria-busy={show.pending}
          aria-label={`Show ${label}`}
          onClick={() => void show.run()}
          className="shrink-0"
        >
          {show.pending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Eye />
          )}
          Show
        </Button>
      </div>
      {show.error && (
        <p role="alert" className="flex items-center gap-2 pl-5.5 text-xs text-destructive">
          <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
          Could not show this folder. Please try again.
        </p>
      )}
    </li>
  )
}

// The first NOT_READABLE_PREVIEW rows, then "Show all N", so a long list never pushes the Index
// group out of reach.
function FolderListSection({
  title,
  count,
  description,
  showAll,
  onToggle,
  children
}: {
  title: string
  count: number
  description: string
  showAll: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">
          {title} <span className="font-normal text-muted-foreground">· {count}</span>
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
      {count > NOT_READABLE_PREVIEW && (
        <TextLink
          aria-expanded={showAll}
          onClick={onToggle}
          className="self-start text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? 'Show fewer' : `Show all ${count}`}
        </TextLink>
      )}
    </div>
  )
}

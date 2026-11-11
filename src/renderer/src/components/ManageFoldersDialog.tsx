import { useRef, useState } from 'react'
import { CircleAlert, Folder, FolderPlus, Info, LoaderCircle, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFolderBasename } from '@/lib/source-name'
import { isWithinProjectPath, normalizeProjectPath } from '../../../shared/project-path'
import {
  GRANT_GUIDANCE,
  type AllowedPathRow,
  type ProjectFolder,
  type SkippedGrant
} from '../../../shared/ipc'

interface ManageFoldersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  onAddFolders: () => Promise<SkippedGrant[]>
  onNarrowFolder: (path: string) => Promise<SkippedGrant[]>
  onRevokeFolder: (path: string) => Promise<void>
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

export function ManageFoldersDialog({
  open,
  onOpenChange,
  folders,
  projectCatalog,
  onAddFolders,
  onNarrowFolder,
  onRevokeFolder
}: ManageFoldersDialogProps): React.JSX.Element {
  const [pendingAction, setPendingAction] = useState<FolderAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<SkippedGrant[]>([])
  const actionInProgress = useRef(false)
  const loading = pendingAction !== null

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

  function handleOpenChange(next: boolean): void {
    if (!next) {
      setConfirming(null)
      setSkipped([])
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Folders</DialogTitle>
          <DialogDescription>
            {GRANT_GUIDANCE} Linked skills outside these folders require granting their target
            folder too.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 max-h-[320px] flex-col gap-2 overflow-y-auto py-2">
          {folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
              <Folder className="size-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No project folders granted</p>
              <p className="text-xs text-muted-foreground">
                Grant a project or parent folder to discover project-level skills.
              </p>
            </div>
          ) : (
            folders.map((folder) => {
              const name = getFolderBasename(folder.path)
              const pending =
                pendingAction !== null &&
                pendingAction.kind !== 'add' &&
                pendingAction.path === folder.path
              if (confirming === folder.path) {
                const count = projectsLosingAccess(folder.path)
                return (
                  <div
                    key={folder.path}
                    role="group"
                    aria-label={`Revoke ${name}`}
                    className="rounded-md border border-border bg-card p-2.5"
                  >
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
                )
              }
              return (
                <div
                  key={folder.path}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2.5 transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-none">{name}</p>
                      <p
                        title={folder.path}
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                      >
                        {folder.path}
                      </p>
                    </div>
                  </div>
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
                </div>
              )
            })
          )}
        </div>

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

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runAction({ kind: 'add' })}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <FolderPlus className="size-4" />
            Add Folder...
          </Button>
          <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

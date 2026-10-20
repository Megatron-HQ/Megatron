import { useRef, useState } from 'react'
import { CircleAlert, Folder, FolderPlus, LoaderCircle, Trash2 } from 'lucide-react'
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
import { useProjectLabel } from '@/lib/use-project-label'
import type { AllowedPathRow } from '../../../shared/ipc'

interface ManageFoldersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: AllowedPathRow[]
  onAddFolders: () => Promise<void>
  onRevokeFolder: (path: string) => Promise<void>
}

type FolderAction = { kind: 'add' } | { kind: 'revoke'; path: string }

export function ManageFoldersDialog({
  open,
  onOpenChange,
  folders,
  onAddFolders,
  onRevokeFolder
}: ManageFoldersDialogProps): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const [pendingAction, setPendingAction] = useState<FolderAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const actionInProgress = useRef(false)
  const loading = pendingAction !== null

  async function runAction(action: FolderAction): Promise<void> {
    if (actionInProgress.current) return
    actionInProgress.current = true
    setPendingAction(action)
    setError(null)
    try {
      if (action.kind === 'add') await onAddFolders()
      else await onRevokeFolder(action.path)
    } catch {
      setError(
        action.kind === 'add'
          ? 'Could not add folders. Please try again.'
          : 'Could not revoke folder access. Please try again.'
      )
    } finally {
      actionInProgress.current = false
      setPendingAction(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Folders</DialogTitle>
          <DialogDescription>
            Grant a project or a parent folder containing several projects. Megatron discovers{' '}
            <code className="font-mono text-xs">.claude/skills</code> in child repositories and
            reads their plugin settings. Linked skills outside these folders require granting their
            target folder too.
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
            folders.map((folder) => (
              <div
                key={folder.path}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2.5 transition-colors"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-none">
                      {resolveProjectLabel(folder.path)}
                    </p>
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
                      onClick={() => void runAction({ kind: 'revoke', path: folder.path })}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                      aria-label={`Revoke access to ${resolveProjectLabel(folder.path)}`}
                      aria-busy={
                        pendingAction?.kind === 'revoke' && pendingAction.path === folder.path
                      }
                    >
                      {pendingAction?.kind === 'revoke' && pendingAction.path === folder.path ? (
                        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Revoke folder access</TooltipContent>
                </Tooltip>
              </div>
            ))
          )}
        </div>

        {pendingAction && (
          <p role="status" className="text-xs text-muted-foreground">
            {pendingAction.kind === 'add' ? 'Adding folders…' : 'Revoking folder access…'}
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
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

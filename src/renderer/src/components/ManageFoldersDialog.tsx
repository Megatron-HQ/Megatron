import { useState } from 'react'
import { Folder, FolderPlus, Trash2 } from 'lucide-react'
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
import type { AllowedPathRow } from '../../../shared/ipc'

interface ManageFoldersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: AllowedPathRow[]
  onAddFolders: () => Promise<void>
  onRevokeFolder: (path: string) => Promise<void>
}

export function ManageFoldersDialog({
  open,
  onOpenChange,
  folders,
  onAddFolders,
  onRevokeFolder
}: ManageFoldersDialogProps): React.JSX.Element {
  const [loading, setLoading] = useState(false)

  async function handleAdd(): Promise<void> {
    setLoading(true)
    try {
      await onAddFolders()
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(path: string): Promise<void> {
    setLoading(true)
    try {
      await onRevokeFolder(path)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Folders</DialogTitle>
          <DialogDescription>
            Megatron scans granted repository roots for{' '}
            <code className="font-mono text-xs">.claude/skills</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto py-2">
          {folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
              <Folder className="size-8 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">No repository folders granted</p>
              <p className="text-xs text-muted-foreground">
                Grant access to a local repository to discover project-level skills.
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
                      {getFolderBasename(folder.path)}
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
                      onClick={() => handleRevoke(folder.path)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Revoke access to ${getFolderBasename(folder.path)}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Revoke folder access</TooltipContent>
                </Tooltip>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <FolderPlus className="size-4" />
            Add Repository...
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

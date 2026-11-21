import { useEffect } from 'react'
import { FolderAccessRow } from '@/components/FolderAccessRow'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useProjectLabel } from '@/lib/use-project-label'
import { normalizeProjectPath } from '../../../shared/project-path'
import type { SkippedGrant } from '../../../shared/ipc'

// A notice naming several projects can't aim one picker, so Review… lists them here, each with
// its own Add… and Hide. Rows leave as grants and hides land; the dialog closes with the last.
export function FolderAccessDialog({
  open,
  onOpenChange,
  projects,
  onAddFolders,
  onHideFolder
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: string[]
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder: (path: string) => Promise<void>
}): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const empty = projects.length === 0
  useEffect(() => {
    if (open && empty) onOpenChange(false)
  }, [open, empty, onOpenChange])
  return (
    <Dialog open={open && !empty} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Folders that need access</DialogTitle>
          <DialogDescription>
            Add a folder, or one above it, to read it. Hide one Megatron can&apos;t use, such as a
            folder that no longer exists. Claude Code&apos;s files are never changed.
          </DialogDescription>
        </DialogHeader>
        <ul
          aria-label="Folders that need access"
          className="flex max-h-80 flex-col overflow-y-auto"
        >
          {projects.map((path) => (
            <FolderAccessRow
              key={normalizeProjectPath(path)}
              path={path}
              label={resolveProjectLabel(path)}
              onAddFolders={onAddFolders}
              onHideFolder={onHideFolder}
            />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

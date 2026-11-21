import { CircleAlert, EyeOff, Folder, FolderPlus, Info, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { skippedGrantMessage, useFolderGrant, useFolderAction } from '@/lib/folder-grant'
import { cn } from '@/lib/utils'
import type { SkippedGrant } from '../../../shared/ipc'

// One folder Claude Code ran in that Megatron can't read: Settings' "Not readable yet" list and
// the multi-project Review… dialog share it. The path is one main listed; main matches it against
// its own records before aiming the picker there or hiding it.
export function FolderAccessRow({
  path,
  label,
  onAddFolders,
  onHideFolder
}: {
  path: string
  label: string
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder: (path: string) => Promise<void>
}): React.JSX.Element {
  const grant = useFolderGrant(() => onAddFolders(path))
  const hide = useFolderAction(() => onHideFolder(path))
  const busy = grant.pending || hide.pending
  return (
    <li className="flex min-w-0 flex-col gap-1 py-0.5">
      <div className="flex min-h-7 min-w-0 items-center gap-2 text-sm">
        <Folder className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <span title={path} className="min-w-0 flex-1 truncate">
          {label}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          aria-busy={grant.pending}
          aria-label={`Add ${label}…`}
          onClick={() => void grant.grant()}
          className="shrink-0"
        >
          {grant.pending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <FolderPlus />
          )}
          Add…
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-busy={hide.pending}
          aria-label={`Hide ${label}`}
          onClick={() => void hide.run()}
          className="shrink-0 text-muted-foreground"
        >
          {hide.pending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <EyeOff />
          )}
          Hide
        </Button>
      </div>
      <FolderActionFeedback
        className="pl-5.5"
        pending={grant.pending}
        skipped={grant.skipped}
        error={
          grant.error
            ? 'Could not add folders. Please try again.'
            : hide.error
              ? 'Could not hide this folder. Please try again.'
              : null
        }
      />
    </li>
  )
}

// The inline result of an in-place folder action, so every place that offers one reports it the
// same way: progress, an already-covered pick in muted ink, a failure in destructive ink.
export function FolderActionFeedback({
  pending,
  skipped,
  error,
  className
}: {
  pending: boolean
  skipped: SkippedGrant[]
  error: string | null
  className?: string
}): React.JSX.Element | null {
  if (!pending && skipped.length === 0 && error === null) return null
  return (
    <div className={cn('flex flex-col gap-1 text-xs text-muted-foreground', className)}>
      {pending && <p role="status">Adding folders…</p>}
      {skipped.length > 0 && (
        <div role="status" className="flex gap-2">
          <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
          <ul className="min-w-0 space-y-0.5">
            {skipped.map((entry) => (
              <li key={entry.path} className="break-words">
                {skippedGrantMessage(entry)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-2 text-destructive">
          <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

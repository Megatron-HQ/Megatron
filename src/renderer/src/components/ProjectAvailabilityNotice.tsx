import { useState } from 'react'
import { CircleAlert, EyeOff, FolderPlus, LoaderCircle } from 'lucide-react'
import { FolderAccessDialog } from '@/components/FolderAccessDialog'
import { FolderActionFeedback } from '@/components/FolderAccessRow'
import { Button } from '@/components/ui/button'
import { useFolderGrant, useFolderAction } from '@/lib/folder-grant'
import type { ProjectFolder, SkippedGrant } from '../../../shared/ipc'

const HIDE_ERROR = 'Could not hide this folder. Please try again.'
const MISSING_MESSAGE =
  'This project folder is missing. Showing its last available data. Check its location if it moved.'

export function ProjectAvailabilityNotice({
  status,
  message,
  projects,
  onAddFolders,
  onHideFolder
}: {
  status?: ProjectFolder['status']
  // Replaces the needs-access wording, so a screen can say what this grant unlocks there.
  message?: string
  // The recorded project folders this notice is about, as main listed them. One aims the picker
  // and offers Hide; several open Review…, since one picker can't be aimed at all of them.
  projects?: string[]
  onAddFolders?: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder?: (path: string) => Promise<void>
}): React.JSX.Element | null {
  if (status === undefined || status === 'available') return null
  const only = projects?.length === 1 ? projects[0] : undefined
  if (status === 'needs_access' && onAddFolders) {
    const text = message ?? 'Folder access is required. Add this project or a parent folder.'
    if (projects && projects.length > 1 && onHideFolder)
      return (
        <ReviewNotice
          message={text}
          projects={projects}
          onAddFolders={onAddFolders}
          onHideFolder={onHideFolder}
        />
      )
    return (
      <GrantNotice
        message={text}
        onAddFolders={() => onAddFolders(only)}
        onHide={only && onHideFolder ? () => onHideFolder(only) : undefined}
      />
    )
  }
  if (status === 'missing' && only && onHideFolder)
    return <MissingNotice onHide={() => onHideFolder(only)} />
  return (
    <p
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
    >
      <CircleAlert className="mt-0.5 size-3 shrink-0" />
      <span>
        {status === 'needs_access'
          ? (message ??
            'Folder access is required. Grant this project or a parent folder in Settings.')
          : status === 'missing'
            ? MISSING_MESSAGE
            : 'This folder could not be refreshed. Showing its last available data. Megatron will retry automatically.'}
      </span>
    </p>
  )
}

function NoticeBand({
  message,
  actions,
  feedback
}: {
  message: string
  actions: React.ReactNode
  feedback?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
        <p role="status" className="min-w-0 flex-1">
          {message}
        </p>
        {actions}
      </div>
      {feedback}
    </div>
  )
}

function HideButton({
  pending,
  onClick
}: {
  pending: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={pending}
      aria-busy={pending}
      onClick={onClick}
      className="shrink-0"
    >
      {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <EyeOff />}
      Hide
    </Button>
  )
}

// The picker opens here rather than in Settings: the user is looking at what the grant unlocks, so
// the result lands beside it. With one project it opens inside that folder; main checks the folder
// against its own records first, so the renderer never names an arbitrary path.
function GrantNotice({
  message,
  onAddFolders,
  onHide
}: {
  message: string
  onAddFolders: () => Promise<SkippedGrant[]>
  onHide?: () => Promise<void>
}): React.JSX.Element {
  const { grant, pending, skipped, error } = useFolderGrant(onAddFolders)
  const hide = useFolderAction(onHide ?? (async () => undefined))
  return (
    <NoticeBand
      message={message}
      actions={
        <>
          {onHide && <HideButton pending={hide.pending} onClick={() => void hide.run()} />}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={pending || hide.pending}
            aria-busy={pending}
            onClick={() => void grant()}
            className="shrink-0"
          >
            {pending ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <FolderPlus />
            )}
            Add folder…
          </Button>
        </>
      }
      feedback={
        <FolderActionFeedback
          className="pl-5"
          pending={pending}
          skipped={skipped}
          error={
            error ? 'Could not add folders. Please try again.' : hide.error ? HIDE_ERROR : null
          }
        />
      }
    />
  )
}

function ReviewNotice({
  message,
  projects,
  onAddFolders,
  onHideFolder
}: {
  message: string
  projects: string[]
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder: (path: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <NoticeBand
      message={message}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
            className="shrink-0"
          >
            <FolderPlus />
            Review…
          </Button>
          <FolderAccessDialog
            open={open}
            onOpenChange={setOpen}
            projects={projects}
            onAddFolders={onAddFolders}
            onHideFolder={onHideFolder}
          />
        </>
      }
    />
  )
}

// Megatron can't tell a deleted folder from a moved one, and the CLI can't act on a folder that
// is gone, so Hide is the one way to stop seeing it.
function MissingNotice({ onHide }: { onHide: () => Promise<void> }): React.JSX.Element {
  const hide = useFolderAction(onHide)
  return (
    <NoticeBand
      message={MISSING_MESSAGE}
      actions={<HideButton pending={hide.pending} onClick={() => void hide.run()} />}
      feedback={
        <FolderActionFeedback
          className="pl-5"
          pending={false}
          skipped={[]}
          error={hide.error ? HIDE_ERROR : null}
        />
      }
    />
  )
}

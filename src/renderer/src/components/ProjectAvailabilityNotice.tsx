import { CircleAlert } from 'lucide-react'
import type { ProjectFolder } from '../../../shared/ipc'

export function ProjectAvailabilityNotice({
  status
}: {
  status?: ProjectFolder['status']
}): React.JSX.Element | null {
  if (status === undefined || status === 'available') return null
  return (
    <p
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
    >
      <CircleAlert className="mt-0.5 size-3 shrink-0" />
      <span>
        {status === 'needs_access'
          ? 'Folder access is required. Grant this project or a parent folder in Settings.'
          : status === 'missing'
            ? 'This project folder is missing. Showing its last available data. Check its location if it moved.'
            : 'This folder could not be fully refreshed. Showing the last available data.'}
      </span>
    </p>
  )
}

import { FolderOpen } from 'lucide-react'

// Header button on every Projects filter. Icon-only below 1000px, so the bar still fits beside a
// 220px sidebar at the 860px minimum window.
export function ManageFoldersButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Manage Folders"
      title="Manage Folders"
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FolderOpen className="size-3.5" />
      <span className="max-[1000px]:sr-only">Manage Folders</span>
    </button>
  )
}

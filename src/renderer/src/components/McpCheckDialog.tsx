import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useProjectLabel } from '@/lib/use-project-label'

// Shown once, before the first connection check: the check runs `claude mcp list`, which starts
// the user's servers (docs/mcp-servers.md, Live check). Confirming it is remembered.
export function McpCheckDialog({
  projectPath,
  onConfirm,
  onCancel
}: {
  // undefined: closed. null: the general check. A path: that project's check.
  projectPath: string | null | undefined
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const where =
    projectPath === null || projectPath === undefined
      ? 'your user servers, plugin servers, and claude.ai connectors'
      : `the servers of ${resolveProjectLabel(projectPath)}`
  return (
    <Dialog open={projectPath !== undefined} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Check MCP connections?</DialogTitle>
          <DialogDescription>
            Megatron runs <span className="font-mono text-xs">claude mcp list</span> for {where}.
            That starts each approved local server and contacts each remote one, which can take a
            few seconds. Megatron keeps only each server&apos;s name and status, for this session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90"
          >
            Check connections
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

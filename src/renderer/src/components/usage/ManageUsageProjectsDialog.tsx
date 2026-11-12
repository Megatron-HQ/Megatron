import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUsageProjects, USAGE_PROJECTS_QUERY_KEY } from '@/lib/use-usage-projects'
import { claudeAppChatLabel } from '@/lib/usage-project-label'
import type { UsageProject, UsageProjectCatalog } from '../../../../shared/usage-projects'
import { matchesUsageProjectSearch } from '../../../../shared/usage-projects'

const STATUS_LABEL = {
  available: 'Available',
  missing: 'Folder missing',
  unavailable: 'Folder inaccessible',
  needs_access: 'Folder access not granted'
}

// A Claude app chat's folder sits in Claude's own app data, which Megatron never asks to read, so
// it gets no folder-access status.
function projectName(project: UsageProject): string {
  return project.chat ? claudeAppChatLabel(project.chat) : project.label
}

export function ManageUsageProjectsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const projects = useUsageProjects()
  const [search, setSearch] = useState('')
  const [targets, setTargets] = useState<Record<string, string>>({})
  const searchInput = useRef<HTMLInputElement>(null)
  const headings = useRef(new Map<string, HTMLHeadingElement>())
  const pendingFocusProjectId = useRef<string | null>(null)
  useEffect(() => {
    const projectId = pendingFocusProjectId.current
    if (projectId === null) return
    const target = headings.current.get(projectId) ?? searchInput.current
    target?.focus()
    pendingFocusProjectId.current = null
  }, [projects.data])
  const mutation = useMutation({
    mutationFn: (
      action:
        | { kind: 'link'; sourceId: string; targetId: string }
        | { kind: 'unlink'; locationId: string }
    ) =>
      action.kind === 'link'
        ? window.api.linkUsageProjects({ sourceId: action.sourceId, targetId: action.targetId })
        : window.api.unlinkUsageProject(action.locationId),
    onSuccess: async (catalog: UsageProjectCatalog, action) => {
      pendingFocusProjectId.current = action.kind === 'link' ? action.targetId : action.locationId
      queryClient.setQueryData(USAGE_PROJECTS_QUERY_KEY, catalog)
      setTargets({})
      await queryClient.invalidateQueries({ queryKey: ['usage'] })
    }
  })
  const needle = search.trim().toLowerCase()
  const visible = (projects.data?.projects ?? []).filter((project) =>
    matchesUsageProjectSearch(needle, [
      projectName(project),
      ...project.locations.map((location) => location.path)
    ])
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage projects</DialogTitle>
          <DialogDescription>
            Link locations belonging to the same project to combine their Usage history. Recorded
            paths are retained, and links can be undone.
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={searchInput}
          type="search"
          aria-label="Find project locations"
          placeholder="Find a project or location…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {projects.isError && (
          <p role="alert" className="text-[12px]">
            Could not load projects.{' '}
            <button className="underline" onClick={() => void projects.refetch()}>
              Retry
            </button>
          </p>
        )}
        {mutation.isError && (
          <p role="alert" className="text-[12px] text-destructive">
            Could not update project locations. Try again.
          </p>
        )}
        {mutation.isPending && (
          <p role="status" className="text-[12px] text-muted-foreground">
            Updating project history…
          </p>
        )}
        <div className="min-h-0 overflow-y-auto pr-1">
          {projects.isPending ? (
            <p className="py-6 text-[13px] text-muted-foreground">Loading projects…</p>
          ) : projects.isError && !projects.data ? null : visible.length === 0 ? (
            <p className="py-6 text-[13px] text-muted-foreground">No matching projects.</p>
          ) : (
            visible.map((project) => (
              <article
                key={project.id}
                aria-label={projectName(project)}
                className="flex flex-col gap-3 border-b border-border py-4 first:pt-1 last:border-0"
              >
                <h3
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) headings.current.set(project.id, element)
                    else headings.current.delete(project.id)
                  }}
                  className="rounded-sm text-[13px] font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {projectName(project)}
                </h3>
                <ul className="flex flex-col gap-2">
                  {project.locations.map((location) => (
                    <li
                      key={location.id}
                      className="flex min-w-0 items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="break-all font-mono text-[11px]">{location.path}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {location.id === project.id
                            ? 'Primary location · '
                            : 'Linked location · '}
                          {project.chat ? 'Claude app chat' : STATUS_LABEL[location.status]}
                        </p>
                      </div>
                      {location.linkedTo && !location.inferredOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 px-2 text-[11px]"
                          disabled={mutation.isPending}
                          aria-label={`Unlink ${location.path}`}
                          onClick={() =>
                            mutation.mutate({ kind: 'unlink', locationId: location.id })
                          }
                        >
                          Unlink
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {project.possibleMatches.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Similar project names found. Link them only if they belong to the same project.
                  </p>
                )}
                {(projects.data?.projects.length ?? 0) > 1 && (
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <select
                      aria-label={`Link ${projectName(project)} to project`}
                      value={targets[project.id] ?? ''}
                      disabled={mutation.isPending}
                      onChange={(event) =>
                        setTargets((current) => ({ ...current, [project.id]: event.target.value }))
                      }
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Link to an existing project…</option>
                      {(projects.data?.projects ?? [])
                        .filter((target) => target.id !== project.id)
                        .sort(
                          (a, b) =>
                            Number(project.possibleMatches.includes(b.id)) -
                            Number(project.possibleMatches.includes(a.id))
                        )
                        .map((target) => (
                          <option key={target.id} value={target.id}>
                            {projectName(target)} · {target.path}
                          </option>
                        ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutation.isPending || !targets[project.id]}
                      onClick={() =>
                        mutation.mutate({
                          kind: 'link',
                          sourceId: project.id,
                          targetId: targets[project.id]
                        })
                      }
                    >
                      Link locations
                    </Button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, FolderGit2, Laptop, List, User } from 'lucide-react'
import { useMemo, useState } from 'react'
import { listFilterProjects, type FilterProject, type PluginFilter } from '@/lib/plugin-filter'
import { cn } from '@/lib/utils'
import type { PluginRow, PluginScope } from '../../../shared/ipc'

const NAV_ROW = 'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors'
const NAV_SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const NAV_IDLE = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

export function PluginSidebar({
  plugins,
  filter,
  onFilterChange
}: {
  plugins: PluginRow[]
  filter: PluginFilter
  onFilterChange: (filter: PluginFilter) => void
}): React.JSX.Element {
  const projectProjects = useMemo(() => listFilterProjects(plugins, 'project'), [plugins])
  const localProjects = useMemo(() => listFilterProjects(plugins, 'local'), [plugins])

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <nav className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'all' })}
            className={cn(NAV_ROW, filter.kind === 'all' ? NAV_SELECTED : NAV_IDLE)}
          >
            <List className="size-4 shrink-0" />
            <span>All Plugins</span>
          </button>

          {/* No expander: user scope isn't anchored to a project, so it has nothing to list. */}
          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'user' })}
            className={cn(NAV_ROW, filter.kind === 'user' ? NAV_SELECTED : NAV_IDLE)}
          >
            <User className="size-4 shrink-0" />
            <span>User</span>
          </button>

          <ScopeGroup
            scope="project"
            label="Project"
            Icon={FolderGit2}
            emptyLabel="No project installs"
            projects={projectProjects}
            filter={filter}
            onFilterChange={onFilterChange}
          />

          <ScopeGroup
            scope="local"
            label="Local"
            Icon={Laptop}
            emptyLabel="No local installs"
            projects={localProjects}
            filter={filter}
            onFilterChange={onFilterChange}
          />
        </nav>
      </div>
    </div>
  )
}

// Project and Local are the same control — a scope row that both selects and expands, over a list
// of the project roots holding installs of that scope. The same root can appear under both,
// because .claude/settings.json and .claude/settings.local.json are two independent switches.
function ScopeGroup({
  scope,
  label,
  Icon,
  emptyLabel,
  projects,
  filter,
  onFilterChange
}: {
  scope: Extract<PluginScope, 'project' | 'local'>
  label: string
  Icon: typeof FolderGit2
  emptyLabel: string
  projects: FilterProject[]
  filter: PluginFilter
  onFilterChange: (filter: PluginFilter) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const selectedPath = filter.kind === scope ? filter.projectPath : undefined
  const groupSelected = filter.kind === scope && !selectedPath

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'flex h-8 items-center justify-between rounded-md px-2 text-sm transition-colors',
          groupSelected
            ? NAV_SELECTED
            : filter.kind === scope
              ? 'text-foreground hover:bg-accent'
              : NAV_IDLE
        )}
      >
        <button
          type="button"
          onClick={() => {
            onFilterChange({ kind: scope })
            setExpanded((open) => !open)
          }}
          className="flex h-full flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-4 shrink-0" />
          <span>{label}</span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label.toLowerCase()} plugin list`}
          className="-mr-1 shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="my-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/70 py-0.5 pl-2">
              {projects.length === 0 ? (
                <div className="px-2 py-1 text-[11px] text-muted-foreground italic">
                  {emptyLabel}
                </div>
              ) : (
                projects.map((project) => {
                  const isSelected = selectedPath === project.path
                  return (
                    <button
                      key={project.path}
                      type="button"
                      title={project.path}
                      onClick={() => onFilterChange({ kind: scope, projectPath: project.path })}
                      className={cn(
                        'flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
                        isSelected
                          ? 'bg-accent-lime font-medium text-accent-lime-foreground'
                          : NAV_IDLE
                      )}
                    >
                      <span className="truncate">{project.name}</span>
                      <span
                        className={cn(
                          'py-0.2 ml-auto shrink-0 rounded px-1.5 font-mono text-[12px] tabular-nums',
                          isSelected
                            ? 'bg-accent-lime-foreground/15 text-accent-lime-foreground'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {project.count}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

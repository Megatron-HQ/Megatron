import { motion } from 'motion/react'
import { List, User } from 'lucide-react'
import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { createPluginRows, type PluginFilter } from '@/lib/plugin-filter'
import { buildProjectTree } from '@/lib/project-tree'
import { ProjectNavigation } from '@/components/ProjectNavigation'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { AllowedPathRow, PluginRow, ProjectFolder } from '../../../shared/ipc'

const NAV_ROW =
  'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors'
const NAV_SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const NAV_IDLE = 'text-muted-foreground hover:text-accent-foreground'

export function PluginSidebar({
  plugins,
  filter,
  onFilterChange,
  folders,
  projectCatalog,
  expandedProjects,
  setExpandedProjects
}: {
  plugins: PluginRow[]
  filter: PluginFilter
  onFilterChange: (filter: PluginFilter) => void
  folders: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  expandedProjects: Set<string>
  setExpandedProjects: Dispatch<SetStateAction<Set<string>>>
}): React.JSX.Element {
  const rows = useMemo(() => createPluginRows(plugins), [plugins])
  const projects = useMemo(
    () =>
      buildProjectTree(
        folders,
        projectCatalog,
        rows
          .filter((row) => row.context.kind === 'project')
          .map((row) => ({ path: row.repositoryPath!, count: 1 }))
      ),
    [folders, projectCatalog, rows]
  )
  const unknownCount = rows.filter((row) => row.context.kind === 'unknown').length
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLElement>()
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <nav
          ref={containerRef}
          className="relative flex flex-col gap-0.5"
          onMouseLeave={onMouseLeave}
        >
          {highlightRect && (
            <motion.div
              className="pointer-events-none absolute z-0 rounded-md bg-accent"
              initial={false}
              animate={{
                top: highlightRect.top,
                left: highlightRect.left,
                width: highlightRect.width,
                height: highlightRect.height
              }}
              transition={transition}
            />
          )}
          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'all' })}
            onMouseEnter={(event) => onItemHover(event.currentTarget)}
            className={cn(NAV_ROW, filter.kind === 'all' ? NAV_SELECTED : NAV_IDLE)}
          >
            <List className="size-4 shrink-0" />
            <span>All Plugins</span>
          </button>
          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'user' })}
            onMouseEnter={(event) => onItemHover(event.currentTarget)}
            className={cn(NAV_ROW, filter.kind === 'user' ? NAV_SELECTED : NAV_IDLE)}
          >
            <User className="size-4 shrink-0" />
            <span>User</span>
          </button>
          <ProjectNavigation
            nodes={projects}
            selected={filter.kind === 'projects'}
            selection={
              filter.kind === 'projects' ? { path: filter.projectPath, exact: filter.exact } : {}
            }
            expanded={expandedProjects}
            setExpanded={setExpandedProjects}
            onSelect={(path, exact) =>
              onFilterChange({ kind: 'projects', projectPath: path, exact })
            }
            onItemHover={onItemHover}
            unknown={{
              count: unknownCount,
              selected: filter.kind === 'unknown',
              onSelect: () => onFilterChange({ kind: 'unknown' })
            }}
          />
        </nav>
      </div>
    </div>
  )
}

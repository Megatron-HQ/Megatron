import { motion } from 'motion/react'
import { Blocks, Cloud, List, Radar, User } from 'lucide-react'
import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import { AppBrand } from '@/components/AppBrand'
import { ProjectNavigation } from '@/components/ProjectNavigation'
import { mcpFilterCounts, type McpFilter, type McpFilterKind } from '@/lib/mcp-filter'
import { buildProjectTree, snapProjectSelection } from '@/lib/project-tree'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { AllowedPathRow, McpServerRow, ProjectFolder } from '../../../shared/ipc'

const NAV_ROW =
  'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors'
const NAV_SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const NAV_IDLE = 'text-muted-foreground hover:text-accent-foreground'

type FlatKind = Exclude<McpFilterKind, 'projects'>

const LEADING: { kind: FlatKind; label: string; Icon: typeof List }[] = [
  { kind: 'all', label: 'All servers', Icon: List },
  { kind: 'user', label: 'User', Icon: User }
]
const TRAILING: { kind: FlatKind; label: string; Icon: typeof List }[] = [
  { kind: 'plugins', label: 'Plugins', Icon: Blocks },
  { kind: 'connectors', label: 'claude.ai', Icon: Cloud },
  { kind: 'observed', label: 'Observed', Icon: Radar }
]

function Count({ count, selected }: { count: number; selected: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded px-1.5 py-0.2 font-mono text-[12px] tabular-nums',
        selected
          ? 'bg-accent-lime-foreground/15 text-accent-lime-foreground'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {count}
    </span>
  )
}

export function McpSidebar({
  servers,
  filter,
  onFilterChange,
  onFilterSnap,
  folders,
  projectCatalog,
  home,
  expandedProjects,
  setExpandedProjects
}: {
  servers: McpServerRow[]
  filter: McpFilter
  onFilterChange: (filter: McpFilter) => void
  // Replaces the filter without leaving a detail view, for selections whose row disappeared.
  onFilterSnap: (filter: McpFilter) => void
  folders: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  home: string
  expandedProjects: Set<string>
  setExpandedProjects: Dispatch<SetStateAction<Set<string>>>
}): React.JSX.Element {
  const counts = useMemo(() => mcpFilterCounts(servers), [servers])
  const projects = useMemo(
    () =>
      buildProjectTree(
        folders,
        projectCatalog,
        servers
          .filter((server) => server.kind !== 'plugin')
          .flatMap((server) => server.projectPaths.map((path) => ({ path, count: 1 }))),
        { home }
      ),
    [folders, projectCatalog, servers, home]
  )
  useEffect(() => {
    if (filter.kind !== 'projects') return
    const selection = { path: filter.projectPath, exact: filter.exact }
    const snapped = snapProjectSelection(projects, selection)
    if (snapped !== selection)
      onFilterSnap({ kind: 'projects', projectPath: snapped.path, exact: snapped.exact })
  }, [projects, filter, onFilterSnap])
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLElement>()

  const flatRow = ({ kind, label, Icon }: (typeof LEADING)[number]): React.JSX.Element => {
    const selected = filter.kind === kind
    return (
      <button
        key={kind}
        type="button"
        onClick={() => onFilterChange({ kind } as McpFilter)}
        onMouseEnter={(event) => onItemHover(event.currentTarget)}
        className={cn(NAV_ROW, selected ? NAV_SELECTED : NAV_IDLE)}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
        <Count count={counts[kind]} selected={selected} />
      </button>
    )
  }

  return (
    <div className="flex w-[220px] shrink-0 flex-col">
      <AppBrand />
      <div className="flex-1 overflow-y-auto px-2">
        <nav
          ref={containerRef}
          aria-label="MCP server filters"
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
          {LEADING.map(flatRow)}
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
            emptyLabel="without MCP servers"
          />
          {TRAILING.map(flatRow)}
        </nav>
      </div>
    </div>
  )
}

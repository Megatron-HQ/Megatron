import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Blocks, ChevronRight, Globe, List } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ContextBudgetDialog } from '@/components/ContextBudgetDialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { budgetStatus } from '@/lib/context-budget'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import { getPluginBareName } from '@/lib/source-name'
import { projectRootForSkill, type SourceFilter } from '@/lib/source-filter'
import type { AllowedPathRow, ContextBudget, ProjectFolder, SkillRow } from '../../../shared/ipc'

import { ProjectNavigation } from '@/components/ProjectNavigation'
import { buildProjectTree } from '@/lib/project-tree'

interface SidebarProps {
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  contextBudget: ContextBudget
  onSelectSkill: (id: number) => void
  skills?: SkillRow[]
  folders?: AllowedPathRow[]
  projectCatalog: ProjectFolder[]
  expandedProjects: Set<string>
  setExpandedProjects: Dispatch<SetStateAction<Set<string>>>
}

interface PluginSidebarItem {
  pluginName: string
  displayName: string
  count: number
}

export function Sidebar({
  filter,
  onFilterChange,
  contextBudget,
  onSelectSkill,
  skills = [],
  folders = [],
  projectCatalog,
  expandedProjects,
  setExpandedProjects
}: SidebarProps): React.JSX.Element {
  const [pluginExpanded, setPluginExpanded] = useState(false)
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLElement>()

  const projects = useMemo(
    () =>
      buildProjectTree(
        folders,
        projectCatalog,
        skills
          .filter((skill) => skill.source_type === 'project')
          .map((skill) => ({
            path: projectRootForSkill(skill),
            count: 1
          }))
      ),
    [folders, projectCatalog, skills]
  )

  const plugins = useMemo<PluginSidebarItem[]>(() => {
    const map = new Map<string, PluginSidebarItem>()

    for (const skill of skills) {
      if (skill.source_type !== 'plugin') continue
      const rawName = skill.plugin_name || 'plugin'
      const bareName = getPluginBareName(rawName)
      const key = rawName
      let item = map.get(key)
      if (!item) {
        item = {
          pluginName: rawName,
          displayName: bareName,
          count: 0
        }
        map.set(key, item)
      }
      item.count++
    }

    const items = Array.from(map.values())
    for (const item of items) {
      if (
        items.some(
          (other) =>
            other !== item &&
            getPluginBareName(other.pluginName) === getPluginBareName(item.pluginName)
        )
      ) {
        item.displayName = item.pluginName
      }
    }
    return items.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [skills])

  function handlePluginClick(): void {
    onFilterChange({ kind: 'plugin' })
    setPluginExpanded((open) => !open)
    onItemHover(null)
  }

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
            onMouseEnter={(e) => onItemHover(e.currentTarget)}
            className={cn(
              'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
              filter.kind === 'all'
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:text-accent-foreground'
            )}
          >
            <List className="size-4 shrink-0" />
            <span>All Skills</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'global' })}
            onMouseEnter={(e) => onItemHover(e.currentTarget)}
            className={cn(
              'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
              filter.kind === 'global'
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:text-accent-foreground'
            )}
          >
            <Globe className="size-4 shrink-0" />
            <span>Global</span>
          </button>

          <ProjectNavigation
            nodes={projects}
            selected={filter.kind === 'project'}
            selection={
              filter.kind === 'project' ? { path: filter.projectRoot, exact: filter.exact } : {}
            }
            expanded={expandedProjects}
            setExpanded={setExpandedProjects}
            onSelect={(path, exact) =>
              onFilterChange({ kind: 'project', projectRoot: path, exact })
            }
            onItemHover={onItemHover}
          />

          <div className="flex flex-col">
            <div
              onMouseEnter={(e) => onItemHover(e.currentTarget)}
              className={cn(
                'relative z-10 flex h-8 items-center justify-between rounded-md px-2 text-sm transition-colors',
                filter.kind === 'plugin' && !filter.pluginName
                  ? 'bg-accent-lime text-accent-lime-foreground'
                  : filter.kind === 'plugin'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-accent-foreground'
              )}
            >
              <button
                type="button"
                onClick={handlePluginClick}
                className="flex h-full flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Blocks className="size-4 shrink-0" />
                <span>Plugin</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPluginExpanded((open) => !open)
                  onItemHover(null)
                }}
                aria-expanded={pluginExpanded}
                aria-label={pluginExpanded ? 'Collapse plugin list' : 'Expand plugin list'}
                className="-mr-1 shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform duration-200',
                    pluginExpanded && 'rotate-90'
                  )}
                />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {pluginExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="my-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/70 pl-2 py-0.5">
                    {plugins.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground italic">
                        No plugins installed
                      </div>
                    ) : (
                      plugins.map((plugin) => {
                        const isSelected =
                          filter.kind === 'plugin' && filter.pluginName === plugin.pluginName
                        return (
                          <button
                            key={plugin.pluginName}
                            type="button"
                            title={plugin.pluginName}
                            onClick={() =>
                              onFilterChange({ kind: 'plugin', pluginName: plugin.pluginName })
                            }
                            onMouseEnter={(e) => onItemHover(e.currentTarget)}
                            className={cn(
                              'relative z-10 flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
                              isSelected
                                ? 'bg-accent-lime font-medium text-accent-lime-foreground'
                                : 'text-muted-foreground hover:text-accent-foreground'
                            )}
                          >
                            <span className="truncate">{plugin.displayName}</span>
                            <span
                              className={cn(
                                'ml-auto shrink-0 rounded px-1.5 py-0.2 font-mono text-[12px] tabular-nums',
                                isSelected
                                  ? 'bg-accent-lime-foreground/15 text-accent-lime-foreground'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {plugin.count}
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
        </nav>
      </div>

      <ContextBudgetReadout
        budget={contextBudget}
        skills={skills}
        onSelectSkill={onSelectSkill}
        onViewDisabled={() => onFilterChange({ kind: 'disabled' })}
        onViewUserInvocableOnly={() => onFilterChange({ kind: 'user-invocable-only' })}
      />
    </div>
  )
}

function ContextBudgetReadout({
  budget,
  skills,
  onSelectSkill,
  onViewDisabled,
  onViewUserInvocableOnly
}: {
  budget: ContextBudget
  skills: SkillRow[]
  onSelectSkill: (id: number) => void
  onViewDisabled: () => void
  onViewUserInvocableOnly: () => void
}): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  const status = budgetStatus(budget)
  const statusLabel =
    status === 'over' ? 'Over budget' : status === 'warning' ? 'Approaching budget' : 'Under budget'

  return (
    <div className="border-t border-border p-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                status === 'over' && 'bg-destructive',
                status === 'warning' && 'bg-warning',
                status === 'ok' && 'bg-success'
              )}
            />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {budget.used.toLocaleString()} EST. tokens
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{statusLabel}</p>
        </TooltipContent>
      </Tooltip>
      <ContextBudgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        budget={budget}
        skills={skills}
        onSelectSkill={onSelectSkill}
        onViewDisabled={onViewDisabled}
        onViewUserInvocableOnly={onViewUserInvocableOnly}
      />
    </div>
  )
}

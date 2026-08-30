import { useMemo, useState } from 'react'
import { Blocks, ChevronRight, FolderGit2, Globe, List } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ContextBudgetDialog } from '@/components/ContextBudgetDialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { budgetStatus } from '@/lib/context-budget'
import { cn } from '@/lib/utils'
import { getFolderBasename, getPluginBareName, getProjectNameFromPath } from '@/lib/source-name'
import type { SourceFilter } from '@/lib/source-filter'
import type { AllowedPathRow, ContextBudget, SkillRow } from '../../../shared/ipc'

interface SidebarProps {
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  contextBudget: ContextBudget
  onSelectSkill: (id: number) => void
  skills?: SkillRow[]
  folders?: AllowedPathRow[]
}

interface ProjectSidebarItem {
  path: string
  name: string
  count: number
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
  folders = []
}: SidebarProps): React.JSX.Element {
  const [projectExpanded, setProjectExpanded] = useState(false)
  const [pluginExpanded, setPluginExpanded] = useState(false)

  const projects = useMemo<ProjectSidebarItem[]>(() => {
    const map = new Map<string, ProjectSidebarItem>()

    for (const folder of folders) {
      const norm = folder.path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
      map.set(norm, {
        path: folder.path,
        name: getFolderBasename(folder.path),
        count: 0
      })
    }

    for (const skill of skills) {
      if (skill.source_type !== 'project') continue
      const projectRoot = skill.project_root
      if (projectRoot) {
        const norm = projectRoot.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
        let item = map.get(norm)
        if (!item) {
          item = {
            path: projectRoot,
            name: getFolderBasename(projectRoot),
            count: 0
          }
          map.set(norm, item)
        }
        item.count++
      } else {
        const normPath = skill.source_path.replace(/\\/g, '/').toLowerCase()
        let matched = false
        for (const [normRoot, item] of map.entries()) {
          if (normPath.startsWith(normRoot)) {
            item.count++
            matched = true
            break
          }
        }
        if (!matched) {
          const name = getProjectNameFromPath(skill.source_path)
          const placeholderPath = skill.source_path
          const norm = placeholderPath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
          let item = map.get(norm)
          if (!item) {
            item = { path: placeholderPath, name, count: 0 }
            map.set(norm, item)
          }
          item.count++
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, skills])

  const plugins = useMemo<PluginSidebarItem[]>(() => {
    const map = new Map<string, PluginSidebarItem>()

    for (const skill of skills) {
      if (skill.source_type !== 'plugin') continue
      const rawName = skill.plugin_name || 'plugin'
      const bareName = getPluginBareName(rawName)
      const key = bareName.toLowerCase()
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

    return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [skills])

  function handleProjectClick(): void {
    onFilterChange({ kind: 'project' })
    setProjectExpanded((open) => !open)
  }

  function handlePluginClick(): void {
    onFilterChange({ kind: 'plugin' })
    setPluginExpanded((open) => !open)
  }

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
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
              filter.kind === 'all'
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <List className="size-4 shrink-0" />
            <span>All Skills</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'global' })}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
              filter.kind === 'global'
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Globe className="size-4 shrink-0" />
            <span>Global</span>
          </button>

          <div className="flex flex-col">
            <div
              className={cn(
                'flex h-8 items-center justify-between rounded-md px-2 text-sm transition-colors',
                filter.kind === 'project' && !filter.projectRoot
                  ? 'bg-accent-lime text-accent-lime-foreground'
                  : filter.kind === 'project'
                    ? 'text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <button
                type="button"
                onClick={handleProjectClick}
                className="flex h-full flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderGit2 className="size-4 shrink-0" />
                <span>Project</span>
              </button>
              <button
                type="button"
                onClick={() => setProjectExpanded((open) => !open)}
                aria-expanded={projectExpanded}
                aria-label={projectExpanded ? 'Collapse project list' : 'Expand project list'}
                className="-mr-1 shrink-0 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform duration-200',
                    projectExpanded && 'rotate-90'
                  )}
                />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {projectExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="my-0.5 ml-3 flex flex-col gap-0.5 border-l border-border/70 pl-2 py-0.5">
                    {projects.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground italic">
                        No project folders
                      </div>
                    ) : (
                      projects.map((project) => {
                        const isSelected =
                          filter.kind === 'project' && filter.projectRoot === project.path
                        return (
                          <button
                            key={project.path}
                            type="button"
                            title={project.path}
                            onClick={() =>
                              onFilterChange({ kind: 'project', projectRoot: project.path })
                            }
                            className={cn(
                              'flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
                              isSelected
                                ? 'bg-accent-lime font-medium text-accent-lime-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                          >
                            <span className="truncate">{project.name}</span>
                            <span
                              className={cn(
                                'ml-auto shrink-0 rounded px-1.5 py-0.2 font-mono text-[12px] tabular-nums',
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

          <div className="flex flex-col">
            <div
              className={cn(
                'flex h-8 items-center justify-between rounded-md px-2 text-sm transition-colors',
                filter.kind === 'plugin' && !filter.pluginName
                  ? 'bg-accent-lime text-accent-lime-foreground'
                  : filter.kind === 'plugin'
                    ? 'text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
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
                onClick={() => setPluginExpanded((open) => !open)}
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
                            className={cn(
                              'flex h-7 items-center justify-between gap-1.5 rounded-md px-2 text-left text-xs transition-colors',
                              isSelected
                                ? 'bg-accent-lime font-medium text-accent-lime-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
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
      />
    </div>
  )
}

function ContextBudgetReadout({
  budget,
  skills,
  onSelectSkill,
  onViewDisabled
}: {
  budget: ContextBudget
  skills: SkillRow[]
  onSelectSkill: (id: number) => void
  onViewDisabled: () => void
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
      />
    </div>
  )
}

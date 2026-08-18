import { useMemo, useState } from 'react'
import { Blocks, ChevronRight, FolderGit2, Globe, List, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { getFolderBasename, getPluginBareName, getProjectNameFromPath } from '@/lib/source-name'
import type { SourceFilter } from '@/lib/source-filter'
import type { AllowedPathRow, ContextBudget, SkillRow, Theme } from '../../../shared/ipc'

interface SidebarProps {
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  theme: Theme
  onToggleTheme: () => void
  contextBudget: ContextBudget
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
  theme,
  onToggleTheme,
  contextBudget,
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
            <button
              type="button"
              onClick={handleProjectClick}
              className={cn(
                'group flex h-8 items-center justify-between rounded-md px-2 text-left text-sm transition-colors',
                filter.kind === 'project' && !filter.projectRoot
                  ? 'bg-accent-lime text-accent-lime-foreground'
                  : filter.kind === 'project'
                    ? 'text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <span className="flex items-center gap-2">
                <FolderGit2 className="size-4 shrink-0" />
                <span>Project</span>
              </span>
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-200',
                  projectExpanded && 'rotate-90'
                )}
              />
            </button>

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
                                'ml-auto shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] tabular-nums',
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
            <button
              type="button"
              onClick={handlePluginClick}
              className={cn(
                'group flex h-8 items-center justify-between rounded-md px-2 text-left text-sm transition-colors',
                filter.kind === 'plugin' && !filter.pluginName
                  ? 'bg-accent-lime text-accent-lime-foreground'
                  : filter.kind === 'plugin'
                    ? 'text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <span className="flex items-center gap-2">
                <Blocks className="size-4 shrink-0" />
                <span>Plugin</span>
              </span>
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-200',
                  pluginExpanded && 'rotate-90'
                )}
              />
            </button>

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
                                'ml-auto shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] tabular-nums',
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

      <ContextBudgetReadout budget={contextBudget} />

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </div>
  )
}

function ContextBudgetReadout({ budget }: { budget: ContextBudget }): React.JSX.Element {
  const over = budget.limit > 0 && budget.used > budget.limit
  const percent = budget.limit > 0 ? Math.min(100, (budget.used / budget.limit) * 100) : 0

  return (
    <div className="border-t border-border px-3 py-2.5">
      <p
        className={cn(
          'font-mono text-[11px] tabular-nums',
          over ? 'text-warning' : 'text-muted-foreground'
        )}
      >
        {budget.used.toLocaleString()} / {budget.limit.toLocaleString()} est. tokens
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', over ? 'bg-warning' : 'bg-muted-foreground/50')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

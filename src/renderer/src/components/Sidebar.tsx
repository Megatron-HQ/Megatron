import { Blocks, FolderGit2, Globe, List, Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import { FILTER_LABEL, type SourceFilter } from '@/lib/source-filter'
import type { ContextBudget, Theme } from '../../../shared/ipc'

const NAV_ITEM_HEIGHT = 32
const NAV_ITEM_GAP = 2

const FILTERS: { value: SourceFilter; icon: typeof List }[] = [
  { value: 'all', icon: List },
  { value: 'global', icon: Globe },
  { value: 'project', icon: FolderGit2 },
  { value: 'plugin', icon: Blocks }
]

interface SidebarProps {
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  theme: Theme
  onToggleTheme: () => void
  contextBudget: ContextBudget
}

export function Sidebar({
  filter,
  onFilterChange,
  theme,
  onToggleTheme,
  contextBudget
}: SidebarProps): React.JSX.Element {
  const { hoveredId, setHoveredId, onMouseLeave, transition } = useGlideHighlight<SourceFilter>()
  const highlightIndex = FILTERS.findIndex(({ value }) => value === hoveredId)

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>

      <nav className="relative flex flex-col gap-0.5 px-2" onMouseLeave={onMouseLeave}>
        {highlightIndex >= 0 && (
          <motion.div
            className="pointer-events-none absolute inset-x-2 z-0 rounded-md bg-accent"
            initial={false}
            animate={{
              top: highlightIndex * (NAV_ITEM_HEIGHT + NAV_ITEM_GAP),
              height: NAV_ITEM_HEIGHT
            }}
            transition={transition}
          />
        )}
        {FILTERS.map(({ value, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilterChange(value)}
            onMouseEnter={() => setHoveredId(value)}
            className={cn(
              'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors',
              filter === value
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:text-accent-foreground'
            )}
          >
            <Icon className="size-4" />
            {FILTER_LABEL[value]}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

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

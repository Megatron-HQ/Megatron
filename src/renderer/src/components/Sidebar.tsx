import { Blocks, FolderGit2, Globe, List, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SourceType, Theme } from '../../../shared/ipc'

export type SourceFilter = 'all' | SourceType

const FILTERS: { value: SourceFilter; label: string; icon: typeof List }[] = [
  { value: 'all', label: 'All Skills', icon: List },
  { value: 'global', label: 'Global', icon: Globe },
  { value: 'project', label: 'Project', icon: FolderGit2 },
  { value: 'plugin', label: 'Plugin', icon: Blocks }
]

interface SidebarProps {
  filter: SourceFilter
  onFilterChange: (filter: SourceFilter) => void
  theme: Theme
  onToggleTheme: () => void
}

export function Sidebar({
  filter,
  onFilterChange,
  theme,
  onToggleTheme
}: SidebarProps): React.JSX.Element {
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border pt-7">
      <div className="px-4 pb-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
        {FILTERS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onFilterChange(value)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              filter === value
                ? 'bg-accent-lime text-accent-lime-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

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

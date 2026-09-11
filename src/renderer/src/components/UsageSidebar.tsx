import { Activity, BrainCircuit, CircleDollarSign, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'

export type UsagePanel = 'activity' | 'cost' | 'models' | 'skills'

const PANELS = [
  { key: 'activity', label: 'Activity', Icon: Activity },
  { key: 'cost', label: 'Cost', Icon: CircleDollarSign },
  { key: 'models', label: 'Models', Icon: Cpu },
  { key: 'skills', label: 'Skills', Icon: BrainCircuit }
] as const

const NAV_ROW = 'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors'
const NAV_SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const NAV_IDLE = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

export function UsageSidebar({
  panel,
  onPanelChange
}: {
  panel: UsagePanel
  onPanelChange: (panel: UsagePanel) => void
}): React.JSX.Element {
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <nav className="flex flex-col gap-0.5" aria-label="Usage panels">
          {PANELS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onPanelChange(key)}
              className={cn(NAV_ROW, panel === key ? NAV_SELECTED : NAV_IDLE)}
              aria-current={panel === key ? 'page' : undefined}
            >
              <Icon className="size-4 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

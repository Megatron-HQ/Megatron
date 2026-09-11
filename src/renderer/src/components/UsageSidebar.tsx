import { Activity, BrainCircuit, CircleDollarSign, Cpu } from 'lucide-react'
import { motion } from 'motion/react'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'

export type UsagePanel = 'activity' | 'cost' | 'models' | 'skills'

const PANELS = [
  { key: 'activity', label: 'Activity', Icon: Activity },
  { key: 'cost', label: 'Cost', Icon: CircleDollarSign },
  { key: 'models', label: 'Models', Icon: Cpu },
  { key: 'skills', label: 'Skills', Icon: BrainCircuit }
] as const

const NAV_ROW =
  'relative z-10 flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors'
const NAV_SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const NAV_IDLE = 'text-muted-foreground hover:text-accent-foreground'

export function UsageSidebar({
  panel,
  onPanelChange
}: {
  panel: UsagePanel
  onPanelChange: (panel: UsagePanel) => void
}): React.JSX.Element {
  const { hoveredId, setHoveredId, onMouseLeave, transition } = useGlideHighlight<UsagePanel>()
  const highlightIndex = hoveredId !== null ? PANELS.findIndex((p) => p.key === hoveredId) : -1

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center px-4">
        <span className="text-sm font-semibold">Megatron</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <nav
          className="relative flex flex-col gap-0.5"
          aria-label="Usage panels"
          onMouseLeave={onMouseLeave}
        >
          {highlightIndex >= 0 && (
            <motion.div
              className="pointer-events-none absolute inset-x-0 z-0 rounded-md bg-accent"
              initial={false}
              animate={{ top: highlightIndex * 34, height: 32 }}
              transition={transition}
            />
          )}
          {PANELS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onPanelChange(key)}
              onMouseEnter={() => setHoveredId(key)}
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

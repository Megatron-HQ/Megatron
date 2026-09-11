import { BarChart3, Blocks, BrainCircuit, Settings } from 'lucide-react'
import { motion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { AppSection } from '../../../shared/ipc'

// Blocks is the app-wide plugin mark — the source badge (SourceBadge.tsx) and the Skills
// sidebar's plugin filter already use it, so the Plugins section carries the same icon.
// Skills takes BrainCircuit: Blocks on a non-plugin section would collide with that meaning.
// Usage takes BarChart3 — a retrospective over the user's own activity, not an inventory.
const SECTIONS: { section: AppSection; label: string; Icon: typeof Blocks }[] = [
  { section: 'skills', label: 'Skills', Icon: BrainCircuit },
  { section: 'plugins', label: 'Plugins', Icon: Blocks },
  { section: 'usage', label: 'Usage', Icon: BarChart3 }
]

interface AppRailProps {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  onOpenSettings: () => void
}

// Ink-fill active state, deliberately never the lime accent — lime stays reserved for each
// section's own interior nav (Sidebar's filter list), per the One Stamp Rule.
export function AppRail({
  section,
  onSectionChange,
  onOpenSettings
}: AppRailProps): React.JSX.Element {
  const { hoveredId, setHoveredId, onMouseLeave, transition } = useGlideHighlight<AppSection>()
  const highlightIndex =
    hoveredId !== null ? SECTIONS.findIndex((s) => s.section === hoveredId) : -1

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      <div className="relative flex flex-col items-center gap-1" onMouseLeave={onMouseLeave}>
        {highlightIndex >= 0 && (
          <motion.div
            className="pointer-events-none absolute left-0 z-0 size-8 rounded-md bg-accent"
            initial={false}
            animate={{ top: highlightIndex * 36, height: 32 }}
            transition={transition}
          />
        )}
        {SECTIONS.map(({ section: itemSection, label, Icon }) => (
          <Tooltip key={itemSection}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-current={section === itemSection ? 'page' : undefined}
                onClick={() => onSectionChange(itemSection)}
                onMouseEnter={() => setHoveredId(itemSection)}
                className={cn(
                  'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
                  section === itemSection
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-accent-foreground'
                )}
              >
                <Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Settings"
              onClick={onOpenSettings}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Settings className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

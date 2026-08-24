import { Puzzle, Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppSection } from '../../../shared/ipc'

// Sparkles (not Blocks) for Skills — Blocks already means "plugin source" at the skill-filter
// level inside the Skills sidebar (SourceBadge.tsx), so reusing it here for the section itself
// would collide with that meaning.
const SECTIONS: { section: AppSection; label: string; Icon: typeof Puzzle }[] = [
  { section: 'skills', label: 'Skills', Icon: Sparkles },
  { section: 'plugins', label: 'Plugins', Icon: Puzzle }
]

interface AppRailProps {
  section: AppSection
  onSectionChange: (section: AppSection) => void
}

// Ink-fill active state, deliberately never the lime accent — lime stays reserved for each
// section's own interior nav (Sidebar's filter list), per the One Stamp Rule.
export function AppRail({ section, onSectionChange }: AppRailProps): React.JSX.Element {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      {SECTIONS.map(({ section: itemSection, label, Icon }) => (
        <Tooltip key={itemSection}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-current={section === itemSection ? 'page' : undefined}
              onClick={() => onSectionChange(itemSection)}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors',
                section === itemSection
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

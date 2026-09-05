import { Blocks, BrainCircuit, Settings } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppSection } from '../../../shared/ipc'

// Blocks is the app-wide plugin mark — the source badge (SourceBadge.tsx) and the Skills
// sidebar's plugin filter already use it, so the Plugins section carries the same icon.
// Skills takes BrainCircuit: Blocks on a non-plugin section would collide with that meaning.
const SECTIONS: { section: AppSection; label: string; Icon: typeof Blocks }[] = [
  { section: 'skills', label: 'Skills', Icon: BrainCircuit },
  { section: 'plugins', label: 'Plugins', Icon: Blocks }
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
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      <div className="flex flex-col items-center gap-1">
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

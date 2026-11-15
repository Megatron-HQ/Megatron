import { BarChart3, Blocks, BrainCircuit, Settings } from 'lucide-react'
import { motion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { AppSection } from '../../../shared/ipc'

// Keep the section marks consistent with source badges and the Usage panel list.
const SECTIONS: { section: AppSection; label: string; Icon: typeof Blocks }[] = [
  { section: 'skills', label: 'Skills', Icon: BrainCircuit },
  { section: 'plugins', label: 'Plugins', Icon: Blocks },
  { section: 'usage', label: 'Usage', Icon: BarChart3 }
]

interface AppRailProps {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  onOpenSettings: () => void
  updateNotice?: string | null
}

export function AppRail({
  section,
  onSectionChange,
  onOpenSettings,
  updateNotice = null
}: AppRailProps): React.JSX.Element {
  const settingsLabel = updateNotice ? `Settings · ${updateNotice}` : 'Settings'
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLElement>()

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
      <nav
        ref={containerRef}
        aria-label="Main navigation"
        className="relative flex flex-col items-center gap-1"
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
        {SECTIONS.map(({ section: itemSection, label, Icon }) => (
          <Tooltip key={itemSection}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                aria-current={section === itemSection ? 'page' : undefined}
                onClick={() => onSectionChange(itemSection)}
                onMouseEnter={(event) => onItemHover(event.currentTarget)}
                className={cn(
                  'relative z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  section === itemSection
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-accent-foreground'
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={settingsLabel}
              onClick={onOpenSettings}
              className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Settings aria-hidden="true" className="size-4" />
              {updateNotice && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-info"
                />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{settingsLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

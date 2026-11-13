import { BarChart3, Blocks, BrainCircuit, Settings } from 'lucide-react'
import { motion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useElementGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import appLogo from '../../../../build/icon-source/icon.svg'
import type { AppSection } from '../../../shared/ipc'

// Keep the section marks consistent with source badges and the Usage panel list.
const SECTIONS: { section: AppSection; label: string; Icon: typeof Blocks }[] = [
  { section: 'skills', label: 'Skills', Icon: BrainCircuit },
  { section: 'plugins', label: 'Plugins', Icon: Blocks },
  { section: 'usage', label: 'Usage', Icon: BarChart3 }
]

interface AppHeaderProps {
  section: AppSection
  onSectionChange: (section: AppSection) => void
  onOpenSettings: () => void
  updateNotice?: string | null
}

export function AppHeader({
  section,
  onSectionChange,
  onOpenSettings,
  updateNotice = null
}: AppHeaderProps): React.JSX.Element {
  const settingsLabel = updateNotice ? `Settings · ${updateNotice}` : 'Settings'
  const { containerRef, highlightRect, onItemHover, onMouseLeave, transition } =
    useElementGlideHighlight<HTMLElement>()

  return (
    <header className="frame-surface drag-region grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4">
      {/* Equal outer columns center navigation on the window, independently of the sidebar.
          hiddenInset's traffic lights occupy the leading edge on macOS. */}
      <span
        className={cn(
          'flex items-center gap-2 text-sm font-semibold',
          window.api?.platform === 'darwin' && 'pl-20'
        )}
      >
        <img
          src={appLogo}
          alt=""
          width={32}
          height={32}
          draggable={false}
          className="size-8 shrink-0"
        />
        Megatron
      </span>

      <nav
        ref={containerRef}
        aria-label="Main navigation"
        className="no-drag-region relative flex items-center gap-1"
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
          <button
            key={itemSection}
            type="button"
            aria-current={section === itemSection ? 'page' : undefined}
            onClick={() => onSectionChange(itemSection)}
            onMouseEnter={(event) => onItemHover(event.currentTarget)}
            className={cn(
              'relative z-10 inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              section === itemSection
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-accent-foreground'
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="no-drag-region justify-self-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={settingsLabel}
              onClick={onOpenSettings}
              className="relative flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          <TooltipContent side="bottom">{settingsLabel}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

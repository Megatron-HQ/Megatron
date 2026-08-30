import { Blocks, BrainCircuit, Check, Monitor, Moon, Sun } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AppSection, ThemePreference } from '../../../shared/ipc'

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
  themePreference: ThemePreference
  onThemeChange: (preference: ThemePreference) => void
}

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
] as const

// Ink-fill active state, deliberately never the lime accent — lime stays reserved for each
// section's own interior nav (Sidebar's filter list), per the One Stamp Rule.
export function AppRail({
  section,
  onSectionChange,
  themePreference,
  onThemeChange
}: AppRailProps): React.JSX.Element {
  const AppearanceIcon =
    APPEARANCE_OPTIONS.find((option) => option.value === themePreference)?.Icon ?? Monitor

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

      <DropdownMenu.Root>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Appearance"
                className="mt-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <AppearanceIcon className="size-4" />
              </button>
            </DropdownMenu.Trigger>
          </TooltipTrigger>
          <TooltipContent side="right">Appearance</TooltipContent>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="right"
            align="end"
            sideOffset={8}
            className="z-50 min-w-32 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <DropdownMenu.RadioGroup
              value={themePreference}
              onValueChange={(value) => onThemeChange(value as ThemePreference)}
            >
              {APPEARANCE_OPTIONS.map(({ value, label, Icon }) => (
                <DropdownMenu.RadioItem
                  key={value}
                  value={value}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm outline-none hover:bg-accent focus:bg-accent"
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

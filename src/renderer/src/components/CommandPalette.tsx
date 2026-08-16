import { SOURCE_ICON } from '@/lib/source-icon'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import type { SkillRow } from '../../../shared/ipc'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: SkillRow[]
  onSelect: (id: number) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  skills,
  onSelect
}: CommandPaletteProps): React.JSX.Element {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to skill"
      description="Search skills by name or description"
    >
      <CommandInput placeholder="Search skills by name or description..." />
      <CommandList>
        <CommandEmpty>No skills found.</CommandEmpty>
        <CommandGroup>
          {skills.map((skill) => {
            const Icon = SOURCE_ICON[skill.source_type]
            return (
              <CommandItem
                key={skill.id}
                value={`${skill.name} ${skill.description ?? ''}`}
                onSelect={() => {
                  onSelect(skill.id)
                  onOpenChange(false)
                }}
              >
                <Icon className="size-4" />
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate">{skill.name}</span>
                  {skill.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {skill.description}
                    </span>
                  )}
                </div>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

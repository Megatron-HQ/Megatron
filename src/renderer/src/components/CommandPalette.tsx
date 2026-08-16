import { SOURCE_ICON } from '@/lib/source-icon'
import { getSourceDisplayName } from '@/lib/source-name'
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
      <CommandInput placeholder="Search skills by name, description, project, or plugin..." />
      <CommandList>
        <CommandEmpty>No skills found.</CommandEmpty>
        <CommandGroup>
          {skills.map((skill) => {
            const Icon = SOURCE_ICON[skill.source_type]
            const sourceName = getSourceDisplayName(
              skill.source_type,
              skill.source_path,
              skill.plugin_name
            )
            return (
              <CommandItem
                key={skill.id}
                value={`${skill.name} ${skill.description ?? ''} ${sourceName} ${skill.plugin_name ?? ''}`}
                onSelect={() => {
                  onSelect(skill.id)
                  onOpenChange(false)
                }}
              >
                <Icon className="size-4" />
                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{skill.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      · {sourceName}
                    </span>
                  </div>
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

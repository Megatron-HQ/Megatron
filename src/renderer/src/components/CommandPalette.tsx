import { Blocks } from 'lucide-react'
import { SOURCE_ICON, SYNCED_ICON } from '@/lib/source-icon'
import { getSourceDisplayName } from '@/lib/source-name'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import type { PluginRow, SkillRow } from '../../../shared/ipc'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: SkillRow[]
  onSelect: (id: number) => void
  plugins: PluginRow[]
  onSelectPlugin: (name: string, marketplace: string) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  skills,
  onSelect,
  plugins,
  onSelectPlugin
}: CommandPaletteProps): React.JSX.Element {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to skill or plugin"
      description="Search skills and plugins by name or description"
    >
      <CommandInput placeholder="Search skills, plugins, projects..." />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Plugins">
          {plugins.map((plugin) => (
            <CommandItem
              key={`${plugin.name}@${plugin.marketplace}`}
              value={`${plugin.name} ${plugin.marketplace}`}
              onSelect={() => {
                onSelectPlugin(plugin.name, plugin.marketplace)
                onOpenChange(false)
              }}
            >
              <Blocks className="size-4" />
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate">{plugin.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    · {plugin.marketplace}
                  </span>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Skills">
          {skills.map((skill) => {
            const isSynced = skill.is_synced === 1
            const Icon = isSynced ? SYNCED_ICON : SOURCE_ICON[skill.source_type]
            const sourceName = getSourceDisplayName(
              skill.source_type,
              skill.source_path,
              skill.plugin_name,
              isSynced
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

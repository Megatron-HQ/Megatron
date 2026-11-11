import { Blocks, Power } from 'lucide-react'
import { EntityGlyph } from '@/components/EntityGlyph'
import { SOURCE_ICON, SYNCED_ICON } from '@/lib/source-icon'
import { getSkillDisplayName, getSourceDisplayName } from '@/lib/source-name'
import { projectRootForSkill } from '@/lib/source-filter'
import { useProjectLabel } from '@/lib/use-project-label'
import { ProjectName } from '@/components/ProjectName'
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
  const resolveProjectLabel = useProjectLabel()
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
              {/* Same width as the skill rows' entity tile so both groups' text lines up;
                  plugins aren't an entity, so no tile. */}
              <span className="flex w-7 shrink-0 justify-center">
                <Blocks className="size-4!" />
              </span>
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
            const isDisabled = skill.disabled_reason !== null
            const Icon = isSynced ? SYNCED_ICON : SOURCE_ICON[skill.source_type]
            const sourceName =
              skill.source_type === 'project'
                ? resolveProjectLabel(projectRootForSkill(skill))
                : getSourceDisplayName(
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
                <EntityGlyph entity="skills" disabled={isDisabled} />
                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="truncate">
                      {getSkillDisplayName(skill.name, skill.source_type, skill.plugin_name)}
                    </span>
                    <span className="flex min-w-0 items-center text-[11px] text-muted-foreground">
                      ·&nbsp;
                      <Icon className="mr-1 size-3!" />
                      {skill.source_type === 'project' ? (
                        <ProjectName label={sourceName} />
                      ) : (
                        <span className="truncate">{sourceName}</span>
                      )}
                    </span>
                    {/* Labels the neutral tile, so "disabled" is never carried by color alone. */}
                    {isDisabled && (
                      <span className="flex shrink-0 items-center text-[11px] text-muted-foreground">
                        ·&nbsp;
                        <Power className="mr-1 size-3! text-dormant" />
                        Disabled
                      </span>
                    )}
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

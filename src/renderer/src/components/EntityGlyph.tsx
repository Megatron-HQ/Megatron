import { BrainCircuit, NotebookText, Plug, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Entity = 'skills' | 'mcp' | 'memory' | 'agents'

// DESIGN.md → Entity glyph. Agents isn't `Bot`: Bot/BotOff already mean "Claude invokes it on its
// own" (the Auto trigger and the user-invocable-only chip). Memory isn't `FileText` (SKILL.md).
// MCP's and Agents' light steps fall under 3:1 on this tile (DESIGN.md → Validation), so each
// needs a darker glyph step, validated there, before it first renders.
const ENTITY = {
  skills: { Icon: BrainCircuit, tile: 'bg-entity-skills/10', glyph: 'text-entity-skills' },
  mcp: { Icon: Plug, tile: 'bg-entity-mcp/10', glyph: 'text-entity-mcp' },
  memory: { Icon: NotebookText, tile: 'bg-entity-memory/10', glyph: 'text-entity-memory' },
  agents: { Icon: Workflow, tile: 'bg-entity-agents/10', glyph: 'text-entity-agents' }
} as const

// Decorative: every placement names the entity in text, so the hue never carries identity alone.
export function EntityGlyph({
  entity,
  disabled = false
}: {
  entity: Entity
  disabled?: boolean
}): React.JSX.Element {
  const { Icon, tile, glyph } = ENTITY[entity]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
        disabled ? 'bg-muted' : tile
      )}
    >
      {/* Color and size sit on the svg, important-sized: CommandItem recolors any item svg
          without a text- class, and CommandDialog forces item svgs to 20px. */}
      <Icon className={cn('size-4!', disabled ? 'text-muted-foreground' : glyph)} />
    </span>
  )
}

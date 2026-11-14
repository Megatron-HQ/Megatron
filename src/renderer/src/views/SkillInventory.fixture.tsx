import { baseSkills } from '@/fixtures/data'
import { fixture, sheet, type Fixture, type Target } from '@/fixtures/define'
import { matchesFilter, type SourceFilter } from '@/lib/source-filter'
import { SkillInventory } from './SkillInventory'

const ignore = (): void => {}

function inventory(
  hover: Target,
  shows: Target,
  message: string,
  filter: SourceFilter = { kind: 'all' }
): Fixture {
  return fixture({
    frame: sheet('skills'),
    render: () => (
      <SkillInventory
        skills={baseSkills.filter((skill) => matchesFilter(skill, filter))}
        loading={false}
        filter={filter}
        onSelect={ignore}
        onOpenSearch={ignore}
      />
    ),
    interact: async (user) => {
      await user.hover(hover)
      await user.until(shows, message)
    }
  })
}

// The hover highlight that glides between rows.
export const RowHover = inventory(
  { selector: 'tbody tr:nth-child(2)' },
  { selector: 'tbody tr:nth-child(2):hover' },
  'The second row was not hovered.'
)

export const SourceBadgeTooltip = inventory(
  { selector: 'tbody tr:first-child [data-variant="outline"]' },
  { text: 'Global skill' },
  'The source badge showed no tooltip.'
)

// Filtered to the plugin so the hook-driven row is on screen at every size.
export const HookIconTooltip = inventory(
  { selector: 'tbody svg.lucide-webhook' },
  { text: /Also runs via hooks: SessionStart, PreToolUse/ },
  'The hook icon showed no tooltip.',
  { kind: 'plugin', pluginName: 'ops-kit@fixture-market' }
)

export const DisabledIconTooltip = inventory(
  { selector: 'tbody svg.lucide-power' },
  { text: /not loaded into context/ },
  'The disabled icon showed no tooltip.'
)

export const StaleTooltip = inventory(
  { selector: 'tbody svg.lucide-clock' },
  { text: 'Not run in the last 30 days of recorded sessions.' },
  'The stale icon showed no tooltip.'
)

export const UserInvocableOnlyTooltip = inventory(
  { selector: 'tbody svg.lucide-bot-off' },
  { text: /User-invocable only/ },
  'The user-invocable-only icon showed no tooltip.'
)

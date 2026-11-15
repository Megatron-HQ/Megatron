// Synthetic catalog and usage data for the What's new fixtures; never read from the bundled catalog,
// so a fixture's state doesn't change when a real release entry is written.
import type { SkillCostAttributionRow, UsageOverview } from '../../../../shared/ipc'
import type { WhatsNewRelease } from '../../../../shared/whats-new'
import { usageOverview } from '@/fixtures/usage-data'

export const COST_RELEASE: WhatsNewRelease = {
  version: '1.0.0',
  title: 'Megatron 1.0',
  highlights: [
    {
      title: 'See what each skill costs',
      body: 'Usage › Skills now splits your estimated spend across the skills that drove it.',
      preview: 'usage-skill-cost',
      action: { kind: 'section', section: 'usage', anchor: 'usage-skill-cost' }
    },
    {
      title: 'Search everything',
      body: 'Press ⌘K to jump to any skill or plugin by name.',
      action: { kind: 'palette' }
    }
  ]
}

export const EARLIER_RELEASE: WhatsNewRelease = {
  version: '0.9.0',
  title: 'Megatron 0.9',
  highlights: [
    {
      title: 'Choose which folders Megatron reads',
      body: 'Settings › Folders lists every grant, and you can narrow or revoke any of them.',
      action: { kind: 'settings' }
    }
  ]
}

export const TEXT_ONLY_RELEASE: WhatsNewRelease = {
  version: '1.0.0',
  title: 'Megatron 1.0',
  highlights: [
    {
      title: 'Faster launch',
      body: 'The first scan now finishes before the window is fully drawn on most machines.'
    }
  ]
}

function attributionRow(
  skillName: string,
  share: number,
  estimatedCostCents: number
): SkillCostAttributionRow {
  return {
    skillName,
    skillId: null,
    sourceType: 'global',
    trackedSessionCount: 4,
    estimatedCostCents,
    share,
    resolution: 'installed'
  }
}

// The user's own spend, as the live preview should show it in place of the sample.
export function overviewWithSkillCost(): UsageOverview {
  const overview = usageOverview()
  const rows = [
    attributionRow('grill-me', 0.5, 2210),
    attributionRow('humanizer', 0.3, 1326),
    attributionRow('dataviz', 0.2, 884)
  ]
  overview.skills.last30d.attribution = {
    ...overview.skills.last30d.attribution,
    totalEstimatedCostCents: 4420,
    trackedSessionCount: 12,
    rows
  }
  return overview
}

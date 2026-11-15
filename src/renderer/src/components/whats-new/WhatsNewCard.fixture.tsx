import type { Api } from '../../../../shared/api'
import type { WhatsNewAction, WhatsNewRelease } from '../../../../shared/whats-new'
import { fixture, type Fixture } from '@/fixtures/define'
import { usageOverview } from '@/fixtures/usage-data'
import { WhatsNewCard } from './WhatsNewCard'
import {
  COST_RELEASE,
  EARLIER_RELEASE,
  TEXT_ONLY_RELEASE,
  overviewWithSkillCost
} from './whats-new-fixture-data'

const ignore = (): void => {}

function card(
  releases: WhatsNewRelease[],
  api: Partial<Api>,
  interact?: Fixture['interact'],
  handlers: { onShowMe?: (action: WhatsNewAction) => void; onDismiss?: () => void } = {}
): Fixture {
  return fixture({
    frame: 'window',
    api,
    render: () => (
      <WhatsNewCard
        releases={releases}
        onShowMe={handlers.onShowMe ?? ignore}
        onDismiss={handlers.onDismiss ?? ignore}
      />
    ),
    interact
  })
}

const CARD = { role: 'region', name: "What's new in Megatron" }

export const TextOnly = card([TEXT_ONLY_RELEASE], {}, (user) =>
  user.until({ text: 'Faster launch' }, 'The card did not show its only highlight.')
)

// The user has no attributed cost yet, so the live preview falls back to labelled sample data.
export const PreviewSample = card(
  [COST_RELEASE],
  { getUsageOverview: async () => usageOverview() },
  async (user) => {
    await user.until(CARD, 'The card never appeared.')
    await user.until(
      { text: 'Sample', exact: true },
      'The empty-data preview was not labelled Sample.'
    )
  }
)

export const PreviewOwnData = card(
  [COST_RELEASE],
  { getUsageOverview: async () => overviewWithSkillCost() },
  async (user) => {
    await user.until({ text: 'grill-me' }, "The preview did not show the user's own top skill.")
    await user.until(
      () => !document.body.textContent?.includes('Sample'),
      'The preview labelled real data as Sample.'
    )
  }
)

export const PreviewLoading = card(
  [COST_RELEASE],
  { getUsageOverview: () => new Promise(() => {}) },
  (user) =>
    user.until(
      { selector: '[data-testid="whats-new-preview-loading"]' },
      'The preview showed no placeholder while its data loaded.'
    )
)

let dismissals = 0
let lastAction: WhatsNewAction | null = null

// Steps across two releases newest first, then Got it dismisses exactly once.
export const StepsAcrossReleases = card(
  [COST_RELEASE, EARLIER_RELEASE],
  { getUsageOverview: async () => overviewWithSkillCost() },
  async (user) => {
    await user.until({ text: 'New in v1.0.0' }, 'The newest release did not come first.')
    await user.click({ role: 'button', name: 'Next', exact: true })
    await user.until({ text: 'Search everything' }, 'Next did not advance to the second highlight.')
    await user.click({ role: 'button', name: 'Highlight 3 of 3' })
    await user.until(
      { text: 'New in v0.9.0' },
      "A step dot did not jump to the older release's highlight."
    )
    await user.click({ role: 'button', name: 'Show me' })
    await user.until(
      () => lastAction?.kind === 'settings',
      "Show me did not pass the highlight's own action."
    )
    await user.click({ role: 'button', name: 'Got it', exact: true })
    await user.until(() => dismissals === 1, 'Got it did not dismiss the card exactly once.')
  },
  {
    onShowMe: (action) => {
      lastAction = action
    },
    onDismiss: () => {
      dismissals += 1
    }
  }
)

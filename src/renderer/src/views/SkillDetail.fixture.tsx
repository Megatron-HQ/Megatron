import type { Api } from '../../../shared/api'
import { baseSkills, skillHistory, skillMeta } from '@/fixtures/data'
import { fixture, sheet, type Fixture, type FixtureUser } from '@/fixtures/define'
import { SkillDetail } from './SkillDetail'

const ignore = (): void => {}

const CODE_REVIEW = 1
const LEGACY_LINT = 3
const SCRATCHPAD = 4
const DEPLOY_CHECK = 7
const COMMIT_HELPER = 13
const DESIGN_REVIEW = 14

function detail(id: number, interact?: Fixture['interact'], api: Partial<Api> = {}): Fixture {
  return fixture({
    frame: sheet('skills'),
    api: {
      openSkillMeta: async (skillId) => skillMeta(skillId),
      openSkillHistory: async (skillId, offset) => skillHistory(skillId, offset),
      ...api
    },
    render: () => (
      <SkillDetail
        skillId={id}
        summary={baseSkills.find((skill) => skill.id === id)}
        onBack={ignore}
        onViewFiles={ignore}
        onNavigate={ignore}
      />
    ),
    interact
  })
}

const loaded = (user: FixtureUser): Promise<void> =>
  user.until({ text: 'Description', exact: true }, 'The skill never loaded.')

function dialogShows(selector: string): boolean {
  return document.querySelector(`[role="dialog"] ${selector}`) !== null
}

async function viewAll(user: FixtureUser): Promise<void> {
  await user.click({ role: 'button', name: 'View all 211' })
  await user.until({ role: 'dialog' }, 'View all opened no activity dialog.')
}

export const Open = detail(CODE_REVIEW, loaded)

export const LoadError = detail(
  CODE_REVIEW,
  (user) => user.until({ text: 'Could not load this skill.' }, 'The load error never showed.'),
  {
    openSkillMeta: async () => {
      throw new Error('Fixture: the skill is unavailable')
    }
  }
)

// The underline that sweeps in under a text link on hover.
export const TextLinkHover = detail(CODE_REVIEW, async (user) => {
  await user.hover({ role: 'button', name: 'View SKILL.md' })
  await user.until(
    () =>
      [...document.querySelectorAll('button:hover')].some(
        (button) => button.textContent === 'View SKILL.md'
      ),
    'The View SKILL.md link was not hovered.'
  )
})

// A clean skill starts with its checks folded.
export const LintPanelExpanded = detail(CODE_REVIEW, async (user) => {
  await user.click({ role: 'button', name: /Lint Status:/ })
  await user.until({ text: 'Click to collapse' }, 'The lint panel did not open.')
})

// The trigger bar, the per-project bars and the recent five. Both themes come from the runner.
export const UsageHistory = detail(COMMIT_HELPER, (user) =>
  user.until({ text: 'Recent activity', exact: true }, 'The usage section never showed.')
)

export const RecentActivityExpanded = detail(COMMIT_HELPER, async (user) => {
  await user.click({ selector: 'button:has(time)' })
  await user.until(
    { selector: 'button:has(time)[aria-expanded="true"]' },
    'The recent activity row did not expand.'
  )
})

// A bar segment opens the full log filtered to its trigger type.
export const UsageBarFilteredActivity = detail(COMMIT_HELPER, async (user) => {
  await user.click({ role: 'button', name: /Auto invocations$/ })
  await user.until(
    () =>
      document.querySelector('[role="dialog"] [role="radio"][aria-checked="true"]')?.textContent ===
        'Auto' && dialogShows('button:has(time)'),
    'The Auto segment did not open the log filtered to Auto.'
  )
})

// Consecutive screenshots collapse into one summary row.
export const ActivityDialogGrouped = detail(COMMIT_HELPER, async (user) => {
  await viewAll(user)
  await user.until(
    { role: 'button', name: /4 screenshots ·/ },
    'The screenshot sweep was not grouped.'
  )
})

export const ActivityDialogGroupExpanded = detail(COMMIT_HELPER, async (user) => {
  await viewAll(user)
  await user.click({ role: 'button', name: /4 screenshots ·/ })
  await user.until(
    () => dialogShows('button[aria-expanded="true"]'),
    'The screenshot group did not expand.'
  )
})

export const ActivityFirstPage = detail(COMMIT_HELPER, async (user) => {
  await viewAll(user)
  await user.until({ text: '200 invocations' }, 'The first page did not load.')
  // Hovering scrolls the button into view, where the screenshot shows it.
  await user.hover({ role: 'button', name: 'Load more activity' })
})

export const ActivityNextPage = detail(COMMIT_HELPER, async (user) => {
  await viewAll(user)
  await user.click({ role: 'button', name: 'Load more activity' })
  await user.until({ text: '211 invocations' }, 'Load more did not add the next page.')
  await user.hover({ role: 'heading', name: /Activity/ })
})

export const ActivityLoadError = detail(
  COMMIT_HELPER,
  async (user) => {
    await viewAll(user)
    await user.until(
      { text: 'Could not load activity. Close and reopen this dialog to retry.' },
      'The activity load error never showed.'
    )
  },
  {
    openSkillHistory: async () => {
      throw new Error('Fixture: the history is unavailable')
    }
  }
)

export const ActivityLoading = detail(
  COMMIT_HELPER,
  async (user) => {
    await viewAll(user)
    await user.until({ selector: '[role="dialog"] [role="status"]' }, 'No loading state showed.')
  },
  { openSkillHistory: () => new Promise(() => {}) }
)

// A metadata block and extra frontmatter fields, listed under Details, and a Modified date.
export const WithMetadata = detail(DESIGN_REVIEW, async (user) => {
  await user.until({ text: 'design-systems' }, 'The metadata never showed.')
  // Hovering scrolls the Details rows into view, where the screenshot shows them.
  await user.hover({ text: 'design-systems' })
})

// A plugin skill has neither metadata nor a modified date, so both are left out.
export const WithoutMetadata = detail(DEPLOY_CHECK, loaded)

export const UserInvocableOnly = detail(SCRATCHPAD, (user) =>
  user.until(
    { text: 'User-invocable only · via SKILL.md frontmatter' },
    'The invocation detail never showed.'
  )
)

export const Disabled = detail(LEGACY_LINT, loaded)

// Whole-app fixtures: states that only exist once App wires the sidebar, the scan banner and the
// inventory together, and behaviours that cross screens.
import type { Api } from '../../shared/api'
import type { ScanActivity, ScanSummary, UpdateState } from '../../shared/ipc'
import App from './App'
import {
  daysAgo,
  projectTree,
  skillMeta,
  skillsResult,
  type ProjectTreeMode
} from './fixtures/data'
import { fixture, type Fixture, type FixtureUser } from './fixtures/define'
import { emit } from './fixtures/fake-api'
import { historyApi } from './fixtures/usage-data'
import { COST_RELEASE, overviewWithSkillCost } from './components/whats-new/whats-new-fixture-data'

function app(api: Partial<Api>, interact?: Fixture['interact']): Fixture {
  return fixture({ frame: 'window', api, render: () => <App />, interact })
}

function tree(mode: ProjectTreeMode): Partial<Api> {
  const data = projectTree(mode)
  return {
    listAllowedPaths: async () => data.folders,
    listProjects: async () => data.projects,
    listSkills: async () => data.skills
  }
}

const PARENT_SIX = { role: 'button', name: /^Megatron HQ\s*6$/ }
const CHILD_THREE = { role: 'button', name: /^Megatron\s*3$/ }

function scanning(activity: Partial<ScanActivity>, summary?: Partial<ScanSummary>): Partial<Api> {
  return {
    listSkills: async () =>
      skillsResult(undefined, {
        scanSummary: { outcome: 'complete', completedAt: daysAgo(0), sources: [], ...summary },
        scanActivity: {
          id: 9001,
          startedAt: Date.now() - 60_000,
          isStartup: true,
          revealMs: 500,
          ...activity
        }
      })
  }
}

const UPDATING_BANNER = { text: /Refreshing Claude Code data|Scanning Claude Code data/ }

function statusShows(text: RegExp): boolean {
  return [...document.querySelectorAll('[role="status"]')].some((element) =>
    text.test(element.textContent ?? '')
  )
}

// The inventory as the app opens on it. Both themes come from the runner.
export const Inventory = app({}, (user) =>
  user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
)

// Windows keeps its native title bar, so the strip above the sheet is a thin separator.
export const InventoryWindows: Fixture = { ...Inventory, platform: 'win32' }

async function railLayout(user: FixtureUser): Promise<void> {
  await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
  await user.until(() => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]')
    const buttons = [...(nav?.querySelectorAll('button') ?? [])]
    const rail = nav?.parentElement?.getBoundingClientRect()
    const settings = document
      .querySelector('button[aria-label="Settings"]')
      ?.getBoundingClientRect()
    const expectedTop = window.api.platform === 'darwin' ? 32 : 6
    return (
      rail?.width === 48 &&
      rail.left === 0 &&
      rail.top === expectedTop &&
      buttons.length === 3 &&
      buttons.every((button, index) => {
        const rect = button.getBoundingClientRect()
        return (
          rect.left < rail.right &&
          (index === 0 || rect.top > buttons[index - 1].getBoundingClientRect().bottom)
        )
      }) &&
      settings !== undefined &&
      settings.bottom === rail.bottom - 8
    )
  }, 'The rail lost its vertical layout, titlebar clearance, or bottom Settings gear.')
}

export const MacRailLayout = { ...app({}, railLayout), platform: 'darwin' as const }
export const WindowsRailLayout = { ...app({}, railLayout), platform: 'win32' as const }

export const PluginsRail = app({ getInitialSection: () => 'plugins' }, (user) =>
  user.until({ text: 'No plugins installed' }, 'The saved Plugins section did not open.')
)

export const UsageRail = app({ ...historyApi(), getInitialSection: () => 'usage' }, (user) =>
  user.until({ role: 'navigation', name: 'Usage panels' }, 'The saved Usage section did not open.')
)

export const RailKeyboardNavigation = app(historyApi(), async (user) => {
  await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
  // The inventory focuses its first row on arrival; start keyboard navigation from the rail.
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Skills"]' })
  await user.press('Tab')
  await user.press('Enter')
  await user.until({ text: 'No plugins installed' }, 'Keyboard activation did not open Plugins.')
  await user.press('Tab')
  await user.press('Space')
  await user.until(
    { role: 'navigation', name: 'Usage panels' },
    'Keyboard activation did not open Usage.'
  )
  await user.press('Tab')
  await user.press('Enter')
  await user.until({ role: 'dialog', name: 'Settings' }, 'The rail gear did not open Settings.')
  await user.press('Escape')
  await user.until(
    () => document.querySelector('[role="dialog"]') === null,
    'Escape did not close Settings.'
  )
  await user.until(
    {
      selector: 'nav[aria-label="Main navigation"] button[aria-label="Usage"][aria-current="page"]'
    },
    'Closing Settings changed the active section.'
  )
})

function settingsShortcut(platform: 'darwin' | 'win32'): Fixture {
  return {
    ...app({}, async (user) => {
      await user.press(platform === 'darwin' ? 'Meta+,' : 'Control+,')
      await user.until(
        { role: 'dialog', name: 'Settings' },
        'The Settings keyboard shortcut did not open Settings.'
      )
    }),
    platform
  }
}

export const MacSettingsShortcut = settingsShortcut('darwin')
export const WindowsSettingsShortcut = settingsShortcut('win32')

function updateNotice(status: UpdateState['status'], notice: string): Fixture {
  return app({}, async (user) => {
    await user.until({ role: 'row', name: /code-review/ }, 'The inventory never loaded.')
    emit('onUpdateState', {
      status,
      version: '1.1.0',
      detail: status === 'manual' ? 'The app is on a read-only volume.' : null,
      autoCheck: true
    })
    await user.until(
      { role: 'button', name: `Settings · ${notice}`, exact: true },
      'The update event did not reach the Settings notice.'
    )
    await user.hover({ role: 'button', name: `Settings · ${notice}`, exact: true })
    await user.until(
      { role: 'tooltip', name: `Settings · ${notice}`, exact: true },
      'The Settings update notice showed no tooltip.'
    )
  })
}

export const UpdateReady = updateNotice('ready', 'Update ready')
export const ManualUpdateNotice = updateNotice('manual', 'Update available')

export const MainNavigation = app(historyApi(), async (user) => {
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Plugins"]' })
  await user.until({ text: 'No plugins installed' }, 'The main navigation did not open Plugins.')
  await user.until(
    {
      selector:
        'nav[aria-label="Main navigation"] button[aria-label="Plugins"][aria-current="page"]'
    },
    'The rail did not mark Plugins as the active section.'
  )
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Usage"]' })
  await user.until(
    { role: 'navigation', name: 'Usage panels' },
    'The main navigation did not open Usage.'
  )
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Skills"]' })
  await user.until(
    { role: 'row', name: /code-review/ },
    'The main navigation did not return to Skills.'
  )
  await user.until(
    {
      selector: 'nav[aria-label="Main navigation"] button[aria-label="Skills"][aria-current="page"]'
    },
    'The rail did not mark Skills as the active section.'
  )
})

export const HistoryReturn = app(historyApi(), async (user) => {
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Usage"]' })
  await user.click({ role: 'button', name: 'History', exact: true })
  await user.until(
    { role: 'searchbox', name: 'Search project timeline' },
    'History never loaded its project search.'
  )
  const calendar = document.querySelector('[aria-label^="Daily activity calendar"]')
  await user.click({ role: 'searchbox', name: 'Search project timeline' })
  await user.type('Internal')
  await user.until(
    { text: '1 of 2 projects match' },
    'History project search did not filter its timeline.'
  )
  await user.click({ role: 'button', name: 'Tokens', exact: true })
  await user.until({ role: 'radiogroup', name: 'Token usage window' }, 'Tokens did not open.')
  await user.click({ role: 'button', name: 'History', exact: true })
  await user.until(
    () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Search project timeline"]')
        ?.value === 'Internal' &&
      document.querySelector('[aria-label^="Daily activity calendar"]') === calendar,
    'Returning to History rebuilt its calendar or lost the project search.'
  )
})

export const LoadError = app(
  {
    listSkills: async () => {
      throw new Error('Fixture: skills are unavailable')
    }
  },
  (user) => user.until({ text: 'Could not load skills.' }, 'The load error never showed.')
)

export const ProjectFilterEmpty = app({}, async (user) => {
  await user.click({ role: 'button', name: 'Projects', exact: true })
  await user.until({ text: 'No project skills found' }, 'The empty project state never showed.')
})

export const ParentSix = app(tree('available'), async (user) => {
  await user.click(PARENT_SIX)
  await user.until({ text: 'Project / Megatron HQ Skills' }, 'The parent folder was not selected.')
})

export const ChildThree = app(tree('available'), async (user) => {
  await user.click(PARENT_SIX)
  await user.click(CHILD_THREE)
  await user.until({ text: 'Project / Megatron Skills' }, 'The repository was not selected.')
})

export const EmptyRepository = app(tree('available'), async (user) => {
  await user.click(PARENT_SIX)
  await user.click({ role: 'button', name: '1 without skills', exact: true })
  await user.click({ role: 'button', name: /^Empty-repo\s*0$/ })
  await user.until({ text: 'No skills found in Empty-repo' }, 'The empty repository never showed.')
})

async function openNestedRepository(user: FixtureUser): Promise<void> {
  await user.click({ role: 'button', name: /^Megatron HQ\s*9$/ })
  await user.click({ role: 'button', name: /^Megatron\s*6$/ })
  await user.click({ role: 'button', name: /^references\/child-a\s*2$/ })
  await user.until(
    { role: 'button', name: /^grandchild\s*1$/ },
    'The nested repository did not list the repository inside it.'
  )
}

export const NestedRepositories = app(tree('nested'), openNestedRepository)

export const NestedRepositoryOwn = app(tree('nested'), async (user) => {
  await openNestedRepository(user)
  await user.click({ role: 'button', name: /^This repo\s*1$/ })
})

export const UnreadableChild = app(tree('child-unavailable'), async (user) => {
  await user.click(PARENT_SIX)
  await user.click({ role: 'button', name: /^Megatron(?:\s|Unavailable)*3$/ })
  await user.until(
    { text: /Megatron will retry automatically/ },
    'The unreadable repository showed no notice.'
  )
})

export const SelectedChildRemoved = app(tree('live'), async (user) => {
  await user.click(PARENT_SIX)
  await user.click(CHILD_THREE)
  Object.assign(window.api, tree('live-removed'))
  emit('onScanComplete', {
    id: 900001,
    summary: { outcome: 'complete', completedAt: daysAgo(0), sources: [] }
  })
  await user.until(
    { text: 'Project / Megatron HQ Skills' },
    'Removing the selected repository did not move the selection to its parent.'
  )
})

async function selectPendingFolder(user: FixtureUser): Promise<void> {
  await user.click({ role: 'button', name: /Megatron HQ.*6/ })
  await user.until({ text: 'Project / Megatron HQ Skills' }, 'The new folder was not selected.')
}

function finishFolderScan(mode: ProjectTreeMode, outcome: 'complete' | 'partial'): void {
  Object.assign(window.api, tree(mode))
  emit('onScanComplete', {
    id: 9001,
    summary: {
      outcome,
      completedAt: daysAgo(0),
      sources: [{ name: 'scanSkills', status: outcome }]
    }
  })
}

const REFRESH_FAILED = { text: /This folder could not be refreshed/ }

export const AddedFolderPending = app(tree('pending'), selectPendingFolder)

export const AddedFolderDiscovered = app(tree('pending'), async (user) => {
  await selectPendingFolder(user)
  finishFolderScan('available', 'complete')
  await user.until(CHILD_THREE, 'The finished scan did not list the repositories it found.')
})

export const AddedFolderFailedRetry = app(tree('pending'), async (user) => {
  await selectPendingFolder(user)
  finishFolderScan('unavailable', 'partial')
  await user.until(REFRESH_FAILED, 'The failed scan showed no notice.')
  emit('onScanStarted', {
    id: 9002,
    startedAt: Date.now() - 60_000,
    isStartup: false,
    revealMs: 500
  })
  await user.until(REFRESH_FAILED, 'The retry hid the notice before it had a result.')
})

export const ScanUpdatingBanner = app(scanning({}), (user) =>
  user.until(UPDATING_BANNER, 'The startup scan showed no updating banner.')
)

export const ScanRetryingHidesOldFailure = app(
  scanning(
    {},
    { outcome: 'failed', isStartup: true, sources: [{ name: 'scanSkills', status: 'failed' }] }
  ),
  async (user) => {
    await user.until(UPDATING_BANNER, 'The retry showed no updating banner.')
    await user.until(
      () => !statusShows(/could not finish/),
      'The earlier failure stayed on screen while the retry was running.'
    )
  }
)

export const ScanBackgroundSilent = app(
  scanning({ isStartup: false, revealMs: 8_000 }),
  async (user) => {
    await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
    await user.until(
      () => !statusShows(/Refreshing Claude Code data|Scanning Claude Code data/),
      'A background refresh showed the updating banner.'
    )
  }
)

export const ScanMissingProjectQuiet = app(
  {
    listSkills: async () =>
      skillsResult(undefined, {
        scanSummary: {
          outcome: 'partial',
          isStartup: true,
          completedAt: daysAgo(0),
          sources: [
            {
              name: 'scanPluginRegistry',
              status: 'partial',
              issues: [{ code: 'project_missing', path: 'C:\\Old Projects\\Megatron' }]
            }
          ]
        }
      })
  },
  async (user) => {
    await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
    await user.until(
      () => document.querySelector('[role="status"]') === null,
      'A scan whose only problem is a missing project folder showed a warning banner.'
    )
  }
)

// Behaviour: a blocked repo link raises the folder-access banner, not the generic refresh warning.
export const ScanLinkNeedsAccess = app(
  {
    listSkills: async () =>
      skillsResult(undefined, {
        scanSummary: {
          outcome: 'partial',
          isStartup: true,
          completedAt: daysAgo(0),
          sources: [
            {
              name: 'scanSkills',
              status: 'partial',
              issues: [
                {
                  code: 'link_unapproved',
                  path: 'C:\\Projects\\Megatron\\.claude\\skills\\shared-review',
                  target: 'D:\\team-skills\\shared-review'
                }
              ]
            }
          ]
        }
      })
  },
  async (user) => {
    await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
    await user.until(
      () => statusShows(/Some folders need access to finish scanning/),
      'An unapproved link did not show the folder-access banner.'
    )
  }
)

const WHATS_NEW_CARD = { role: 'region', name: "What's new in Megatron" }

function whatsNew(initial: Partial<ReturnType<Api['getInitialWhatsNew']>>): Partial<Api> {
  return {
    ...historyApi(),
    getUsageOverview: async () => overviewWithSkillCost(),
    getInitialWhatsNew: () => ({ unseen: [], latest: COST_RELEASE, dots: [], ...initial })
  }
}

// Behaviour: Show me leaves the card, opens the anchor's section and panel, and rings the anchor.
export const WhatsNewShowMe = app(whatsNew({ unseen: [COST_RELEASE] }), async (user) => {
  await user.until(WHATS_NEW_CARD, 'An upgrade with unseen news showed no card.')
  await user.click({ role: 'button', name: 'Show me' })
  await user.until(
    { selector: '[data-whats-new-ring="usage-skill-cost"]' },
    'Show me did not ring the new control.'
  )
  await user.until(
    () =>
      document.querySelector('[aria-label="What\'s new in Megatron"]') === null &&
      document.querySelector('[data-whats-new="usage-skill-cost"]') !== null,
    'Show me did not close the card and open Usage › Skills.'
  )
})

// Behaviour: onboarding wins; the card never stacks on its modal.
export const WhatsNewWaitsForOnboarding = app(
  {
    ...whatsNew({ unseen: [COST_RELEASE] }),
    getInitialOnboarding: () => true
  },
  async (user) => {
    await user.until({ role: 'dialog' }, 'Onboarding did not open.')
    await user.until(
      () => document.querySelector('[aria-label="What\'s new in Megatron"]') === null,
      "The What's new card showed on top of onboarding."
    )
  }
)

// Behaviour: a dot marks the new control until the user first interacts with it.
export const WhatsNewDotClears = app(whatsNew({ dots: ['usage-skill-cost'] }), async (user) => {
  await user.click({ selector: 'nav[aria-label="Main navigation"] button[aria-label="Usage"]' })
  await user.until({ role: 'navigation', name: 'Usage panels' }, 'Usage did not open.')
  await user.click({ selector: 'nav[aria-label="Usage panels"] button:has-text("Skills")' })
  const dot = '[data-whats-new-dot="usage-skill-cost"]'
  await user.until({ selector: dot }, 'The new control showed no dot.')
  await user.click({ text: 'Estimated cost attribution' })
  await user.until(
    () => document.querySelector(dot) === null,
    'Interacting with the new control left its dot in place.'
  )
})

// Behaviour: Settings › What's new replays the latest release after the card was dismissed.
export const WhatsNewSettingsReplay = app(whatsNew({}), async (user) => {
  await user.until({ role: 'row', name: /code-review/ }, 'The inventory never loaded.')
  await user.press('Control+,')
  await user.click({ role: 'button', name: "What's new", exact: true })
  await user.until(WHATS_NEW_CARD, "Settings › What's new did not replay the card.")
})

// Behaviour: a sidebar filter is a way to reach a list, so choosing one leaves an open detail page.
export const FilterClosesDetail = app(
  { openSkillMeta: async (id) => skillMeta(id) },
  async (user) => {
    const back = { role: 'button', name: 'Back to skills' }
    await user.click({ role: 'row', name: /code-review/ })
    await user.until(back, 'Clicking a row did not open the skill detail page.')
    await user.click({ role: 'button', name: 'Global', exact: true })
    await user.until({ text: 'Global Skills' }, 'The Global filter did not show its list.')
    await user.until(
      () => document.querySelector('button[aria-label="Back to skills"]') === null,
      'Changing the sidebar filter left the skill detail page open.'
    )
  }
)

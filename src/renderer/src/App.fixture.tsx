// Whole-app fixtures: states that only exist once App wires the sidebar, the scan banner and the
// inventory together, and behaviours that cross screens.
import type { Api } from '../../shared/api'
import type { ScanActivity, ScanSummary } from '../../shared/ipc'
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

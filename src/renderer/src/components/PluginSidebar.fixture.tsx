// The plugin sidebar on its own for the rows only it has, and through App for what a scan and the
// inventory do to its selection.
import { useState } from 'react'
import App from '@/App'
import { daysAgo } from '@/fixtures/data'
import { fixture, sidebar, type Fixture, type FixtureUser, type Target } from '@/fixtures/define'
import { emit } from '@/fixtures/fake-api'
import { basePlugins, pluginReads, pluginTree, type PluginTreeMode } from '@/fixtures/plugin-data'
import type { PluginFilter } from '@/lib/plugin-filter'
import { PluginSidebar } from './PluginSidebar'

// Holds the filter and the expanded rows the way App does, so clicks change what they change in
// the app.
function PluginsSidebar({ userOnly }: { userOnly: boolean }): React.JSX.Element {
  const [tree] = useState(() => pluginTree())
  const [filter, setFilter] = useState<PluginFilter>({ kind: 'all' })
  const [expanded, setExpanded] = useState(() => new Set(['$projects']))
  return (
    <PluginSidebar
      plugins={userOnly ? basePlugins : tree.plugins}
      filter={filter}
      onFilterChange={setFilter}
      onFilterSnap={setFilter}
      folders={userOnly ? [] : tree.folders}
      projectCatalog={userOnly ? [] : tree.projects}
      home="/Users/fixture"
      expandedProjects={expanded}
      setExpandedProjects={setExpanded}
    />
  )
}

function pluginsSidebar(interact: Fixture['interact'], userOnly = false): Fixture {
  return fixture({
    frame: sidebar('plugins'),
    render: () => <PluginsSidebar userOnly={userOnly} />,
    interact
  })
}

function app(mode: PluginTreeMode, interact: Fixture['interact']): Fixture {
  return fixture({
    frame: 'window',
    api: { getInitialSection: () => 'plugins', ...pluginReads(mode) },
    render: () => <App />,
    interact
  })
}

const PARENT_SIX: Target = { role: 'button', name: /^Megatron HQ\s*6$/ }
const CHILD_THREE: Target = { role: 'button', name: /^Megatron\s*3$/ }
const PARENT_SELECTED: Target = { text: 'Projects / Megatron HQ Plugins' }
const REFRESH_FAILED: Target = { text: /This folder could not be refreshed/ }

const noticeShown = (): boolean => document.querySelector('main [role="status"]') !== null

// Plugin records Claude Code wrote without a project get a row of their own, below the folders.
export const UnknownProjectSelected = pluginsSidebar(async (user) => {
  await user.click({ role: 'button', name: /^Unknown project\s*1$/ })
  await user.until(
    { selector: 'nav button.bg-accent-lime' },
    'Clicking Unknown project did not select it.'
  )
})

// With nothing granted and only user installs, Projects says there is nothing under it.
export const NoProjectFolders = pluginsSidebar(
  (user) => user.until({ text: 'No project folders' }, 'An empty Projects list said nothing.'),
  true
)

async function selectPendingFolder(user: FixtureUser): Promise<void> {
  await user.click({ role: 'button', name: /Megatron HQ.*6/ })
  await user.until(PARENT_SELECTED, 'The new folder was not selected.')
}

function finishFolderScan(mode: PluginTreeMode, outcome: 'complete' | 'partial'): void {
  Object.assign(window.api, pluginReads(mode))
  emit('onScanComplete', {
    id: 9001,
    summary: {
      outcome,
      completedAt: daysAgo(0),
      sources: [{ name: 'scanSkills', status: outcome }]
    }
  })
}

export const AddedFolderPending = app('pending', selectPendingFolder)

export const AddedFolderDiscovered = app('pending', async (user) => {
  await selectPendingFolder(user)
  finishFolderScan('available', 'complete')
  await user.until(CHILD_THREE, 'The finished scan did not list the repositories it found.')
})

export const AddedFolderFailedRetry = app('pending', async (user) => {
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

// The child carries its own marker; the parent it sits in stays healthy and says nothing.
export const HealthyParentWithUnreadableChild = app('child-unavailable', async (user) => {
  await user.click(PARENT_SIX)
  await user.until(PARENT_SELECTED, 'The parent folder was not selected.')
  await user.until(
    { role: 'button', name: /^Megatron\s*Unavailable\s*3$/ },
    'The unreadable repository was not marked.'
  )
  await user.until(() => !noticeShown(), "The healthy parent showed its child's notice.")
})

// Behaviour: a scan that removes the repository an open plugin was reached from closes the plugin
// and moves the selection to the parent.
export const SelectedChildDetailRemoved = app('live', async (user) => {
  await user.click(PARENT_SIX)
  await user.click(CHILD_THREE)
  await user.click({ role: 'row', name: /build-tools/ })
  await user.until({ role: 'button', name: 'Back to plugins' }, 'The plugin did not open.')
  Object.assign(window.api, pluginReads('live-removed'))
  emit('onScanComplete', {
    id: 900001,
    summary: { outcome: 'complete', completedAt: daysAgo(0), sources: [] }
  })
  await user.until(PARENT_SELECTED, 'Removing the repository did not select its parent.')
  await user.until(
    () => document.querySelector('button[aria-label="Back to plugins"]') === null,
    'Removing the repository left its plugin open.'
  )
})

export const NestedRepositories = app('nested', async (user) => {
  await user.click({ role: 'button', name: /^Megatron HQ\s*9$/ })
  await user.click({ role: 'button', name: /^Megatron\s*6$/ })
  await user.click({ role: 'button', name: /^references\/child-a\s*2$/ })
  await user.until(
    { role: 'button', name: /^grandchild\s*1$/ },
    'The nested repository did not list the repository inside it.'
  )
})

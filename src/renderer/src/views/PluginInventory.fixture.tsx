// The plugin inventory on its own for the states it holds itself, and through App for the ones the
// plugin sidebar's selection puts it in.
import App from '@/App'
import { fixture, sheet, type Fixture, type Target } from '@/fixtures/define'
import { pluginReads, pluginTree, type PluginTreeMode } from '@/fixtures/plugin-data'
import { createPluginRows, type PluginFilter } from '@/lib/plugin-filter'
import type { Api } from '../../../shared/api'
import { PluginInventory } from './PluginInventory'

const ignore = (): void => {}

const ALL: PluginFilter = { kind: 'all' }

function inventory(
  interact: Fixture['interact'],
  state: 'rows' | 'empty' | 'loading' = 'rows'
): Fixture {
  const tree = pluginTree()
  return fixture({
    frame: sheet('plugins'),
    render: () => (
      <PluginInventory
        plugins={
          state === 'rows'
            ? createPluginRows(tree.plugins, ALL, tree.projects, tree.skills.skills)
            : []
        }
        loading={state === 'loading'}
        filter={ALL}
        onSelect={ignore}
        onOpenSearch={ignore}
      />
    ),
    interact
  })
}

function app(
  interact: Fixture['interact'],
  mode: PluginTreeMode = 'available',
  api: Partial<Api> = {}
): Fixture {
  return fixture({
    frame: 'window',
    api: { getInitialSection: () => 'plugins', ...pluginReads(mode), ...api },
    render: () => <App />,
    interact
  })
}

const PARENT_SIX: Target = { role: 'button', name: /^Megatron HQ\s*6$/ }
const CHILD_THREE: Target = { role: 'button', name: /^Megatron\s*3$/ }

const tableRows = (): number => document.querySelectorAll('main tbody tr').length

const hasColumn = (name: string): boolean =>
  [...document.querySelectorAll('main thead th')].some((cell) => cell.textContent === name)

export const Loading = inventory(
  (user) => user.until({ selector: '[data-slot="skeleton"]' }, 'Loading showed no skeleton rows.'),
  'loading'
)

export const Empty = inventory(
  (user) =>
    user.until({ text: 'No plugins installed' }, 'An empty inventory showed no empty state.'),
  'empty'
)

// A repository holding one plugin at two scopes and two versions shows Mixed, never one of them.
export const MixedVersionTooltip = inventory(async (user) => {
  await user.hover({ text: 'Mixed', exact: true })
  await user.until(
    { text: 'Mixed versions: project (Megatron): v1.0.0, local (Megatron): v2.0.0' },
    'The Mixed version showed no tooltip listing each install.'
  )
})

// Below 1400 px the badge drops its word, so the tooltip is what says which version is waiting.
export const UpdateTooltip = inventory(async (user) => {
  await user.hover({ selector: 'tbody svg.text-info' })
  await user.until(
    { text: 'Update available for User scope: v1.2.0 → v1.4.0' },
    'The update badge showed no tooltip.'
  )
})

export const SearchHintWindows: Fixture = {
  ...inventory((user) => user.until({ text: 'Ctrl+K' }, 'Windows showed no Ctrl+K search hint.')),
  platform: 'win32'
}

// Every scope at once: user installs, one row per repository for project and local installs, and
// a record with no project.
export const Open = app((user) =>
  user.until({ role: 'row', name: /ops-kit/ }, 'The plugin inventory never listed its plugins.')
)

export const LoadError = app(
  (user) => user.until({ text: 'Could not load plugins.' }, 'The load error never showed.'),
  'available',
  {
    listPlugins: async () => {
      throw new Error('Fixture: plugins are unavailable')
    }
  }
)

export const ParentSix = app(async (user) => {
  await user.click(PARENT_SIX)
  await user.until(
    { text: 'Projects / Megatron HQ Plugins' },
    'The parent folder was not selected.'
  )
})

export const ChildThree = app(async (user) => {
  await user.click(PARENT_SIX)
  await user.click(CHILD_THREE)
  await user.until({ text: 'Projects / Megatron Plugins' }, 'The repository was not selected.')
})

// A parent that is a repository too lists its own plugins under This repo.
export const ParentOwnItems = app(async (user) => {
  await user.click({ role: 'button', name: /^Megatron HQ\s*7$/ })
  await user.click({ role: 'button', name: /^This repo\s*1$/ })
  await user.until(
    () =>
      tableRows() === 1 &&
      document.querySelector('main tbody')?.textContent?.includes('folder-tool') === true,
    "This repo listed more than the parent's own plugin."
  )
}, 'own')

export const UnavailableCached = app(async (user) => {
  await user.click({ role: 'button', name: /Megatron HQ.*6/ })
  await user.click({ role: 'button', name: /^Megatron(?:\s|Unavailable)*3$/ })
  await user.until(
    { text: /This project folder is missing/ },
    'The missing repository showed no notice over its cached plugins.'
  )
}, 'unavailable')

export const DuplicateRepositoryNames = app(async (user) => {
  await user.click(PARENT_SIX)
  await user.until(
    { role: 'button', name: /^clients\/Megatron\s*3$/ },
    'Two repositories named Megatron were not told apart by their folders.'
  )
}, 'duplicates')

// One click on Projects both filters to every project install and opens the list.
export const ProjectsExpanded = app(async (user) => {
  await user.click({ role: 'button', name: 'Projects', exact: true })
  await user.until(
    () =>
      document.querySelector('main h2')?.textContent?.startsWith('Project Plugins') === true &&
      document.querySelector('[aria-label="Collapse project list"]') !== null,
    'Clicking Projects did not filter to project plugins with the list open.'
  )
})

// A repository granted on its own: the table drops the Repository column, the sidebar says it.
export const RepositorySelected = app(async (user) => {
  await user.click({ role: 'button', name: /^Megatron-site\s*3$/ })
  await user.until({ text: 'Projects / Megatron-site Plugins' }, 'The repository was not selected.')
  await user.until(
    () => !hasColumn('Repository'),
    'One repository selected kept the Repository column.'
  )
}, 'grouped')

// User scope has no repository and no scope to state, so both columns go.
export const UserSelected = app(async (user) => {
  await user.click({ role: 'button', name: 'User', exact: true })
  await user.until({ text: 'User Plugins' }, 'The User filter did not show its list.')
  await user.until(
    () => !hasColumn('Scope') && !hasColumn('Repository'),
    'The User filter kept the Scope or Repository column.'
  )
})

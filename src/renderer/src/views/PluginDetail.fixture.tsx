// The plugin detail page on its own for the states it holds itself, and through App for the ones
// that need the inventory around it: the context a row opens it in, an action still running after
// Back and reopen, and update phases the main process reports.
import App from '@/App'
import { FIRST, SECOND } from '@/fixtures/data'
import { fixture, sheet, type Fixture, type FixtureUser } from '@/fixtures/define'
import { emit } from '@/fixtures/fake-api'
import { pluginReads, type PluginTreeMode } from '@/fixtures/plugin-data'
import type { PluginContext } from '@/lib/plugin-filter'
import type { Api } from '../../../shared/api'
import type { PluginUpdatePhase, ProjectFolder } from '../../../shared/ipc'
import { PluginDetail } from './PluginDetail'

const ignore = (): void => {}

interface Identity {
  name: string
  marketplace: string
}

const OPS_KIT: Identity = { name: 'ops-kit', marketplace: 'fixture-market' }
const DOCS_KIT: Identity = { name: 'docs-kit', marketplace: 'fixture-market' }
const REVIEW_KIT: Identity = { name: 'review-kit', marketplace: 'other-market' }
const BUILD_TOOLS: Identity = { name: 'build-tools', marketplace: 'fixture-market' }
const UNASSIGNED: Identity = { name: 'unassigned-tool', marketplace: 'fixture-market' }

const never = (): Promise<never> => new Promise(() => {})

function detail(
  plugin: Identity,
  interact: Fixture['interact'],
  {
    context = { kind: 'user' },
    availability,
    mode = 'available',
    api = {}
  }: {
    // A row in All Plugins opens a user install in the user context, so that is the default.
    context?: PluginContext
    availability?: ProjectFolder['status']
    mode?: PluginTreeMode
    api?: Partial<Api>
  } = {}
): Fixture {
  return fixture({
    frame: sheet('plugins'),
    api: { ...pluginReads(mode), ...api },
    render: () => (
      <PluginDetail
        name={plugin.name}
        marketplace={plugin.marketplace}
        context={context}
        availability={availability}
        onBack={ignore}
        onViewSkills={ignore}
        onActionSuccess={ignore}
        onManageFolders={ignore}
      />
    ),
    interact
  })
}

function app(api: Partial<Api>, interact: Fixture['interact']): Fixture {
  return fixture({
    frame: 'window',
    api: { getInitialSection: () => 'plugins', ...pluginReads(), ...api },
    render: () => <App />,
    interact
  })
}

const loaded = (user: FixtureUser): Promise<void> =>
  user.until({ text: 'Installs', exact: true }, 'The plugin never loaded.')

async function openPlugin(user: FixtureUser, plugin: Identity): Promise<void> {
  await user.click({ role: 'row', name: new RegExp(`^${plugin.name}`) })
  await user.until({ role: 'button', name: 'Back to plugins' }, `${plugin.name} did not open.`)
}

const button = (name: string): { role: string; name: string; exact: boolean } => ({
  role: 'button',
  name,
  exact: true
})

export const Open = detail(OPS_KIT, loaded)

export const Loading = detail(
  OPS_KIT,
  (user) => user.until({ text: 'Loading…' }, 'A pending read showed no loading state.'),
  { api: { getPluginDetail: never } }
)

export const LoadError = detail(
  OPS_KIT,
  (user) => user.until({ text: 'Could not load this plugin.' }, 'The load error never showed.'),
  {
    api: {
      getPluginDetail: async () => {
        throw new Error('Fixture: the plugin is unavailable')
      }
    }
  }
)

// Removed since the last scan.
export const NotFound = detail(
  OPS_KIT,
  (user) => user.until({ text: 'Plugin not found' }, 'A plugin that is gone said nothing.'),
  { api: { getPluginDetail: async () => null } }
)

export const ComponentsExpanded = detail(OPS_KIT, async (user) => {
  await user.click(button('Show all 7'))
  await user.until(
    { text: 'Summarize the health of every environment' },
    'Show all did not list the commands past the first five.'
  )
})

export const Disabled = detail(DOCS_KIT, (user) =>
  user.until(button('Enable'), 'A disabled plugin offered no Enable.')
)

// The destructive action names the plugin and the install before it runs.
export const UninstallConfirm = detail(OPS_KIT, async (user) => {
  await loaded(user)
  await user.click(button('Uninstall'))
  await user.until(
    { role: 'dialog', name: 'Uninstall ops-kit?' },
    'Uninstall ran without asking first.'
  )
})

export const ActionError = detail(
  REVIEW_KIT,
  async (user) => {
    await loaded(user)
    await user.click(button('Update'))
    await user.until({ role: 'alert' }, 'A failed update showed no error on its install.')
  },
  {
    api: {
      updatePlugin: async () => ({
        ok: false,
        stderr:
          'Failed to update review-kit@other-market: marketplace "other-market" is unreachable'
      })
    }
  }
)

// A project install opened from its repository: the page names the repository and lists only the
// installs there.
export const ProjectScope = detail(
  BUILD_TOOLS,
  (user) => user.until({ text: 'Repository: Megatron-site' }, 'The repository was not named.'),
  { context: { kind: 'project', path: SECOND } }
)

export const MissingProject = detail(
  BUILD_TOOLS,
  (user) =>
    user.until(
      { text: /and that folder is missing/ },
      'An install in a missing folder did not say why its actions are off.'
    ),
  { context: { kind: 'project', path: FIRST }, availability: 'missing', mode: 'unavailable' }
)

export const NeedsFolderAccess = detail(
  BUILD_TOOLS,
  (user) =>
    user.until(
      { text: /to see whether this install is enabled/ },
      'An install in an ungranted folder did not ask for access.'
    ),
  { context: { kind: 'project', path: FIRST }, availability: 'needs_access' }
)

// A local install Claude Code recorded with no project: there is no folder to run the CLI from.
export const UnknownProject = detail(
  UNASSIGNED,
  (user) =>
    user.until(
      { text: /doesn't record its project/ },
      'An install with no project did not say why its actions are off.'
    ),
  { context: { kind: 'unknown' } }
)

// Reached from one repository, the page keeps to that repository's installs.
export const ContextDetails = app({}, async (user) => {
  await user.click({ role: 'button', name: /^Megatron HQ\s*6$/ })
  await user.click({ role: 'button', name: /^Megatron\s*3$/ })
  await openPlugin(user, BUILD_TOOLS)
  await user.until(
    { text: 'Repository: Megatron' },
    'The repository the plugin came from was not named.'
  )
})

// Behaviour: an action keeps running when its page closes, and the page shows it on return.
// Reopening starts at the top, so these use plugins whose install row fits on screen.
function pendingAfterNavigation(
  plugin: Identity,
  api: Partial<Api>,
  start: string,
  pending: string
): Fixture {
  return app(api, async (user) => {
    await openPlugin(user, plugin)
    await user.click(button(start))
    await user.until(button(pending), `${start} showed no pending state.`)
    await user.click({ role: 'button', name: 'Back to plugins' })
    await openPlugin(user, plugin)
    await user.until(button(pending), `Reopening ${plugin.name} lost its pending ${start}.`)
  })
}

export const DisablePendingAfterNavigation = pendingAfterNavigation(
  REVIEW_KIT,
  { disablePlugin: never },
  'Disable',
  'Disabling…'
)

export const EnablePendingAfterNavigation = pendingAfterNavigation(
  DOCS_KIT,
  { enablePlugin: never },
  'Enable',
  'Enabling…'
)

export const UpdatePendingAfterNavigation = pendingAfterNavigation(
  REVIEW_KIT,
  { updatePlugin: never },
  'Update',
  'Updating…'
)

// The main process reports which step of an update is running; the Update button names it.
function updatePhase(phase: PluginUpdatePhase, label: string): Fixture {
  return app({ updatePlugin: never }, async (user) => {
    await openPlugin(user, REVIEW_KIT)
    await user.click(button('Update'))
    await user.until(button('Updating…'), 'Update showed no pending state.')
    emit('onPluginUpdateProgress', {
      input: { ...REVIEW_KIT, scope: 'user', projectPath: null },
      phase
    })
    await user.until(button(label), `The ${phase} step did not show on the Update button.`)
  })
}

export const UpdateMarketplace = updatePhase('marketplace', 'Refreshing marketplace…')

export const UpdateVerify = updatePhase('verify', 'Verifying…')

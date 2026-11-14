// The toasts on their own for how they stack, and through App for how a verified action raises one
// and how it leaves.
import App from '@/App'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { pluginDetail, pluginReads, pluginTree } from '@/fixtures/plugin-data'
import type { PluginRow } from '../../../shared/ipc'
import { PluginActionToasts, type PluginActionToast } from './PluginActionToasts'

const ignore = (): void => {}

function toasts(list: PluginActionToast[]): Fixture {
  return fixture({
    frame: 'window',
    render: () => <PluginActionToasts toasts={list} onDismiss={ignore} />,
    interact: (user) => user.until({ text: list[0].message }, 'The toast never showed.')
  })
}

export const One = toasts([{ id: 0, message: 'review-kit updated to 1.4.0' }])

// Three is as many as App keeps. The newest sits on top, and a long name wraps inside its toast.
export const Stacked = toasts([
  { id: 0, message: 'ops-kit disabled' },
  { id: 1, message: 'docs-kit enabled' },
  { id: 2, message: 'claude-code-release-notes-generator is up to date (2.3.1)' }
])

// What the main process reports once review-kit is off: the same plugins, with its install disabled.
const afterDisable: PluginRow[] = pluginTree().plugins.map((plugin) =>
  plugin.name === 'review-kit'
    ? {
        ...plugin,
        disabled_reason: 'plugin',
        installs: plugin.installs.map((install) => ({ ...install, disabled_reason: 'plugin' }))
      }
    : plugin
)

const TOAST = 'review-kit disabled'

const toastShown = (): boolean =>
  document.querySelector(`button[aria-label="Dismiss ${TOAST}"]`) !== null

function app(interact: (user: FixtureUser) => Promise<void>): Fixture {
  return fixture({
    frame: 'window',
    api: {
      getInitialSection: () => 'plugins',
      ...pluginReads(),
      disablePlugin: async (input) => ({
        ok: true,
        detail: pluginDetail(afterDisable, input.name, input.marketplace)
      })
    },
    render: () => <App />,
    interact: async (user) => {
      await user.click({ role: 'row', name: /^review-kit/ })
      await user.click({ role: 'button', name: 'Disable', exact: true })
      await user.until({ text: TOAST, exact: true }, 'A verified disable raised no toast.')
      await user.until(
        { role: 'button', name: 'Enable', exact: true },
        'The page did not show the plugin disabled.'
      )
      await interact(user)
    }
  })
}

// Behaviour: the toast's own button removes it.
export const Dismissed = app(async (user) => {
  await user.click({ role: 'button', name: `Dismiss ${TOAST}` })
  await user.until(() => !toastShown(), 'Dismissing the toast left it on screen.')
})

// Behaviour: left alone, the toast goes after three seconds.
export const Expired = app((user) =>
  user.until(() => !toastShown(), 'The toast stayed past its three seconds.')
)

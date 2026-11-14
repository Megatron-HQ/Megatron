// The Settings dialog on its own for the states it holds itself (the rescan result, the update
// section), and through App for what reaches it from the scan banner and the main process.
import type { ComponentProps } from 'react'
import App from '@/App'
import { completeScan, skillsResult } from '@/fixtures/data'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { emit } from '@/fixtures/fake-api'
import { pluginReads } from '@/fixtures/plugin-data'
import type { Api } from '../../../shared/api'
import type { ScanSourceSummary, ScanSummary, UpdateState } from '../../../shared/ipc'
import { SettingsDialog } from './SettingsDialog'

const ignore = (): void => {}

// The clock is frozen, so a summary that finished later has to say so in its own timestamp.
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const OLD_PROJECT = 'C:\\Old Projects\\Megatron'

function partial(
  isStartup: boolean,
  completedAt: string,
  sources: ScanSourceSummary[]
): ScanSummary {
  return { outcome: 'partial', isStartup, completedAt, sources }
}

function pluginIssue(
  code: 'project_missing' | 'permission_required',
  path: string
): ScanSourceSummary {
  return { name: 'scanPluginRegistry', status: 'partial', issues: [{ code, path }] }
}

const missingProject = (completedAt: string): ScanSummary =>
  partial(true, completedAt, [pluginIssue('project_missing', OLD_PROJECT)])

const needsAccess = (isStartup: boolean): ScanSummary =>
  partial(isStartup, minutesAgo(10), [
    pluginIssue('permission_required', 'C:\\Projects\\Megatron HQ\\Megatron')
  ])

const timedOut = partial(false, minutesAgo(1), [
  { name: 'scanTranscripts', status: 'complete' },
  { name: 'archiveTokens', status: 'complete' },
  { name: 'scanSkills', status: 'failed', failureReason: 'timeout' }
])

function dialog(
  props: Partial<ComponentProps<typeof SettingsDialog>>,
  api?: Partial<Api>,
  interact?: Fixture['interact']
): Fixture {
  return fixture({
    frame: 'window',
    api,
    render: () => (
      <SettingsDialog
        open
        onOpenChange={ignore}
        themePreference="system"
        onThemeChange={ignore}
        version="1.0.0"
        scanSummary={completeScan()}
        scanning={false}
        onManageFolders={ignore}
        onShowWelcome={ignore}
        updateState={{ status: 'unsupported', version: null, autoCheck: true }}
        {...props}
      />
    ),
    interact
  })
}

function app(api: Partial<Api>, interact: Fixture['interact']): Fixture {
  return fixture({ frame: 'window', api, render: () => <App />, interact })
}

const reported = (summary: ScanSummary): Partial<Api> => ({
  listSkills: async () => skillsResult(undefined, { scanSummary: summary })
})

async function rescan(user: FixtureUser, result: string): Promise<void> {
  await user.click({ role: 'button', name: 'Rescan now', exact: true })
  await user.until({ text: result, exact: true }, `The rescan did not end on "${result}".`)
}

const openSettings = (user: FixtureUser): Promise<void> =>
  user.click({ role: 'button', name: 'Settings', exact: true })

const openScanDetails = (user: FixtureUser): Promise<void> =>
  user.click({ role: 'button', name: 'Scan details', exact: true })

const bodyHas = (text: string): boolean => document.body.textContent?.includes(text) ?? false

export const Open = dialog({}, undefined, (user) =>
  user.until({ role: 'radio', name: 'System' }, 'The appearance choice never showed.')
)

export const RescanOutcome = dialog({}, { rescan: async () => completeScan() }, (user) =>
  rescan(user, 'Scan complete.')
)

export const RescanLocalProgress = dialog(
  {},
  { rescan: () => new Promise(() => {}) },
  async (user) => {
    await user.click({ role: 'button', name: 'Rescan now', exact: true })
    await user.until(
      { role: 'button', name: 'Rescanning…', exact: true },
      'A running rescan did not show its progress on the button.'
    )
  }
)

// The skills stage timed out after the transcript and token stages finished, so the usage history
// they wrote stays and only the skills stage asks for another try.
export const TimeoutRetainsUsage = dialog(
  { scanSummary: timedOut },
  { rescan: async () => timedOut },
  async (user) => {
    await rescan(user, 'Some sources could not be refreshed. Review the details below.')
    await user.until(
      { text: 'This stage exceeded its time limit. Try rescanning.' },
      'The timed-out stage showed no reason.'
    )
  }
)

export const MovedProjectDetails = dialog(
  { scanSummary: missingProject(minutesAgo(10)) },
  undefined,
  (user) => user.until({ text: OLD_PROJECT, exact: true }, 'The missing project path never showed.')
)

// A scan whose only problem is a moved project counts as complete.
export const MissingProjectRescan = dialog(
  { scanSummary: missingProject(minutesAgo(10)) },
  { rescan: async () => missingProject(minutesAgo(1)) },
  async (user) => {
    await rescan(user, 'Scan complete.')
    await user.until(
      { text: 'Missing project folders', exact: true },
      'The rescan dropped the missing project details.'
    )
  }
)

const available: UpdateState = { status: 'available', version: '1.1.0', autoCheck: true }

export const UpdateAvailable = dialog({ updateState: available }, undefined, (user) =>
  user.until({ text: 'brew upgrade --cask megatron' }, 'macOS showed no Homebrew upgrade line.')
)

// Windows downloads the update itself, so the dialog offers a restart instead of a download.
export const UpdateReadyWindows: Fixture = {
  ...dialog(
    { updateState: { status: 'ready', version: '1.1.0', autoCheck: true } },
    undefined,
    (user) =>
      user.until(
        { role: 'button', name: 'Restart to update' },
        'Windows offered no restart for a downloaded update.'
      )
  ),
  platform: 'win32'
}

export const UpdateDotTooltip = app({ getUpdateState: async () => available }, async (user) => {
  const name = 'Settings · Update available'
  await user.hover({ role: 'button', name })
  await user.until({ role: 'tooltip', name }, 'The rail gear did not announce the update.')
})

// Behaviour: a background refresh replaces the details with its newer summary, and the manual
// rescan's message comes back once each refresh finishes. The first refresh touches only the
// inventory, the second the usage history too.
export const ManualResultSurvivesBackgroundRefresh = app(
  {
    ...reported(missingProject(minutesAgo(10))),
    rescan: async () => missingProject(minutesAgo(3))
  },
  async (user) => {
    await openSettings(user)
    await rescan(user, 'Scan complete.')
    for (const [index, full] of [false, true].entries()) {
      const path = `C:\\Projects\\Temporarily unreadable ${full ? 'full' : 'inventory'}\\.claude\\settings.json`
      const id = 9003 + index
      const sources: ScanSourceSummary[] = [
        { name: 'scanSkills', status: 'complete' },
        {
          name: 'scanPluginRegistry',
          status: 'partial',
          issues: [{ code: 'source_unavailable', path }]
        },
        { name: 'runLinter', status: 'complete' }
      ]
      if (full) sources.unshift({ name: 'scanTranscripts', status: 'complete' })
      emit('onScanStarted', { id, startedAt: Date.now(), isStartup: false, revealMs: 8_000 })
      emit('onScanComplete', { id, summary: partial(false, minutesAgo(2 - index), sources) })
      await user.until(
        { text: path, exact: true },
        'The newer summary did not replace the details.'
      )
      await user.until(
        { text: 'Scan complete.', exact: true },
        'A background refresh wiped the manual rescan result.'
      )
    }
  }
)

// A scan the person started reports in the dialog, never in the app-wide banner.
export const ManualPartialWithoutTopBanner = app(reported(needsAccess(false)), async (user) => {
  await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
  await openSettings(user)
  await user.until(
    { role: 'button', name: 'Manage folder access', exact: true },
    'The partial scan showed no details in Settings.'
  )
  await user.until(
    () => !bodyHas('Some project settings need folder access'),
    'A manual scan raised the app-wide warning banner.'
  )
})

// Behaviour: the inventory still reports run 9001 when run 9002 finishes; the older run must not
// come back as "scanning".
export const NewerRunFinishesBeforeSnapshot = app(
  {
    listSkills: async () =>
      skillsResult(undefined, {
        scanActivity: {
          id: 9001,
          startedAt: Date.now() - 60_000,
          isStartup: false,
          revealMs: 500
        }
      })
  },
  async (user) => {
    await openSettings(user)
    await user.until(
      { text: 'Scanning Claude Code data…', exact: true },
      'Settings did not show the running scan.'
    )
    emit('onScanStarted', { id: 9002, startedAt: Date.now(), isStartup: false, revealMs: 500 })
    emit('onScanComplete', {
      id: 9002,
      summary: { ...completeScan(), isStartup: false }
    })
    await user.until(
      () => !bodyHas('Scanning Claude Code data…'),
      'The older run came back as scanning after a newer one finished.'
    )
  }
)

export const ScanAccessBanner = app(reported(needsAccess(true)), (user) =>
  user.until(
    { role: 'button', name: 'Scan details', exact: true },
    'A startup scan that needs folder access showed no banner.'
  )
)

export const ScanAccessDetails = app(reported(needsAccess(true)), async (user) => {
  await openScanDetails(user)
  await user.until(
    { role: 'button', name: 'Manage folder access', exact: true },
    'Scan details did not offer folder access.'
  )
})

// Behaviour: the details link closes Settings and opens the folder list, here still empty.
export const ManageFolderAccess = app(reported(needsAccess(true)), async (user) => {
  await openScanDetails(user)
  await user.click({ role: 'button', name: 'Manage folder access', exact: true })
  await user.until(
    { text: 'No project folders granted', exact: true },
    'Manage folder access did not open the folder list.'
  )
  await user.until(
    () => document.querySelectorAll('[role="dialog"]').length === 1,
    'Settings stayed open under the folder list.'
  )
})

export const MissingProjectAndReadFailure = app(
  reported(
    partial(true, minutesAgo(10), [
      pluginIssue('project_missing', OLD_PROJECT),
      {
        name: 'scanSkills',
        status: 'partial',
        issues: [{ code: 'source_unavailable', path: 'C:\\Projects\\Private\\.claude\\skills' }]
      }
    ])
  ),
  async (user) => {
    await openScanDetails(user)
    await user.until(
      { text: 'Scan needs attention', exact: true },
      'A read failure beside a missing project was not called out.'
    )
    await user.until(
      { text: 'The source could not be read. Check file access and try rescanning.' },
      'The read failure showed no reason.'
    )
  }
)

// Settings opens over whichever section is showing; here the plugin inventory.
export const OpenOverPlugins = app(
  { getInitialSection: () => 'plugins', ...pluginReads() },
  async (user) => {
    await user.until(
      { role: 'row', name: /ops-kit/ },
      'The plugin inventory never listed its plugins.'
    )
    await openSettings(user)
    await user.until({ role: 'radio', name: 'System' }, 'Settings did not open over Plugins.')
  }
)

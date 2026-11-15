import type { ScanSummary, UpdateState } from '../../../shared/ipc'
import { daysAgo } from '@/fixtures/data'
import { fixture, type Fixture } from '@/fixtures/define'
import { SettingsDialog } from './SettingsDialog'

const ignore = (): void => {}

function settings(state: Partial<UpdateState>, platform: 'darwin' | 'win32' = 'darwin'): Fixture {
  const updateState: UpdateState = {
    status: 'idle',
    version: '1.1.0',
    detail: null,
    autoCheck: true,
    ...state
  }
  let installRequests = 0

  return fixture({
    frame: 'window',
    platform,
    api: {
      installUpdate: async () => {
        installRequests += 1
      }
    },
    render: () => (
      <SettingsDialog
        open
        onOpenChange={ignore}
        themePreference={window.api.getInitialTheme()}
        onThemeChange={ignore}
        version="1.0.0"
        scanning={false}
        onManageFolders={ignore}
        onShowWelcome={ignore}
        updateState={updateState}
      />
    ),
    interact: async (user) => {
      await user.until({ role: 'dialog', name: 'Settings' }, 'Settings did not open.')
      if (updateState.status === 'ready') {
        await user.click({ role: 'button', name: 'Restart to update', exact: true })
        await user.until(
          () => installRequests === 1,
          'Restart to update did not request installation exactly once.'
        )
      } else if (updateState.status === 'manual') {
        await user.until(
          { text: /To update, quit Megatron and run this in Terminal/ },
          'The manual update showed no installation instructions.'
        )
      }
    }
  })
}

export const MacReady = settings({ status: 'ready' })
export const WindowsReady = settings({ status: 'ready' }, 'win32')
export const Downloading = settings({ status: 'downloading' })
export const ManualUpdate = settings({
  status: 'manual',
  detail: 'The app is on a read-only volume.'
})
export const PreviousUpdateFailed = settings({
  status: 'manual',
  version: null,
  detail: 'The previous update could not replace the app. The original app was restored.'
})

const LINK_SCAN: ScanSummary = {
  outcome: 'partial',
  completedAt: daysAgo(0),
  sources: [
    {
      name: 'scanSkills',
      status: 'partial',
      issues: [
        {
          code: 'link_unapproved',
          path: '/Users/fixture/Projects/megatron/.claude/skills/shared-review',
          target: '/Users/fixture/team-skills/shared-review'
        }
      ]
    }
  ]
}

// Behaviour: a project skill linked outside its repo names the target and offers folder access.
export const ScanLinkNeedsAccess = fixture({
  frame: 'window',
  render: () => (
    <SettingsDialog
      open
      onOpenChange={ignore}
      themePreference={window.api.getInitialTheme()}
      onThemeChange={ignore}
      version="1.0.0"
      scanSummary={LINK_SCAN}
      scanning={false}
      onManageFolders={ignore}
      onShowWelcome={ignore}
    />
  ),
  interact: async (user) => {
    await user.until({ role: 'dialog', name: 'Settings' }, 'Settings did not open.')
    await user.until(
      { text: '→ /Users/fixture/team-skills/shared-review' },
      'The unapproved link did not name the folder it points to.'
    )
    await user.until(
      { role: 'button', name: 'Manage folder access' },
      'An unapproved link offered no way to manage folder access.'
    )
  }
})

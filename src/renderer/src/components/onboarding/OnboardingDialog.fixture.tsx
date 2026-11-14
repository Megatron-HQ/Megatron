// The first step through App, which opens onboarding on first launch over the inventory; the
// later steps on the dialog alone, on the data App would pass it.
import App from '@/App'
import { baseSkills } from '@/fixtures/data'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { onboardingOverview, usageProjects } from '@/fixtures/usage-data'
import { OnboardingDialog } from './OnboardingDialog'

async function onStep(user: FixtureUser, step: number): Promise<void> {
  await user.until(
    { selector: `[aria-current="step"][aria-label="Step ${step} of 3"]` },
    `Onboarding did not reach step ${step}.`
  )
}

async function next(user: FixtureUser, times: number): Promise<void> {
  for (let step = 1; step <= times; step += 1) {
    await user.click({ role: 'button', name: 'Next', exact: true })
    await onStep(user, step + 1)
  }
}

export const Brief = fixture({
  frame: 'window',
  api: { getInitialOnboarding: () => true },
  render: () => <App />,
  interact: async (user) => {
    await user.until(
      { role: 'dialog', name: 'Welcome to Megatron' },
      'First launch did not open onboarding.'
    )
    await onStep(user, 1)
  }
})

// Claude Code's folder is named the way Windows writes it.
export const BriefWindows: Fixture = { ...Brief, platform: 'win32' }

function step(interact: Fixture['interact']): Fixture {
  return fixture({
    frame: 'window',
    api: {
      getUsageOverview: async () => onboardingOverview,
      getUsageProjects: async () => usageProjects
    },
    render: () => (
      <OnboardingDialog
        open
        onFinish={() => {}}
        skills={baseSkills}
        plugins={[]}
        folders={[]}
        scanComplete
        home={window.api.getHomePath()}
        onAddFolders={async () => []}
      />
    ),
    interact
  })
}

export const Overview = step(async (user) => {
  await next(user, 1)
  await user.until({ text: 'prompts in 30 days' }, 'The Usage card showed no prompt count.')
})

// Nothing is granted yet, and at the minimum window size only the folder list scrolls.
export const Folders = step(async (user) => {
  await next(user, 2)
  await user.until(
    { role: 'list', name: 'Folders Claude Code has used' },
    'The folder step listed no folders.'
  )
})

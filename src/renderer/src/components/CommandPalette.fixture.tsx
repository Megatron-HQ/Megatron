import App from '@/App'
import { baseSkills, skillMeta } from '@/fixtures/data'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { basePlugins } from '@/fixtures/plugin-data'
import { CommandPalette } from './CommandPalette'

const ignore = (): void => {}
const SEARCH = { selector: '[cmdk-input]' }

function palette(interact: Fixture['interact']): Fixture {
  return fixture({
    frame: 'window',
    render: () => (
      <CommandPalette
        open
        onOpenChange={ignore}
        skills={baseSkills}
        onSelect={ignore}
        plugins={[]}
        onSelectPlugin={ignore}
      />
    ),
    interact
  })
}

function app(interact: Fixture['interact']): Fixture {
  return fixture({
    frame: 'window',
    api: { openSkillMeta: async (id) => skillMeta(id) },
    render: () => <App />,
    interact
  })
}

const opened = (user: FixtureUser, how: string): Promise<void> =>
  user.until(SEARCH, `${how} did not open the command palette.`)

const selectedText = (): string =>
  document.querySelector('[cmdk-item][data-selected="true"]')?.textContent ?? ''

// The skill tile's tightest contrast is on the selected row in dark (DESIGN.md, Validation).
export const SkillSelected = palette(async (user) => {
  await opened(user, 'Rendering it open')
  await user.press('End')
  await user.until(
    () => selectedText().startsWith('changelog'),
    'End did not select the last skill.'
  )
})

// A disabled skill gets a neutral tile, labelled in words so color never carries it alone.
export const DisabledSkill = palette(async (user) => {
  await opened(user, 'Rendering it open')
  await user.type('legacy-lint')
  await user.until({ role: 'option', name: /legacy-lint.*Disabled/ }, 'No disabled row showed.')
})

export const OpenWithShortcut = app(async (user) => {
  await user.until({ role: 'row', name: /code-review/ }, 'The inventory never listed its skills.')
  await user.press('Meta+k')
  await opened(user, '⌘K')
})

export const OpenFromHeaderButton = app(async (user) => {
  await user.click({ role: 'button', name: /Search skills/ })
  await opened(user, 'The header button')
})

// Behaviour: a skill picked while Plugins is showing switches back to Skills and opens it.
export const SkillFromPluginsSection = app(async (user) => {
  await user.click({ role: 'button', name: 'Plugins', exact: true })
  await user.until({ role: 'button', name: 'All Plugins' }, 'The Plugins section never opened.')
  await user.press('Meta+k')
  await opened(user, '⌘K')
  await user.type('code-review')
  await user.click({ role: 'option', name: /^code-review/ })
  await user.until(
    { role: 'button', name: 'Back to skills' },
    'Picking a skill from the Plugins section did not open its detail page.'
  )
})

// Plugins are their own group above skills, found by name or marketplace.
export const PluginSearch = fixture({
  frame: 'window',
  render: () => (
    <CommandPalette
      open
      onOpenChange={ignore}
      skills={baseSkills}
      onSelect={ignore}
      plugins={basePlugins}
      onSelectPlugin={ignore}
    />
  ),
  interact: async (user) => {
    await opened(user, 'Rendering it open')
    await user.type('review-kit')
    await user.until({ role: 'option', name: /^review-kit/ }, 'Searching found no plugin.')
  }
})

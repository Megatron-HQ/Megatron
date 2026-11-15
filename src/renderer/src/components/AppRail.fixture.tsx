import { useState } from 'react'
import type { AppSection } from '../../../shared/ipc'
import { fixture, type Fixture, type FixtureUser } from '@/fixtures/define'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppRail } from './AppRail'

const ignore = (): void => {}

function rail(section: AppSection, updateNotice?: string): Fixture {
  return fixture({
    frame: 'window',
    render: () => (
      <TooltipProvider>
        <div className="frame-surface flex h-screen">
          <AppRail
            section={section}
            onSectionChange={ignore}
            onOpenSettings={ignore}
            updateNotice={updateNotice}
          />
        </div>
      </TooltipProvider>
    )
  })
}

export const Skills = rail('skills')
export const Plugins = rail('plugins')
export const Usage = rail('usage')

function tooltip(label: string, updateNotice?: string): Fixture {
  return {
    ...rail('skills', updateNotice),
    interact: async (user: FixtureUser): Promise<void> => {
      await user.hover({ role: 'button', name: label, exact: true })
      await user.until(
        { role: 'tooltip', name: label, exact: true },
        `The ${label} rail button showed no tooltip.`
      )
    }
  }
}

export const SkillsTooltip = tooltip('Skills')
export const PluginsTooltip = tooltip('Plugins')
export const UsageTooltip = tooltip('Usage')
export const SettingsTooltip = tooltip('Settings')
export const UpdateAvailable = tooltip('Settings · Update available', 'Update available')
export const UpdateReady = tooltip('Settings · Update ready', 'Update ready')

export const KeyboardFocus = {
  ...rail('skills'),
  interact: async (user: FixtureUser): Promise<void> => {
    for (const label of ['Skills', 'Plugins', 'Usage', 'Settings']) {
      await user.press('Tab')
      await user.until(
        () => document.activeElement?.getAttribute('aria-label') === label,
        `Tab did not focus the ${label} rail button.`
      )
    }
  }
}

// Holds the section the way App does, so a click moves the active pill before the hover.
function StatefulRail(): React.JSX.Element {
  const [section, setSection] = useState<AppSection>('skills')
  return (
    <TooltipProvider>
      <div className="frame-surface flex h-screen">
        <AppRail section={section} onSectionChange={setSection} onOpenSettings={ignore} />
      </div>
    </TooltipProvider>
  )
}

export const SectionHover = fixture({
  frame: 'window',
  render: () => <StatefulRail />,
  interact: async (user) => {
    await user.click({ role: 'button', name: 'Plugins', exact: true })
    await user.hover({ role: 'button', name: 'Usage', exact: true })
    await user.until(
      { role: 'tooltip', name: 'Usage', exact: true },
      'Hovering a section showed no tooltip.'
    )
  }
})

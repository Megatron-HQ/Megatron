import { useState } from 'react'
import { fixture } from '@/fixtures/define'
import type { AppSection } from '../../../shared/ipc'
import { AppRail } from './AppRail'

function Rail(): React.JSX.Element {
  const [section, setSection] = useState<AppSection>('skills')
  return (
    // The shell's own wrapper, so the rail gets the frame's height and surface.
    <div className="frame-surface flex h-screen">
      <AppRail section={section} onSectionChange={setSection} onOpenSettings={() => {}} />
    </div>
  )
}

// The rail sits beside both slots, so it fills the window on its own.
export const SectionHover = fixture({
  frame: 'window',
  render: () => <Rail />,
  interact: async (user) => {
    await user.click({ role: 'button', name: 'Plugins' })
    await user.hover({ role: 'button', name: 'Usage' })
    await user.until({ role: 'tooltip', name: 'Usage' }, 'Hovering a section showed no tooltip.')
  }
})

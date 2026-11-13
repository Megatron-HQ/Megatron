import { useState } from 'react'
import { fixture, sheet } from '@/fixtures/define'
import { ScreenTransition } from './ScreenTransition'

function Screens(): React.JSX.Element {
  const [depth, setDepth] = useState(0)
  return (
    <ScreenTransition
      screenKey={`screen-${depth}`}
      section="skills"
      depth={depth}
      className="flex flex-1 items-center justify-center"
    >
      <button type="button" onClick={() => setDepth(depth + 1)}>
        Screen {depth}
      </button>
    </ScreenTransition>
  )
}

// Enter-only: the new screen replaces the old one in the same commit, with no leaving copy.
export const Replaces = fixture({
  frame: sheet('skills'),
  render: () => <Screens />,
  interact: async (user) => {
    await user.click({ role: 'button', name: 'Screen 0' })
    await user.until(
      () =>
        document.querySelectorAll('[data-fixture-frame] [data-screen]').length === 1 &&
        document.querySelector('[data-fixture-frame] [data-screen]')?.textContent === 'Screen 1',
      'The old screen stayed mounted beside the new one.'
    )
  }
})

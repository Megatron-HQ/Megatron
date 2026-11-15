import { useState } from 'react'
import { fixture } from '@/fixtures/define'
import { anchorProps } from '@/lib/whats-new'
import { SpotlightRing } from './SpotlightRing'

const RING = '[data-whats-new-ring="usage-skill-cost"]'

function Target({ present }: { present: boolean }): React.JSX.Element {
  const [done, setDone] = useState(false)
  return (
    <div className="flex h-screen flex-col items-start gap-4 bg-background p-10">
      {present && (
        <button
          type="button"
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          {...anchorProps('usage-skill-cost')}
        >
          Estimated cost attribution
        </button>
      )}
      <p className="text-sm text-muted-foreground">
        {done ? 'Spotlight done' : 'Spotlight running'}
      </p>
      {!done && <SpotlightRing anchor="usage-skill-cost" onDone={() => setDone(true)} />}
    </div>
  )
}

// The ring draws around the anchor as an overlay, leaving the anchor's own classes alone.
export const RingsAnchor = fixture({
  frame: 'window',
  render: () => <Target present />,
  interact: async (user) => {
    await user.until({ selector: RING }, 'No ring appeared around the anchor.')
    await user.until(() => {
      const ring = document.querySelector(RING)?.getBoundingClientRect()
      const anchor = document.querySelector('[data-whats-new]')?.getBoundingClientRect()
      return !!ring && !!anchor && ring.left < anchor.left && ring.right > anchor.right
    }, 'The ring did not surround the anchor.')
  }
})

// A user whose data never renders the anchor: no ring, and the spotlight still ends.
export const MissingAnchorEnds = fixture({
  frame: 'window',
  render: () => <Target present={false} />,
  interact: async (user) => {
    await user.until({ text: 'Spotlight done' }, 'A missing anchor left the spotlight running.')
    await user.until(
      () => document.querySelector(RING) === null,
      'A ring was drawn with no anchor to surround.'
    )
  }
})

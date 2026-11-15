import type { WhatsNewAnchorId } from '../../../../shared/whats-new'
import { useWhatsNewDot } from '@/lib/whats-new'

// Sits inline after a new control's label until the user first interacts with that control. It
// takes normal layout space only while shown, and never restyles the control it marks.
export function WhatsNewDot({ anchor }: { anchor: WhatsNewAnchorId }): React.JSX.Element | null {
  if (!useWhatsNewDot(anchor)) return null
  return (
    <>
      <span
        aria-hidden
        data-whats-new-dot={anchor}
        className="ml-1.5 inline-block size-1.5 rounded-full bg-ring align-middle"
      />
      <span className="sr-only"> (new)</span>
    </>
  )
}

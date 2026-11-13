import { daysAgo } from '@/fixtures/data'
import { fixture, sheet, type Fixture } from '@/fixtures/define'
import type { ScanSummary } from '../../../shared/ipc'
import { ScanStatusBanner } from './ScanStatus'

// The warning banner at the top of the sheet, which App only shows once a scan has finished badly.
function banner(outcome: ScanSummary['outcome']): Fixture {
  const summary: ScanSummary = {
    outcome,
    completedAt: daysAgo(0),
    sources: [{ name: 'scanTranscripts', status: outcome }]
  }
  return fixture({
    frame: sheet('skills'),
    render: () => (
      <div className="flex flex-1 flex-col">
        <ScanStatusBanner summary={summary} onOpenDetails={() => {}} />
      </div>
    )
  })
}

export const Failed = banner('failed')
export const Partial = banner('partial')

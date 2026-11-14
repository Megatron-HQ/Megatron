import { useState } from 'react'
import { fixture, sidebar } from '@/fixtures/define'
import { UsageSidebar, type UsagePanel } from './UsageSidebar'

function HistorySidebar(): React.JSX.Element {
  const [panel, setPanel] = useState<UsagePanel>('history')
  return <UsageSidebar panel={panel} onPanelChange={setPanel} />
}

export const History = fixture({ frame: sidebar('usage'), render: () => <HistorySidebar /> })

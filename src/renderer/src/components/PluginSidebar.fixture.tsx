import { useState } from 'react'
import { projectTree } from '@/fixtures/data'
import { fixture, sidebar } from '@/fixtures/define'
import type { PluginFilter } from '@/lib/plugin-filter'
import { PluginSidebar } from './PluginSidebar'

function PluginsSidebar(): React.JSX.Element {
  const [filter, setFilter] = useState<PluginFilter>({ kind: 'all' })
  const [expanded, setExpanded] = useState(new Set<string>())
  const data = projectTree()
  return (
    <PluginSidebar
      plugins={[]}
      filter={filter}
      onFilterChange={setFilter}
      onFilterSnap={setFilter}
      folders={data.folders}
      projectCatalog={data.projects}
      home="/Users/fixture"
      expandedProjects={expanded}
      setExpandedProjects={setExpanded}
    />
  )
}

export const Navigation = fixture({ frame: sidebar('plugins'), render: () => <PluginsSidebar /> })

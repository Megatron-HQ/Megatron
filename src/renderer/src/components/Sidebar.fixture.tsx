import { useState } from 'react'
import { projectTree } from '@/fixtures/data'
import { fixture, sidebar } from '@/fixtures/define'
import type { SourceFilter } from '@/lib/source-filter'
import { Sidebar } from './Sidebar'

const ignore = (): void => {}

function SkillsSidebar(): React.JSX.Element {
  const [filter, setFilter] = useState<SourceFilter>({ kind: 'all' })
  const [expanded, setExpanded] = useState(new Set<string>())
  const data = projectTree()
  return (
    <Sidebar
      filter={filter}
      onFilterChange={setFilter}
      onFilterSnap={setFilter}
      contextBudget={data.skills.contextBudget}
      onSelectSkill={ignore}
      skills={data.skills.skills}
      folders={data.folders}
      projectCatalog={data.projects}
      home="/Users/fixture"
      expandedProjects={expanded}
      setExpandedProjects={setExpanded}
    />
  )
}

export const Navigation = fixture({ frame: sidebar('skills'), render: () => <SkillsSidebar /> })

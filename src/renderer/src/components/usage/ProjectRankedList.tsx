import { useState, type ComponentProps } from 'react'
import { useUsageProjects } from '@/lib/use-usage-projects'
import { ProjectSearch, VISIBLE_PROJECT_COUNT } from './ProjectSearch'
import { RankedList } from './RankedList'
import { matchesUsageProjectSearch } from '../../../../shared/usage-projects'

export function ProjectRankedList({
  items,
  ...props
}: ComponentProps<typeof RankedList>): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const { projectTooltip } = useUsageProjects()
  const needle = search.trim().toLowerCase()
  const presented = items.map((item) => ({ ...item, fullLabel: projectTooltip(item.fullLabel) }))
  const matches = presented.filter((item) =>
    matchesUsageProjectSearch(needle, [item.label, ...item.fullLabel.split('\n')])
  )
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ProjectSearch
          value={search}
          onChange={setSearch}
          total={items.length}
          visible={
            needle || expanded ? matches.length : Math.min(VISIBLE_PROJECT_COUNT, matches.length)
          }
        />
      )}
      {matches.length === 0 ? (
        <p className="py-4 text-[12px] text-muted-foreground">
          {items.length === 0
            ? 'No project activity recorded in this period.'
            : 'No matching projects.'}
        </p>
      ) : (
        <RankedList
          {...props}
          items={matches}
          totalValue={items.reduce((sum, item) => sum + item.value, 0)}
          expanded={Boolean(needle) || expanded}
          onExpandedChange={setExpanded}
          hideDisclosure={Boolean(needle)}
        />
      )}
    </div>
  )
}

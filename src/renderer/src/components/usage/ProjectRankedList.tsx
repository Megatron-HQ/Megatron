import { useState, type ComponentProps } from 'react'
import { useUsageProjects } from '@/lib/use-usage-projects'
import { CLAUDE_APP_CHATS_LABEL, splitClaudeAppChats } from '@/lib/claude-app-chats'
import { ProjectSearch, VISIBLE_PROJECT_COUNT } from './ProjectSearch'
import { RankedList, type RankedItem } from './RankedList'
import { matchesUsageProjectSearch } from '../../../../shared/usage-projects'

export function ProjectRankedList({
  items,
  ...props
}: ComponentProps<typeof RankedList>): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)
  const { projectTooltip } = useUsageProjects()
  const needle = search.trim().toLowerCase()
  const folded = splitClaudeAppChats(items, (item) => item.fullLabel)
  const chatsValue = folded.chats.reduce((sum, item) => sum + item.value, 0)
  const matchesNeedle = (item: RankedItem): boolean =>
    matchesUsageProjectSearch(needle, [item.label, ...item.fullLabel.split('\n')])
  const matches: RankedItem[] = folded.rows
    .map((item) => ({ ...item, project: true, fullLabel: projectTooltip(item.fullLabel) }))
    .filter(matchesNeedle)
  // Chat titles are free text that may hold a `/`, so they render plain, not as project names.
  const chats = folded.chats.map((item) => ({
    ...item,
    id: item.fullLabel,
    fullLabel: projectTooltip(item.fullLabel)
  }))
  const groupMatches = matchesUsageProjectSearch(needle, [CLAUDE_APP_CHATS_LABEL])
  const matchingChats = groupMatches ? chats : chats.filter(matchesNeedle)
  if (matchingChats.length > 0) {
    const count = folded.chats.filter((item) => item.value > 0).length
    const rank = matches.findIndex((item) => item.value < chatsValue)
    matches.splice(rank < 0 ? matches.length : rank, 0, {
      id: CLAUDE_APP_CHATS_LABEL,
      label: `${CLAUDE_APP_CHATS_LABEL} (${count})`,
      value: chatsValue,
      fullLabel: `${count} chat${count === 1 ? '' : 's'} started in the Claude app without a project folder`,
      children: matchingChats,
      childNoun: 'chats',
      open: chatsOpen || (needle !== '' && !groupMatches),
      onToggle: () => setChatsOpen((open) => !open)
    })
  }
  const total = folded.rows.length + (folded.chats.length > 0 ? 1 : 0)
  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 && (
        <ProjectSearch
          value={search}
          onChange={setSearch}
          total={total}
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

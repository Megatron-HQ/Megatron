import { useState } from 'react'
import { projectTree, type ProjectTreeMode } from '@/fixtures/data'
import { fixture, sidebar, type Fixture } from '@/fixtures/define'
import type { SourceFilter } from '@/lib/source-filter'
import { Sidebar } from './Sidebar'

// Holds the filter and the expanded rows the way App does, so clicks change what they change in
// the app.
function SkillsSidebar({ mode }: { mode: ProjectTreeMode }): React.JSX.Element {
  const [tree] = useState(() => projectTree(mode))
  const [filter, setFilter] = useState<SourceFilter>({ kind: 'all' })
  const [expanded, setExpanded] = useState(() => new Set(['$projects']))
  return (
    <Sidebar
      filter={filter}
      onFilterChange={setFilter}
      onFilterSnap={setFilter}
      contextBudget={tree.skills.contextBudget}
      onSelectSkill={() => {}}
      skills={tree.skills.skills}
      folders={tree.folders}
      projectCatalog={tree.projects}
      home="/Users/fixture"
      expandedProjects={expanded}
      setExpandedProjects={setExpanded}
    />
  )
}

function skillsSidebar(
  interact: Fixture['interact'],
  mode: ProjectTreeMode = 'available'
): Fixture {
  return fixture({
    frame: sidebar('skills'),
    render: () => <SkillsSidebar mode={mode} />,
    interact
  })
}

const listOpen = (): boolean =>
  document.querySelector('[aria-label="Collapse project list"]') !== null

function rowSelected(label: string): boolean {
  return [...document.querySelectorAll('nav .bg-accent-lime')].some(
    (row) => row.textContent?.trim().startsWith(label) ?? false
  )
}

// The hover pill that glides between rows.
export const NavHover = skillsSidebar(async (user) => {
  await user.hover({ role: 'button', name: 'Global', exact: true })
  await user.until({ selector: 'nav > div.bg-accent' }, 'Hovering a row showed no highlight.')
})

export const ProjectsExpanded = skillsSidebar(async (user) => {
  await user.click({ role: 'button', name: 'Projects', exact: true })
  await user.until(
    () => rowSelected('Projects') && listOpen(),
    'Clicking Projects did not select it with its list open.'
  )
})

export const PluginsExpanded = skillsSidebar(async (user) => {
  await user.click({ role: 'button', name: 'Plugin', exact: true })
  await user.until(
    { role: 'button', name: /^ops-kit\s*3$/ },
    'Clicking Plugin did not open the plugin list.'
  )
})

// The chevron is its own hit target: it opens the list and leaves the filter where it was.
export const ProjectsExpandedViaChevron = skillsSidebar(async (user) => {
  await user.click({ role: 'button', name: 'Global', exact: true })
  await user.click({ role: 'button', name: 'Collapse project list' })
  await user.click({ role: 'button', name: 'Expand project list' })
  await user.until(
    () => rowSelected('Global') && listOpen(),
    'Opening the project list with its chevron changed the filter or left the list closed.'
  )
})

export const GroupedGrants = skillsSidebar(
  (user) =>
    user.until(
      { role: 'button', name: /^Megatron-site\s*3$/ },
      'Sibling grants were not grouped under their parent.'
    ),
  'grouped'
)

// Repositories with no skills fold behind one row, so they do not bury the ones that have some.
export const FoldedEmptyRepositories = skillsSidebar(async (user) => {
  await user.click({ role: 'button', name: /^Megatron HQ\s*6$/ })
  await user.until(
    { role: 'button', name: '1 without skills', exact: true },
    'The repository without skills was not folded.'
  )
})

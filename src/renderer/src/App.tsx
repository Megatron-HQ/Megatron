import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CommandPalette } from '@/components/CommandPalette'
import { Sidebar } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TREE_WIDTH_DEFAULT } from '@/lib/file-tree'
import type { SourceFilter } from '@/lib/source-filter'
import { SkillInventory } from './views/SkillInventory'
import { SkillFileViewer } from './views/SkillFileViewer'
import type { Theme } from '../../shared/ipc'

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT)

  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: () => window.api.listSkills()
  })

  useEffect(
    () => window.api.onScanComplete(() => queryClient.invalidateQueries({ queryKey: ['skills'] })),
    [queryClient]
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const skills = useMemo(() => data?.skills ?? [], [data])
  const scanComplete = data?.scanComplete ?? false

  const filteredSkills = useMemo(
    () => (filter === 'all' ? skills : skills.filter((skill) => skill.source_type === filter)),
    [skills, filter]
  )

  function handleFilterChange(next: SourceFilter): void {
    setSelectedId(null)
    setFilter(next)
  }

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    void window.api.setTheme(next)
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <div className="relative h-8 shrink-0 drag-region">
          <div className="drag-region absolute inset-x-1.5 top-1.5 bottom-0 rounded-xl bg-muted shadow" />
        </div>
        <div className="flex min-h-0 flex-1">
          <Sidebar
            filter={filter}
            onFilterChange={handleFilterChange}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          {selectedId !== null ? (
            <SkillFileViewer
              key={selectedId}
              skillId={selectedId}
              treeWidth={treeWidth}
              onTreeWidthChange={setTreeWidth}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <SkillInventory
              skills={filteredSkills}
              loading={!skills.length && !scanComplete}
              filter={filter}
              onSelect={setSelectedId}
              onOpenSearch={() => setPaletteOpen(true)}
            />
          )}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        skills={skills}
        onSelect={setSelectedId}
      />
    </TooltipProvider>
  )
}

export default App

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CommandPalette } from '@/components/CommandPalette'
import { Sidebar, type SourceFilter } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SkillInventory } from './views/SkillInventory'
import { SkillDetail } from './views/SkillDetail'
import type { Theme } from '../../shared/ipc'

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

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

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [skills, selectedId]
  )

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    void window.api.setTheme(next)
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen">
        <Sidebar
          filter={filter}
          onFilterChange={setFilter}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <SkillInventory
          skills={filteredSkills}
          loading={!skills.length && !scanComplete}
          filter={filter}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <SkillDetail skill={selectedSkill} onClose={() => setSelectedId(null)} />
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

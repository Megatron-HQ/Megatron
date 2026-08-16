import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CommandPalette } from '@/components/CommandPalette'
import { ManageFoldersDialog } from '@/components/ManageFoldersDialog'
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
  const [foldersDialogOpen, setFoldersDialogOpen] = useState(false)
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT)

  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: () => window.api.listSkills()
  })

  const { data: foldersData } = useQuery({
    queryKey: ['folders'],
    queryFn: () => window.api.listAllowedPaths()
  })

  useEffect(
    () =>
      window.api.onScanComplete(() => {
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
        void queryClient.invalidateQueries({ queryKey: ['folders'] })
      }),
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
  const folders = useMemo(() => foldersData ?? [], [foldersData])
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

  async function handleAddFolders(): Promise<void> {
    await window.api.pickAndAddFolders()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['skills'] }),
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    ])
  }

  async function handleRevokeFolder(path: string): Promise<void> {
    await window.api.revokeAllowedPath(path)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['skills'] }),
      queryClient.invalidateQueries({ queryKey: ['folders'] })
    ])
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        {window.electron?.process?.platform === 'darwin' && (
          <div className="relative h-8 shrink-0 drag-region">
            <div className="drag-region absolute inset-x-1.5 top-1.5 bottom-0 rounded-xl bg-muted shadow" />
          </div>
        )}
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
              onManageFolders={() => setFoldersDialogOpen(true)}
              onGrantFolder={handleAddFolders}
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
      <ManageFoldersDialog
        open={foldersDialogOpen}
        onOpenChange={setFoldersDialogOpen}
        folders={folders}
        onAddFolders={handleAddFolders}
        onRevokeFolder={handleRevokeFolder}
      />
    </TooltipProvider>
  )
}

export default App

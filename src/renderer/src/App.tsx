import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CommandPalette } from '@/components/CommandPalette'
import { ManageFoldersDialog } from '@/components/ManageFoldersDialog'
import { Sidebar } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TREE_WIDTH_DEFAULT } from '@/lib/file-tree'
import type { SourceFilter } from '@/lib/source-filter'
import { SkillDetail } from './views/SkillDetail'
import { SkillInventory } from './views/SkillInventory'
import { SkillFileViewer } from './views/SkillFileViewer'
import type { ContextBudget, Theme } from '../../shared/ipc'

type View =
  { kind: 'list' } | { kind: 'detail'; skillId: number } | { kind: 'files'; skillId: number }

// Real value always arrives from the listSkills IPC round-trip almost immediately; this only
// covers the brief pre-response instant, so it deliberately doesn't guess at the real limit
// (that constant is derived in src/main/db/queries.ts from the binary-sourced formula).
const DEFAULT_CONTEXT_BUDGET: ContextBudget = { used: 0, limit: 0 }

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [view, setView] = useState<View>({ kind: 'list' })
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
  const contextBudget = data?.contextBudget ?? DEFAULT_CONTEXT_BUDGET

  const filteredSkills = useMemo(
    () => (filter === 'all' ? skills : skills.filter((skill) => skill.source_type === filter)),
    [skills, filter]
  )

  function handleFilterChange(next: SourceFilter): void {
    setView({ kind: 'list' })
    setFilter(next)
  }

  function openDetail(skillId: number): void {
    setView({ kind: 'detail', skillId })
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
            contextBudget={contextBudget}
          />
          {view.kind === 'detail' ? (
            <SkillDetail
              key={view.skillId}
              skillId={view.skillId}
              onBack={() => setView({ kind: 'list' })}
              onViewFiles={() => setView({ kind: 'files', skillId: view.skillId })}
              onNavigate={openDetail}
            />
          ) : view.kind === 'files' ? (
            <SkillFileViewer
              key={view.skillId}
              skillId={view.skillId}
              treeWidth={treeWidth}
              onTreeWidthChange={setTreeWidth}
              onBack={() => setView({ kind: 'detail', skillId: view.skillId })}
            />
          ) : (
            <SkillInventory
              skills={filteredSkills}
              loading={!skills.length && !scanComplete}
              filter={filter}
              onSelect={openDetail}
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
        onSelect={openDetail}
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

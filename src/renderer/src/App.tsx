import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppRail } from '@/components/AppRail'
import { CommandPalette } from '@/components/CommandPalette'
import { ManageFoldersDialog } from '@/components/ManageFoldersDialog'
import { PluginActionToasts, type PluginActionToast } from '@/components/PluginActionToasts'
import { Sidebar } from '@/components/Sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TREE_WIDTH_DEFAULT } from '@/lib/file-tree'
import { matchesFilter, type SourceFilter } from '@/lib/source-filter'
import { SkillDetail } from './views/SkillDetail'
import { SkillInventory } from './views/SkillInventory'
import { SkillFileViewer } from './views/SkillFileViewer'
import { PluginDetail } from './views/PluginDetail'
import { PluginInventory } from './views/PluginInventory'
import type { AppSection, ContextBudget, ThemePreference } from '../../shared/ipc'

type View =
  { kind: 'list' } | { kind: 'detail'; skillId: number } | { kind: 'files'; skillId: number }

type PluginView = { kind: 'list' } | { kind: 'detail'; name: string; marketplace: string }

// Real value always arrives from the listSkills IPC round-trip almost immediately; this only
// covers the brief pre-response instant, so it deliberately doesn't guess at the real limit
// (that constant is derived in src/main/db/queries.ts from the binary-sourced formula).
const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  used: 0,
  limit: 0,
  excludedTokens: 0,
  excludedCount: 0
}
const SUCCESS_TOAST_DURATION_MS = 3_000
const MAX_SUCCESS_TOASTS = 3

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    window.api.getInitialTheme()
  )
  const [filter, setFilter] = useState<SourceFilter>({ kind: 'all' })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [section, setSection] = useState<AppSection>(() => window.api.getInitialSection())
  const [pluginView, setPluginView] = useState<PluginView>({ kind: 'list' })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [foldersDialogOpen, setFoldersDialogOpen] = useState(false)
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT)
  const [pluginActionToasts, setPluginActionToasts] = useState<PluginActionToast[]>([])
  const nextToastId = useRef(0)

  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: () => window.api.listSkills(),
    refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
  })

  const { data: foldersData } = useQuery({
    queryKey: ['folders'],
    queryFn: () => window.api.listAllowedPaths()
  })

  const { data: pluginsData, isPending: pluginsPending } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => window.api.listPlugins()
  })

  useEffect(
    () =>
      window.api.onScanComplete(() => {
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
        void queryClient.invalidateQueries({ queryKey: ['folders'] })
        void queryClient.invalidateQueries({ queryKey: ['skill-meta'] })
        void queryClient.invalidateQueries({ queryKey: ['skill-files'] })
        void queryClient.invalidateQueries({ queryKey: ['plugins'] })
        void queryClient.invalidateQueries({ queryKey: ['plugin-detail'] })
      }),
    [queryClient]
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // `!event.repeat` — a held Cmd+K otherwise toggles the palette on every
      // key-repeat, landing it open or closed at random depending on parity.
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.repeat) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (): void => {
      const useDarkTheme =
        themePreference === 'dark' || (themePreference === 'system' && mediaQuery.matches)
      document.documentElement.classList.toggle('dark', useDarkTheme)
    }

    applyTheme()
    mediaQuery.addEventListener('change', applyTheme)
    return () => mediaQuery.removeEventListener('change', applyTheme)
  }, [themePreference])

  const skills = useMemo(() => data?.skills ?? [], [data])
  const folders = useMemo(() => foldersData ?? [], [foldersData])
  const plugins = useMemo(() => pluginsData ?? [], [pluginsData])
  const scanComplete = data?.scanComplete ?? false
  const contextBudget = data?.contextBudget ?? DEFAULT_CONTEXT_BUDGET

  const filteredSkills = useMemo(
    () => skills.filter((skill) => matchesFilter(skill, filter)),
    [skills, filter]
  )

  function handleFilterChange(next: SourceFilter): void {
    setView({ kind: 'list' })
    setFilter(next)
  }

  function openDetail(skillId: number): void {
    // Opening a skill detail always means "show me the Skills section" — without
    // this, selecting a skill from the command palette while on the Plugins tab
    // sets the view but leaves the Plugins branch rendered, so nothing happens.
    handleSectionChange('skills')
    setView({ kind: 'detail', skillId })
  }

  function handleSectionChange(next: AppSection): void {
    setSection(next)
    void window.api.setLastSection(next)
  }

  function openPluginDetail(name: string, marketplace: string): void {
    setPluginView({ kind: 'detail', name, marketplace })
  }

  function selectPluginFromPalette(name: string, marketplace: string): void {
    handleSectionChange('plugins')
    openPluginDetail(name, marketplace)
  }

  function handleViewSkillsForPlugin(pluginName: string): void {
    handleSectionChange('skills')
    setFilter({ kind: 'plugin', pluginName })
    setView({ kind: 'list' })
  }

  function handleThemeChange(next: ThemePreference): void {
    setThemePreference(next)
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

  function showPluginActionToast(message: string): void {
    const id = nextToastId.current++
    setPluginActionToasts((toasts) => [...toasts, { id, message }].slice(-MAX_SUCCESS_TOASTS))
    window.setTimeout(() => {
      setPluginActionToasts((toasts) => toasts.filter((toast) => toast.id !== id))
    }, SUCCESS_TOAST_DURATION_MS)
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
          <AppRail
            section={section}
            onSectionChange={handleSectionChange}
            themePreference={themePreference}
            onThemeChange={handleThemeChange}
          />
          {section === 'skills' ? (
            <>
              <Sidebar
                filter={filter}
                onFilterChange={handleFilterChange}
                contextBudget={contextBudget}
                onSelectSkill={openDetail}
                skills={skills}
                folders={folders}
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
            </>
          ) : pluginView.kind === 'detail' ? (
            <PluginDetail
              key={`${pluginView.name}@${pluginView.marketplace}`}
              name={pluginView.name}
              marketplace={pluginView.marketplace}
              onBack={() => setPluginView({ kind: 'list' })}
              onViewSkills={handleViewSkillsForPlugin}
              onActionSuccess={showPluginActionToast}
            />
          ) : (
            <PluginInventory
              plugins={plugins}
              loading={pluginsPending}
              onSelect={(plugin) => openPluginDetail(plugin.name, plugin.marketplace)}
              onOpenSearch={() => setPaletteOpen(true)}
            />
          )}
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        skills={skills}
        onSelect={openDetail}
        plugins={plugins}
        onSelectPlugin={selectPluginFromPalette}
      />
      <ManageFoldersDialog
        open={foldersDialogOpen}
        onOpenChange={setFoldersDialogOpen}
        folders={folders}
        onAddFolders={handleAddFolders}
        onRevokeFolder={handleRevokeFolder}
      />
      <PluginActionToasts
        toasts={pluginActionToasts}
        onDismiss={(id) =>
          setPluginActionToasts((toasts) => toasts.filter((toast) => toast.id !== id))
        }
      />
    </TooltipProvider>
  )
}

export default App

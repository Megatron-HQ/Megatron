import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppRail } from '@/components/AppRail'
import { CommandPalette } from '@/components/CommandPalette'
import { ManageFoldersDialog } from '@/components/ManageFoldersDialog'
import { PluginActionToasts, type PluginActionToast } from '@/components/PluginActionToasts'
import { PluginSidebar } from '@/components/PluginSidebar'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ScanStatusBanner, ScanUpdatingBanner } from '@/components/ScanStatus'
import { useScanBanner } from '@/lib/use-scan-banner'
import { refreshScanQueries } from '@/lib/refresh-scan-queries'
import { Sidebar } from '@/components/Sidebar'
import { UsageSidebar, type UsagePanel } from '@/components/UsageSidebar'
import {
  SkillInvocationDialog,
  type SkillInvocationSelection
} from '@/components/usage/SkillInvocationDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TREE_WIDTH_DEFAULT } from '@/lib/file-tree'
import { createPluginRows, type PluginContext, type PluginFilter } from '@/lib/plugin-filter'
import { isWithinProjectPath, normalizeProjectPath } from '../../shared/project-path'
import { matchesFilter, type SourceFilter } from '@/lib/source-filter'
import {
  createProjectAvailabilityResolver,
  createProjectLabelResolver,
  projectDisplayLabels,
  resolveProjectSelection
} from '@/lib/project-tree'
import { ProjectLabelContext } from '@/lib/use-project-label'
import { SkillDetail } from './views/SkillDetail'
import { SkillInventory } from './views/SkillInventory'
import { SkillFileViewer } from './views/SkillFileViewer'
import { PluginDetail } from './views/PluginDetail'
import { PluginInventory } from './views/PluginInventory'
import { UsageView, type ActivityWindowKey } from './views/UsageView'
import type {
  AppSection,
  ContextBudget,
  CostWindowKey,
  SkillStatsWindowKey,
  ThemePreference,
  PluginUpdateProgress,
  ProjectFolder,
  PluginRow,
  SkillsListResult
} from '../../shared/ipc'

type View =
  { kind: 'list' } | { kind: 'detail'; skillId: number } | { kind: 'files'; skillId: number }

type PluginView =
  { kind: 'list' } | { kind: 'detail'; name: string; marketplace: string; context?: PluginContext }
type SkillBackTarget = 'inventory' | 'usage-skills' | 'usage-skills-dialog'

// Real value always arrives from the listSkills IPC round-trip almost immediately; this only
// covers the brief pre-response instant, so it deliberately doesn't guess at the real limit
// (that constant is derived in src/main/db/queries.ts from the binary-sourced formula).
const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  used: 0,
  limit: 0,
  excludedTokens: 0,
  excludedCount: 0,
  userInvocableOnlyTokens: 0,
  userInvocableOnlyCount: 0
}
const SUCCESS_TOAST_DURATION_MS = 3_000
const MAX_SUCCESS_TOASTS = 3

function App(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    window.api.getInitialTheme()
  )
  const [version] = useState(() => window.api.getVersion())
  const [filter, setFilter] = useState<SourceFilter>({ kind: 'all' })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [section, setSection] = useState<AppSection>(() => window.api.getInitialSection())
  const [pluginView, setPluginView] = useState<PluginView>({ kind: 'list' })
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>({ kind: 'all' })
  const [skillExpandedProjects, setSkillExpandedProjects] = useState(() => new Set(['$projects']))
  const [pluginExpandedProjects, setPluginExpandedProjects] = useState(() => new Set(['$projects']))
  const [usagePanel, setUsagePanel] = useState<UsagePanel>('activity')
  const [usageActivityWindow, setUsageActivityWindow] = useState<ActivityWindowKey>('30d')
  const [usageTokenWindow, setUsageTokenWindow] = useState<SkillStatsWindowKey>('30d')
  const [usageCalendarYear, setUsageCalendarYear] = useState(() => new Date().getFullYear())
  const [usageCostWindow, setUsageCostWindow] = useState<CostWindowKey>('30d')
  const [usageModelWindow, setUsageModelWindow] = useState<SkillStatsWindowKey>('30d')
  const [usageSkillWindow, setUsageSkillWindow] = useState<SkillStatsWindowKey>('30d')
  const [skillInvocationSelection, setSkillInvocationSelection] =
    useState<SkillInvocationSelection | null>(null)
  const [skillInvocationOpen, setSkillInvocationOpen] = useState(false)
  const [skillBackTarget, setSkillBackTarget] = useState<SkillBackTarget>('inventory')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [foldersDialogOpen, setFoldersDialogOpen] = useState(false)
  const [treeWidth, setTreeWidth] = useState(TREE_WIDTH_DEFAULT)
  const [pluginActionToasts, setPluginActionToasts] = useState<PluginActionToast[]>([])
  const nextToastId = useRef(0)
  const [pluginUpdateProgress, setPluginUpdateProgress] = useState<
    Record<string, PluginUpdateProgress>
  >({})
  useEffect(
    () =>
      window.api.onPluginUpdateProgress((progress) => {
        const key = `${progress.input.name}@${progress.input.marketplace}`
        setPluginUpdateProgress((current) => ({ ...current, [key]: progress }))
      }),
    []
  )

  const {
    data,
    isPending: skillsPending,
    isError: skillsError,
    refetch: retrySkills
  } = useQuery({
    queryKey: ['skills'],
    queryFn: () => window.api.listSkills(),
    refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
  })

  const { data: foldersData } = useQuery({
    queryKey: ['folders'],
    queryFn: () => window.api.listAllowedPaths()
  })
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => window.api.listProjects()
  })

  const {
    data: pluginsData,
    isPending: pluginsPending,
    isError: pluginsError,
    refetch: retryPlugins
  } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => window.api.listPlugins()
  })

  const { data: updateState } = useQuery({
    queryKey: ['updates'],
    queryFn: () => window.api.getUpdateState()
  })
  useEffect(
    () => window.api.onUpdateState((state) => queryClient.setQueryData(['updates'], state)),
    [queryClient]
  )
  const updateNotice =
    updateState?.status === 'ready'
      ? 'Update ready'
      : updateState?.status === 'available'
        ? 'Update available'
        : null

  useEffect(
    () =>
      window.api.onScanComplete(({ summary }) => {
        const previousProjects = queryClient.getQueryData<ProjectFolder[]>(['projects']) ?? []
        const previousSkills = queryClient.getQueryData<SkillsListResult>(['skills'])?.skills ?? []
        void refreshScanQueries(queryClient, false, summary).then(() => {
          const projects = queryClient.getQueryData<ProjectFolder[]>(['projects']) ?? []
          const skills = queryClient.getQueryData<SkillsListResult>(['skills'])?.skills
          const plugins = queryClient.getQueryData<PluginRow[]>(['plugins'])
          const disappeared = (path: string): boolean =>
            previousProjects.some(
              (entry) => normalizeProjectPath(entry.path) === normalizeProjectPath(path)
            ) &&
            !projects.some(
              (entry) => normalizeProjectPath(entry.path) === normalizeProjectPath(path)
            )
          setFilter((current) =>
            current.kind === 'project' && current.projectRoot && disappeared(current.projectRoot)
              ? {
                  kind: 'project',
                  projectRoot: resolveProjectSelection(current.projectRoot, projects)
                }
              : current
          )
          setPluginFilter((current) =>
            current.kind === 'projects' && current.projectPath && disappeared(current.projectPath)
              ? {
                  kind: 'projects',
                  projectPath: resolveProjectSelection(current.projectPath, projects)
                }
              : current
          )
          setView((current) => {
            if (current.kind === 'list' || skills === undefined) return current
            const previousRoot = previousSkills.find(
              (skill) => skill.id === current.skillId
            )?.project_root
            return !skills.some((skill) => skill.id === current.skillId) ||
              (previousRoot && disappeared(previousRoot))
              ? { kind: 'list' }
              : current
          })
          setPluginView((current) => {
            if (current.kind === 'list' || plugins === undefined) return current
            const plugin = plugins.find(
              (plugin) => plugin.name === current.name && plugin.marketplace === current.marketplace
            )
            const context = current.context
            return !plugin ||
              (context?.kind === 'project' &&
                (disappeared(context.path) ||
                  !plugin.installs.some(
                    (install) =>
                      install.project_path !== null &&
                      normalizeProjectPath(install.project_path) ===
                        normalizeProjectPath(context.path)
                  )))
              ? { kind: 'list' }
              : current
          })
        })
      }),
    [queryClient]
  )

  useEffect(
    () =>
      window.api.onScanProgress(({ source }) => {
        if (source.name === 'archiveTokens' || source.name === 'archivePrompts') {
          void queryClient.invalidateQueries({ queryKey: ['usage'] }, { cancelRefetch: false })
        }
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
      if (event.key === ',' && (event.metaKey || event.ctrlKey) && !event.repeat) {
        event.preventDefault()
        setSettingsOpen((open) => !open)
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
  const projectCatalog = useMemo(() => projectsData ?? [], [projectsData])
  const projectAvailability = useMemo(
    () => createProjectAvailabilityResolver(projectCatalog, folders),
    [projectCatalog, folders]
  )
  const plugins = useMemo(() => pluginsData ?? [], [pluginsData])
  const projectLabels = useMemo(
    () =>
      projectDisplayLabels(
        [
          ...projectCatalog
            .filter((project) => project.kind === 'repository')
            .map((project) => project.path),
          ...skills.flatMap((skill) => (skill.project_root ? [skill.project_root] : [])),
          ...plugins.flatMap((plugin) =>
            plugin.installs.flatMap((install) =>
              install.project_path ? [install.project_path] : []
            )
          )
        ],
        folders
      ),
    [projectCatalog, skills, plugins, folders]
  )
  const scanComplete = data?.scanComplete ?? false
  const resolveProjectLabel = useMemo(
    () => createProjectLabelResolver(projectLabels, folders),
    [projectLabels, folders]
  )
  const contextBudget = data?.contextBudget ?? DEFAULT_CONTEXT_BUDGET
  const {
    banner: scanBanner,
    summary: scanBannerSummary,
    scanning
  } = useScanBanner({
    skillsLoaded: !skillsPending,
    pluginsLoaded: !pluginsPending,
    skillCount: skills.length,
    pluginCount: plugins.length,
    reportedSummary: data?.scanSummary,
    reportedActivity: data?.scanActivity
  })

  const filteredSkills = useMemo(
    () => skills.filter((skill) => matchesFilter(skill, filter)),
    [skills, filter]
  )

  const filteredPlugins = useMemo(
    () => createPluginRows(plugins, pluginFilter, projectCatalog, skills, folders, projectLabels),
    [plugins, pluginFilter, projectCatalog, skills, folders, projectLabels]
  )

  function handleFilterChange(next: SourceFilter): void {
    setView({ kind: 'list' })
    setFilter(next)
  }

  function handlePluginFilterChange(next: PluginFilter): void {
    setPluginView({ kind: 'list' })
    setPluginFilter(next)
  }

  function openDetail(skillId: number): void {
    // Opening a skill detail always means "show me the Skills section" — without
    // this, selecting a skill from the command palette while on the Plugins tab
    // sets the view but leaves the Plugins branch rendered, so nothing happens.
    setSkillBackTarget('inventory')
    handleSectionChange('skills')
    setView({ kind: 'detail', skillId })
  }

  function openDetailFromAnywhere(skillId: number): void {
    // Callers that surface a skill from outside the current filtered list (command palette,
    // context-budget dialog and command palette need the filter cleared, or
    // "back" from the detail page lands on a list that doesn't contain what was just opened.
    // Mirrors selectPluginFromPalette. SkillInventory keeps plain openDetail — its rows are
    // already in-filter, so back should return to that same filtered list.
    setFilter({ kind: 'all' })
    openDetail(skillId)
  }

  function openDetailFromUsage(skillId: number): void {
    setFilter({ kind: 'all' })
    setSkillBackTarget('usage-skills')
    handleSectionChange('skills')
    setView({ kind: 'detail', skillId })
  }

  function openDetailFromInvocationDialog(skillId: number): void {
    setSkillInvocationOpen(false)
    setFilter({ kind: 'all' })
    setSkillBackTarget('usage-skills-dialog')
    handleSectionChange('skills')
    setView({ kind: 'detail', skillId })
  }

  function showSkillInvocations(selection: SkillInvocationSelection): void {
    setSkillInvocationSelection(selection)
    setSkillInvocationOpen(true)
  }

  function changeSkillWindow(windowKey: SkillStatsWindowKey): void {
    setSkillInvocationOpen(false)
    setSkillInvocationSelection(null)
    setUsageSkillWindow(windowKey)
  }

  function navigateSkillDetail(skillId: number): void {
    setFilter({ kind: 'all' })
    setView({ kind: 'detail', skillId })
  }

  function leaveSkillDetail(): void {
    setView({ kind: 'list' })
    if (skillBackTarget === 'usage-skills' || skillBackTarget === 'usage-skills-dialog') {
      setUsagePanel('skills')
      handleSectionChange('usage')
      if (skillBackTarget === 'usage-skills-dialog') setSkillInvocationOpen(true)
    }
  }

  function handleSectionChange(next: AppSection): void {
    setSection(next)
    void window.api.setLastSection(next)
  }

  function openPluginDetail(name: string, marketplace: string, context?: PluginContext): void {
    setPluginView({ kind: 'detail', name, marketplace, context })
  }

  function selectPluginFromPalette(name: string, marketplace: string): void {
    handleSectionChange('plugins')
    // The palette searches every plugin, so a narrowed sidebar filter would otherwise send you
    // "back" from the detail page to a list that doesn't contain what you just opened.
    setPluginFilter({ kind: 'all' })
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
    const folders = await window.api.pickAndAddFolders()
    await queryClient.cancelQueries({ queryKey: ['folders'] })
    queryClient.setQueryData(['folders'], folders)
    void queryClient.invalidateQueries({ queryKey: ['skills'] })
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  async function handleRevokeFolder(path: string): Promise<void> {
    const remaining = await window.api.revokeAllowedPath(path)
    await queryClient.cancelQueries({ queryKey: ['folders'] })
    queryClient.setQueryData(['folders'], remaining)
    const covered = (selectedPath: string): boolean =>
      remaining.some((folder) => isWithinProjectPath(selectedPath, folder.path))
    if (filter.kind === 'project' && filter.projectRoot && !covered(filter.projectRoot))
      handleFilterChange({ kind: 'project' })
    if (
      pluginFilter.kind === 'projects' &&
      pluginFilter.projectPath &&
      !covered(pluginFilter.projectPath)
    )
      handlePluginFilterChange({ kind: 'projects' })
    if (
      pluginView.kind === 'detail' &&
      pluginView.context?.kind === 'project' &&
      !covered(pluginView.context.path)
    )
      setPluginView({ kind: 'list' })
    void queryClient.invalidateQueries({ queryKey: ['skills'] })
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  function showPluginActionToast(message: string): void {
    const id = nextToastId.current++
    setPluginActionToasts((toasts) => [...toasts, { id, message }].slice(-MAX_SUCCESS_TOASTS))
    window.setTimeout(() => {
      setPluginActionToasts((toasts) => toasts.filter((toast) => toast.id !== id))
    }, SUCCESS_TOAST_DURATION_MS)
  }

  const content = (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        {window.api?.platform === 'darwin' && (
          <div className="relative h-8 shrink-0 drag-region">
            <div className="drag-region absolute inset-x-1.5 top-1.5 bottom-0 rounded-xl bg-muted shadow" />
          </div>
        )}
        {scanBanner.kind === 'updating' && <ScanUpdatingBanner message={scanBanner.message} />}
        {scanBanner.kind === 'warning' && scanBannerSummary && (
          <ScanStatusBanner
            summary={scanBannerSummary}
            onOpenDetails={() => setSettingsOpen(true)}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <AppRail
            section={section}
            onSectionChange={handleSectionChange}
            onOpenSettings={() => setSettingsOpen(true)}
            updateNotice={updateNotice}
          />
          {section === 'skills' ? (
            <>
              <Sidebar
                filter={filter}
                onFilterChange={handleFilterChange}
                contextBudget={contextBudget}
                onSelectSkill={openDetailFromAnywhere}
                skills={skills}
                folders={folders}
                projectCatalog={projectCatalog}
                expandedProjects={skillExpandedProjects}
                setExpandedProjects={setSkillExpandedProjects}
              />
              {view.kind === 'detail' ? (
                <SkillDetail
                  key={view.skillId}
                  skillId={view.skillId}
                  onBack={leaveSkillDetail}
                  onViewFiles={() => setView({ kind: 'files', skillId: view.skillId })}
                  onNavigate={navigateSkillDetail}
                />
              ) : view.kind === 'files' ? (
                <SkillFileViewer
                  key={view.skillId}
                  skillId={view.skillId}
                  treeWidth={treeWidth}
                  onTreeWidthChange={setTreeWidth}
                  onBack={() => setView({ kind: 'detail', skillId: view.skillId })}
                />
              ) : skillsError ? (
                <div
                  role="alert"
                  className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
                >
                  <p>Could not load skills.</p>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => void retrySkills()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <SkillInventory
                  availability={
                    filter.kind === 'project' ? projectAvailability(filter.projectRoot) : undefined
                  }
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
          ) : section === 'plugins' ? (
            <>
              <PluginSidebar
                plugins={plugins}
                folders={folders}
                projectCatalog={projectCatalog}
                expandedProjects={pluginExpandedProjects}
                setExpandedProjects={setPluginExpandedProjects}
                filter={pluginFilter}
                onFilterChange={handlePluginFilterChange}
              />
              {pluginView.kind === 'detail' ? (
                <PluginDetail
                  key={`${pluginView.name}@${pluginView.marketplace}:${JSON.stringify(pluginView.context)}`}
                  name={pluginView.name}
                  marketplace={pluginView.marketplace}
                  updateProgress={
                    pluginUpdateProgress[`${pluginView.name}@${pluginView.marketplace}`]
                  }
                  context={pluginView.context}
                  availability={
                    pluginView.context?.kind === 'project'
                      ? projectAvailability(pluginView.context.path)
                      : undefined
                  }
                  onBack={() => setPluginView({ kind: 'list' })}
                  onViewSkills={handleViewSkillsForPlugin}
                  onActionSuccess={showPluginActionToast}
                  onManageFolders={() => setFoldersDialogOpen(true)}
                />
              ) : pluginsError ? (
                <div
                  role="alert"
                  className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
                >
                  <p>Could not load plugins.</p>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => void retryPlugins()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <PluginInventory
                  availability={
                    pluginFilter.kind === 'projects'
                      ? projectAvailability(pluginFilter.projectPath)
                      : undefined
                  }
                  plugins={filteredPlugins}
                  loading={pluginsPending}
                  filter={pluginFilter}
                  onSelect={(plugin) =>
                    openPluginDetail(plugin.name, plugin.marketplace, plugin.context)
                  }
                  onOpenSearch={() => setPaletteOpen(true)}
                />
              )}
            </>
          ) : (
            <>
              <UsageSidebar panel={usagePanel} onPanelChange={setUsagePanel} />
              <UsageView
                panel={usagePanel}
                activityWindow={usageActivityWindow}
                tokenWindow={usageTokenWindow}
                onTokenWindowChange={setUsageTokenWindow}
                calendarYear={usageCalendarYear}
                onCalendarYearChange={setUsageCalendarYear}
                onActivityWindowChange={setUsageActivityWindow}
                costWindow={usageCostWindow}
                onCostWindowChange={setUsageCostWindow}
                modelWindow={usageModelWindow}
                onModelWindowChange={setUsageModelWindow}
                skillWindow={usageSkillWindow}
                onSkillWindowChange={changeSkillWindow}
                onSelectSkill={openDetailFromUsage}
                onShowInvocations={showSkillInvocations}
              />
            </>
          )}
        </div>
      </div>
      {skillInvocationSelection && (
        <SkillInvocationDialog
          key={`${skillInvocationSelection.startAt}:${skillInvocationSelection.endAt}:${skillInvocationSelection.skillName ?? ''}`}
          open={section === 'usage' && skillInvocationOpen}
          onOpenChange={setSkillInvocationOpen}
          selection={skillInvocationSelection}
          onSelectSkill={openDetailFromInvocationDialog}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        skills={skills}
        onSelect={openDetailFromAnywhere}
        plugins={plugins}
        onSelectPlugin={selectPluginFromPalette}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        themePreference={themePreference}
        onThemeChange={handleThemeChange}
        version={version}
        scanSummary={scanBannerSummary}
        scanning={scanning}
        onManageFolders={() => {
          setSettingsOpen(false)
          setFoldersDialogOpen(true)
        }}
        updateState={updateState}
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
  return (
    <ProjectLabelContext.Provider value={resolveProjectLabel}>
      {content}
    </ProjectLabelContext.Provider>
  )
}

export default App

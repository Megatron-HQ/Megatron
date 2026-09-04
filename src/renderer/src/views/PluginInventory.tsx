import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Blocks, Search } from 'lucide-react'
import { motion } from 'motion/react'
import {
  MarketplaceBadge,
  PluginScopeLabel,
  PluginStatusBadge,
  PluginUpdateBadge
} from '@/components/PluginBadges'
import { pluginUpdateDetails } from '@/lib/plugin-update'
import { getFolderBasename } from '@/lib/source-name'
import {
  getPluginFilterHeaderTitle,
  shouldShowScopeColumn,
  type PluginFilter
} from '@/lib/plugin-filter'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader as TableHeadGroup,
  TableRow
} from '@/components/ui/table'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { PluginRow, PluginScope } from '../../../shared/ipc'

const ROW_HEIGHT = 40
const HEADER_HEIGHT = 40

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, number: sortFn_basic }
})

function pluginKey(plugin: PluginRow): string {
  return `${plugin.name}@${plugin.marketplace}`
}

const SCOPE_SORT_ORDER: Record<PluginScope, number> = { user: 0, project: 1, local: 2 }

// One entry per distinct scope+project pair, so two projects installing the same plugin each
// get their own line rather than collapsing into a single ambiguous "project".
function distinctInstallScopes(
  plugin: PluginRow
): { scope: PluginScope; projectPath: string | null }[] {
  const seen = new Map<string, { scope: PluginScope; projectPath: string | null }>()
  for (const install of plugin.installs) {
    seen.set(`${install.scope}:${install.project_path ?? ''}`, {
      scope: install.scope,
      projectPath: install.project_path
    })
  }
  return [...seen.values()].sort(
    (a, b) =>
      SCOPE_SORT_ORDER[a.scope] - SCOPE_SORT_ORDER[b.scope] ||
      (a.projectPath ?? '').localeCompare(b.projectPath ?? '')
  )
}

function scopeSortKey(plugin: PluginRow): string {
  return distinctInstallScopes(plugin)
    .map((entry) => `${SCOPE_SORT_ORDER[entry.scope]}${entry.projectPath ?? ''}`)
    .join(',')
}

// The single Version column can only be the whole truth when every install agrees; a user
function formatVersionDisplay(version: string): string {
  const normalized = version.trim().replace(/^v/i, '')
  if (/^[0-9a-f]{12,40}$/i.test(normalized)) {
    return normalized.slice(0, 7)
  }
  return normalized
}

function displayVersionLabel(version: string): string {
  return `v${formatVersionDisplay(version)}`
}

// install at one version alongside a project install at another is a real state the issue calls
// out, and showing just the highest would quietly hide it.
function installVersionLabel(plugin: PluginRow): string {
  const versions = [...new Set(plugin.installs.map((install) => install.installed_version))]
  if (versions.length > 1) return 'Mixed'
  return formatVersionDisplay(versions[0] ?? plugin.installed_version)
}

// Unknown only when nothing is knowable — one readable install is enough to state the plugin's
// status, so a granted project alongside an ungranted one still reports a real answer.
function enablementKnown(plugin: PluginRow): boolean {
  return plugin.installs.length === 0 || plugin.installs.some((install) => install.enablement_known)
}

const columnHelper = createColumnHelper<typeof features, PluginRow>()

const nameColumn = columnHelper.accessor('name', {
  header: 'Name',
  sortFn: 'text',
  cell: (info) => <span className="block truncate font-medium">{info.getValue()}</span>
})

const marketplaceColumn = columnHelper.accessor('marketplace', {
  header: 'Marketplace',
  sortFn: 'text',
  cell: (info) => <MarketplaceBadge marketplace={info.getValue()} />
})

function installedVersionTooltip(
  plugin: PluginRow,
  hasUpdate: boolean,
  availableVersion: string | null
): string {
  const versions = [...new Set(plugin.installs.map((i) => i.installed_version))]
  if (versions.length > 1) {
    const list = plugin.installs
      .map(
        (i) =>
          `${i.scope}${i.project_path ? ` (${getFolderBasename(i.project_path)})` : ''}: ${displayVersionLabel(i.installed_version)}`
      )
      .join(', ')
    return `Mixed versions: ${list}`
  }
  const installed = plugin.installed_version
  const target = availableVersion ?? plugin.available_version
  const versionLabel = displayVersionLabel
  if (hasUpdate && target) {
    return `Installed: ${versionLabel(installed)} · Update available: ${versionLabel(target)}`
  }
  if (target) {
    return `Installed: ${displayVersionLabel(installed)} (matches marketplace)`
  }
  return `Installed: ${displayVersionLabel(installed)}`
}

function marketplaceVersionTooltip(plugin: PluginRow, hasUpdate: boolean): string {
  if (!plugin.available_version) {
    return 'Marketplace version unavailable'
  }
  if (hasUpdate) {
    return `Marketplace version: ${displayVersionLabel(plugin.available_version)} (newer version available)`
  }
  return `Marketplace version: ${displayVersionLabel(plugin.available_version)} (up to date)`
}

const installedVersionColumn = columnHelper.accessor(installVersionLabel, {
  id: 'installed_version',
  header: () => (
    <span>
      Install<span className="max-[1000px]:hidden"> Version</span>
    </span>
  ),
  sortFn: 'text',
  cell: (info) => {
    const plugin = info.row.original
    const { hasUpdate, message, availableVersion: updateTarget } = pluginUpdateDetails(plugin)
    const availableVersion = plugin.available_version ?? updateTarget
    const tooltipText = installedVersionTooltip(plugin, hasUpdate, availableVersion)
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 font-mono text-xs tabular-nums text-foreground cursor-default">
              {info.getValue()}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltipText}</TooltipContent>
        </Tooltip>
        {hasUpdate && (
          <PluginUpdateBadge availableVersion={availableVersion} tooltipMessage={message} />
        )}
      </div>
    )
  }
})

const marketplaceVersionColumn = columnHelper.accessor((plugin) => plugin.available_version ?? '', {
  id: 'marketplace_version',
  header: () => (
    <span>
      Marketplace<span className="max-[1000px]:hidden"> Version</span>
    </span>
  ),
  sortFn: 'text',
  cell: (info) => {
    const plugin = info.row.original
    const { hasUpdate } = pluginUpdateDetails(plugin)
    const available = plugin.available_version
    const tooltipText = marketplaceVersionTooltip(plugin, hasUpdate)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block shrink-0 font-mono text-xs tabular-nums text-muted-foreground cursor-default">
            {available ? formatVersionDisplay(available) : '—'}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>
    )
  }
})

const scopeColumn = columnHelper.accessor(scopeSortKey, {
  id: 'scope',
  header: 'Scope',
  sortFn: 'text',
  // First install only, plus a count of the rest. Rows are a fixed 40px — the glide highlight
  // positions itself arithmetically off ROW_HEIGHT — so the cell can't grow to stack them; the
  // detail view is where every install is listed in full.
  cell: (info) => {
    const scopes = distinctInstallScopes(info.row.original)
    const [first, ...rest] = scopes
    if (first === undefined) return null
    return (
      <div className="flex min-w-0 items-center gap-1">
        <PluginScopeLabel scope={first.scope} projectPath={first.projectPath} />
        {rest.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">+{rest.length}</span>
        )}
      </div>
    )
  }
})

const skillCountColumn = columnHelper.accessor('skill_count', {
  header: 'Skills',
  sortFn: 'number',
  cell: (info) => (
    <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
      {info.getValue().toLocaleString()}
    </span>
  )
})

const statusColumn = columnHelper.accessor('disabled_reason', {
  id: 'status',
  header: 'Status',
  sortFn: (rowA, rowB) => {
    const aVal = rowA.original.disabled_reason === null ? 0 : 1
    const bVal = rowB.original.disabled_reason === null ? 0 : 1
    return aVal - bVal
  },
  cell: (info) => (
    <PluginStatusBadge
      disabledReason={info.getValue()}
      known={enablementKnown(info.row.original)}
    />
  )
})

const columns: ColumnDef<typeof features, PluginRow, unknown>[] = columnHelper.columns([
  nameColumn,
  marketplaceColumn,
  installedVersionColumn,
  marketplaceVersionColumn,
  scopeColumn,
  skillCountColumn,
  statusColumn
])

const columnsWithoutScope: ColumnDef<typeof features, PluginRow, unknown>[] = columnHelper.columns([
  nameColumn,
  marketplaceColumn,
  installedVersionColumn,
  marketplaceVersionColumn,
  skillCountColumn,
  statusColumn
])

const COLUMN_WIDTH: Record<string, string> = {
  // Name is the flexible column, absorbing whatever the fixed ones leave. Marketplace source
  // drops out below 1000px: with a 220px sidebar beside it, seven fixed columns don't fit the
  // 860px minimum window, and Marketplace source carries least on the table.
  name: 'min-w-0',
  marketplace: 'w-[110px] max-[1000px]:hidden',
  installed_version: 'w-[125px] max-[1000px]:w-[100px]',
  marketplace_version: 'w-[140px] max-[1000px]:w-[105px]',
  scope: 'w-[120px] max-[1000px]:w-[100px]',
  skill_count: 'w-[50px] max-[1000px]:w-[45px]',
  status: 'w-[95px] max-[1000px]:w-[90px]'
}

// "All Plugins" being empty means nothing is installed at all; any other filter being empty means
// this scope has nothing, which is an ordinary state rather than a setup problem.
function emptyTitle(filter: PluginFilter): string {
  if (filter.kind === 'all') return 'No plugins installed'
  if (filter.kind === 'user') return 'No user-scope plugins'
  if (filter.projectPath) return `No ${filter.kind}-scope plugins in this project`
  return `No ${filter.kind}-scope plugins`
}

function emptyDetail(filter: PluginFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'Plugins are discovered from your installed Claude Code plugins.'
    case 'user':
      return 'User-scope plugins are installed for you across every project.'
    case 'project':
      return 'Project-scope plugins are installed by a repo, in its .claude/settings.json.'
    case 'local':
      return 'Local-scope plugins are installed for one project on this machine, in its .claude/settings.local.json.'
  }
}

interface PluginInventoryProps {
  plugins: PluginRow[]
  loading: boolean
  filter: PluginFilter
  onSelect: (plugin: PluginRow) => void
  onOpenSearch: () => void
}

export function PluginInventory({
  plugins,
  loading,
  filter,
  onSelect,
  onOpenSearch
}: PluginInventoryProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition } =
    useGlideHighlight<string>()
  const showScope = shouldShowScopeColumn(filter)

  const table = useTable({
    features,
    columns: showScope ? columns : columnsWithoutScope,
    data: plugins,
    state: { sorting },
    onSortingChange: setSorting
  })

  const rows = table.getRowModel().rows
  const hasRows = rows.length > 0
  const safeFocusedIndex = Math.min(focusedIndex, Math.max(rows.length - 1, 0))
  const highlightIndex =
    hoveredId !== null ? rows.findIndex((row) => pluginKey(row.original) === hoveredId) : -1

  const focusRow = useCallback(
    (index: number): void => {
      const clamped = Math.max(0, Math.min(index, rows.length - 1))
      setFocusedIndex(clamped)
      const rowEl = containerRef.current?.querySelectorAll('tbody tr')[clamped]
      if (rowEl instanceof HTMLElement) rowEl.focus()
    },
    [rows.length]
  )

  useEffect(() => {
    if (!hasRows) return
    if (containerRef.current?.contains(document.activeElement)) return
    focusRow(0)
  }, [hasRows, focusRow])

  let body: React.JSX.Element
  if (loading) {
    body = (
      <div className="flex-1 overflow-auto">
        <Table className="table-fixed">
          <TableHeadGroup>
            <TableRow className="h-10">
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.name)}>Name</TableHead>
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.marketplace)}>
                Marketplace
              </TableHead>
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.installed_version)}>
                Install<span className="max-[1000px]:hidden"> Version</span>
              </TableHead>
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.marketplace_version)}>
                Marketplace<span className="max-[1000px]:hidden"> Version</span>
              </TableHead>
              {showScope && (
                <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.scope)}>Scope</TableHead>
              )}
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.skill_count)}>Skills</TableHead>
              <TableHead className={cn('px-3 py-2', COLUMN_WIDTH.status)}>Status</TableHead>
            </TableRow>
          </TableHeadGroup>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="h-10 border-b-0">
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.marketplace)}>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.installed_version)}>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.marketplace_version)}>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                {showScope && (
                  <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.scope)}>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                )}
                <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.skill_count)}>
                  <Skeleton className="ml-auto h-4 w-8" />
                </TableCell>
                <TableCell className={cn('px-3 py-2', COLUMN_WIDTH.status)}>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  } else if (rows.length === 0) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Blocks className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{emptyTitle(filter)}</p>
        <p className="max-w-[360px] text-sm text-muted-foreground">{emptyDetail(filter)}</p>
      </div>
    )
  } else {
    body = (
      <div ref={containerRef} className="relative flex-1 overflow-auto" onMouseLeave={onMouseLeave}>
        {highlightIndex >= 0 && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 z-0 bg-accent"
            initial={false}
            animate={{ top: HEADER_HEIGHT + highlightIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            transition={transition}
          />
        )}
        <Table className="relative z-10 table-fixed">
          <TableHeadGroup>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="h-10">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase',
                      COLUMN_WIDTH[header.column.id]
                    )}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="flex items-center gap-1 hover:text-foreground"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        {{ asc: '↑', desc: '↓' }[header.column.getIsSorted() as string] ?? null}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeadGroup>
          <TableBody>
            {rows.map((row, index) => (
              <motion.tr
                key={row.id}
                data-slot="table-row"
                tabIndex={index === safeFocusedIndex ? 0 : -1}
                className="h-10 cursor-pointer border-b-0 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
                onFocus={() => setFocusedIndex(index)}
                onMouseEnter={() => setHoveredId(pluginKey(row.original))}
                onClick={() => onSelect(row.original)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    focusRow(index + 1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    focusRow(index - 1)
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(row.original)
                  }
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn('px-3 py-2', COLUMN_WIDTH[cell.column.id])}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="truncate text-[13px] font-semibold">
          {getPluginFilterHeaderTitle(filter)}
          {!loading && <span className="font-normal text-muted-foreground"> · {rows.length}</span>}
        </h2>
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-3.5" />
          Search
          <kbd className="rounded border border-border bg-background px-1 font-mono text-[11px]">
            {window.electron?.process?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>
      {body}
    </div>
  )
}

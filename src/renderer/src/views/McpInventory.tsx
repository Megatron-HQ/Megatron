import { useCallback, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
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
import { Loader2, Plug, RefreshCw, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { GlideTitle } from '@/components/GlideTitle'
import { McpConnectionBadge, McpStatusBadge } from '@/components/McpBadges'
import { ManageFoldersButton } from '@/components/ManageFoldersButton'
import { ProjectAvailabilityNotice } from '@/components/ProjectAvailabilityNotice'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader as TableHeadGroup,
  TableRow
} from '@/components/ui/table'
import { mcpFilterTitle, mcpSourceLabel, type McpFilter } from '@/lib/mcp-filter'
import { ENTER, mcpTitleGlideId, useSettle } from '@/lib/transitions'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { formatRelativeTime } from '@/lib/relative-time'
import { formatUsageSince } from '@/lib/usage-since'
import { useProjectLabel } from '@/lib/use-project-label'
import { cn } from '@/lib/utils'
import type { McpLiveStatus, McpServerRow, ProjectFolder, SkippedGrant } from '../../../shared/ipc'

const ROW_HEIGHT = 40
const HEADER_HEIGHT = 40
const SKELETON_ROWS = 6

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, number: sortFn_basic }
})

const COLUMN_WIDTH: Record<string, string> = {
  // Percentages above 1000px share a wide window across columns, as PluginInventory explains;
  // below it, pixel widths keep the Status pill from forcing a horizontal scroll.
  name: 'w-[32%] max-[1000px]:w-auto',
  source: 'w-[14%] max-[1000px]:w-[95px]',
  transport: 'w-[10%] max-[1000px]:hidden',
  calls: 'w-[10%] max-[1000px]:w-[70px]',
  connection: 'w-[18%] max-[1000px]:w-[135px]',
  status: 'w-[16%] max-[1000px]:w-[115px]'
}

const columnHelper = createColumnHelper<typeof features, McpServerRow>()

// Sorting by connection puts servers in trouble first; unchecked ones sort last.
const CONNECTION_RANK: Record<McpLiveStatus, number> = {
  failed: 0,
  needs_auth: 1,
  degraded: 2,
  not_configured: 3,
  pending_approval: 4,
  rejected: 5,
  disabled: 6,
  connected: 7
}
const UNCHECKED_RANK = 8

const columns: ColumnDef<typeof features, McpServerRow, unknown>[] = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Name',
    sortFn: 'text',
    cell: (info) => (
      <GlideTitle
        glideId={mcpTitleGlideId(info.row.original.id)}
        level="list"
        className="block truncate font-medium"
      >
        {info.getValue()}
      </GlideTitle>
    )
  }),
  columnHelper.accessor((row) => mcpSourceLabel(row), {
    id: 'source',
    header: 'Source',
    sortFn: 'text',
    cell: (info) => <span className="truncate text-muted-foreground">{info.getValue()}</span>
  }),
  columnHelper.accessor((row) => row.transports.join(', '), {
    id: 'transport',
    header: 'Transport',
    sortFn: 'text',
    cell: (info) => (
      <span className="truncate font-mono text-xs text-muted-foreground">
        {info.getValue() || '—'}
      </span>
    )
  }),
  columnHelper.accessor('calls', {
    header: 'Calls',
    sortFn: 'number',
    cell: (info) => (
      <span className="font-mono text-xs tabular-nums">
        {info.getValue() === 0 ? '—' : info.getValue().toLocaleString()}
      </span>
    )
  }),
  columnHelper.accessor(
    (row) => (row.liveStatus === null ? UNCHECKED_RANK : CONNECTION_RANK[row.liveStatus.status]),
    {
      id: 'connection',
      header: 'Connection',
      sortFn: 'number',
      cell: (info) => <McpConnectionBadge live={info.row.original.liveStatus} />
    }
  ),
  columnHelper.accessor((row) => row.warnings * 1_000 + row.notices, {
    id: 'status',
    header: 'Status',
    sortFn: 'number',
    cell: (info) => <McpStatusBadge server={info.row.original} />
  })
])

function emptyTitle(filter: McpFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'No MCP servers yet'
    case 'projects':
      return filter.projectPath ? 'No MCP servers in this folder' : 'No project MCP servers'
    default:
      return `No ${mcpFilterTitle(filter).toLowerCase()}`
  }
}

function emptyDetail(filter: McpFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'Servers appear once Claude Code is configured with one, a plugin ships one, or a transcript records a call.'
    case 'user':
      return 'User servers load in every project, from .claude.json.'
    case 'projects':
      return "Local servers live in .claude.json for one project; project servers in a granted repo's .mcp.json."
    case 'plugins':
      return 'Plugin servers come with installed plugins.'
    case 'connectors':
      return 'claude.ai connectors appear once Claude Code calls one or an /mcp switch names it.'
    case 'observed':
      return 'Servers seen only in transcripts, such as built-ins, appear here.'
  }
}

interface McpInventoryProps {
  servers: McpServerRow[]
  loading: boolean
  filter: McpFilter
  // Since when every call is counted (McpServerList.callsSince).
  callsSince: string | null
  // The general connection check (docs/mcp-servers.md, Live check).
  lastCheckedAt: string | null
  checking: boolean
  checkError: string | null
  onCheckConnections: () => void
  availability?: ProjectFolder['status']
  onSelect: (server: McpServerRow) => void
  onOpenSearch: () => void
  onAddFolders: (target?: string) => Promise<SkippedGrant[]>
  onHideFolder: (path: string) => Promise<void>
  onManageFolders: () => void
  // The row Back left from, focused when the list mounts so Back returns to where the user was.
  restoreFocusId?: string | null
}

export function McpInventory({
  servers,
  loading,
  filter,
  callsSince,
  lastCheckedAt,
  checking,
  checkError,
  onCheckConnections,
  availability,
  onSelect,
  onOpenSearch,
  onAddFolders,
  onHideFolder,
  onManageFolders,
  restoreFocusId = null
}: McpInventoryProps): React.JSX.Element {
  const resolveProjectLabel = useProjectLabel()
  const [sorting, setSorting] = useState<SortingState>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition } =
    useGlideHighlight<string>()

  const table = useTable({
    features,
    columns,
    data: servers,
    getRowId: (row) => row.id,
    state: { sorting },
    onSortingChange: setSorting
  })

  const rows = table.getRowModel().rows
  const headerTitle =
    filter.kind === 'projects' && filter.projectPath
      ? `Projects / ${resolveProjectLabel(filter.projectPath)} servers`
      : mcpFilterTitle(filter)
  const hasRows = rows.length > 0
  const callsSinceLabel = formatUsageSince(callsSince)
  const safeFocusedIndex = Math.min(focusedIndex, Math.max(rows.length - 1, 0))
  const highlightIndex = hoveredId !== null ? rows.findIndex((row) => row.id === hoveredId) : -1
  const settle = useSettle(loading)

  const focusRow = useCallback(
    (index: number): void => {
      const clamped = Math.max(0, Math.min(index, rows.length - 1))
      setFocusedIndex(clamped)
      const key = rows[clamped]?.id
      const rowEl = [
        ...(containerRef.current?.querySelectorAll<HTMLElement>('tbody tr') ?? [])
      ].find((el) => el.dataset.rowKey === key)
      rowEl?.focus()
    },
    [rows]
  )

  const pendingRestoreId = useRef(restoreFocusId)
  const focusShownRows = useEffectEvent(() => {
    if (containerRef.current?.contains(document.activeElement)) return
    const restoreIndex = rows.findIndex((row) => row.id === pendingRestoreId.current)
    pendingRestoreId.current = null
    focusRow(Math.max(restoreIndex, 0))
  })

  useLayoutEffect(() => {
    if (hasRows) focusShownRows()
  }, [hasRows, rows.length])

  const headers = (
    <TableRow className="h-10">
      {table.getHeaderGroups()[0].headers.map((header) => (
        <TableHead
          key={header.id}
          className={cn(
            'px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase',
            COLUMN_WIDTH[header.column.id]
          )}
        >
          {header.column.getCanSort() && !loading ? (
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
  )

  let body: React.JSX.Element
  if (loading) {
    body = (
      <div className="flex-1 overflow-auto">
        <Table className="table-fixed">
          <TableHeadGroup>{headers}</TableHeadGroup>
          <TableBody>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <TableRow key={i} className="h-10 border-b-0">
                {Object.entries(COLUMN_WIDTH).map(([id, width]) => (
                  <TableCell key={id} className={cn('px-3 py-2', width)}>
                    <Skeleton className={cn('h-4', id === 'name' ? 'w-32' : 'w-12')} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  } else if (!hasRows) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Plug aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{emptyTitle(filter)}</p>
        <p className="max-w-[360px] text-sm text-muted-foreground">{emptyDetail(filter)}</p>
      </div>
    )
  } else {
    body = (
      <motion.div
        ref={containerRef}
        layoutScroll
        {...settle}
        className="relative flex-1 overflow-auto"
        onMouseLeave={onMouseLeave}
      >
        {highlightIndex >= 0 && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 z-0 bg-accent"
            initial={false}
            animate={{ top: HEADER_HEIGHT + highlightIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            transition={transition}
          />
        )}
        <Table className="relative z-10 table-fixed">
          <TableHeadGroup>{headers}</TableHeadGroup>
          <TableBody>
            <AnimatePresence initial={false}>
              {rows.map((row, index) => (
                <motion.tr
                  key={row.id}
                  data-slot="table-row"
                  data-row-key={row.id}
                  tabIndex={index === safeFocusedIndex ? 0 : -1}
                  className="h-10 cursor-pointer border-b-0 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0 } : ENTER}
                  onFocus={() => setFocusedIndex(index)}
                  onMouseEnter={() => setHoveredId(row.id)}
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
            </AnimatePresence>
          </TableBody>
        </Table>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ProjectAvailabilityNotice
        status={availability}
        message={
          filter.kind === 'projects' && filter.projectPath
            ? `${resolveProjectLabel(filter.projectPath)} needs folder access to read its .mcp.json and change its servers.`
            : undefined
        }
        projects={
          filter.kind === 'projects' && filter.projectPath ? [filter.projectPath] : undefined
        }
        onAddFolders={onAddFolders}
        onHideFolder={onHideFolder}
      />
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h2 title={headerTitle} className="truncate text-[13px] font-semibold">
          {headerTitle}
          {!loading && <span className="font-normal text-muted-foreground"> · {rows.length}</span>}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          {lastCheckedAt && (
            <span
              title="When Megatron last ran claude mcp list. Results last for this session."
              className="text-[11px] text-muted-foreground max-[1000px]:hidden"
            >
              Checked {formatRelativeTime(lastCheckedAt)}
            </span>
          )}
          {callsSinceLabel && (
            <span
              title={`Every call since ${callsSinceLabel}, including ones whose transcripts Claude Code has since deleted.`}
              className="text-[11px] text-muted-foreground max-[1000px]:hidden"
            >
              Calls since {callsSinceLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onCheckConnections}
            disabled={checking}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
          >
            {checking ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" className="size-3.5" />
            )}
            {checking ? 'Checking…' : 'Check connections'}
          </button>
          {filter.kind === 'projects' && <ManageFoldersButton onClick={onManageFolders} />}
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="size-3.5" />
            Search
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[11px]">
              {window.api?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </button>
        </div>
      </div>
      {checkError && (
        <p
          role="alert"
          className="shrink-0 border-b border-border bg-destructive/10 px-4 py-1.5 text-[11px] text-destructive"
        >
          {checkError}
        </p>
      )}
      {body}
    </div>
  )
}

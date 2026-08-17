import { useRef, useState } from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { AlertTriangle, FolderOpen, Lock, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { ClaudeIcon } from '@/components/ClaudeIcon'
import { LintStatusBadge } from '@/components/LintStatusBadge'
import { SourceBadge } from '@/components/SourceBadge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader as TableHeadGroup,
  TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import { FILTER_LABEL, type SourceFilter } from '@/lib/source-filter'
import { getSourceSortKey } from '@/lib/source-name'
import type { SkillRow } from '../../../shared/ipc'

const ROW_HEIGHT = 40
const HEADER_HEIGHT = 40

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, number: sortFn_basic }
})

const columnHelper = createColumnHelper<typeof features, SkillRow>()

const COLUMN_WIDTH: Record<string, string> = {
  name: 'w-[200px]',
  status: 'w-[100px]',
  source: 'w-[120px]',
  est_listing_tokens: 'w-[90px]',
  total_invocations: 'w-[80px]'
}

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Name',
    sortFn: 'text',
    cell: (info) => {
      const row = info.row.original
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{info.getValue()}</span>
          {row.source_type === 'plugin' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="size-3 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                Plugin-managed — read-only, may be overwritten on update.
              </TooltipContent>
            </Tooltip>
          )}
          {row.shadowed_by_skill_id !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3 shrink-0 text-warning" />
              </TooltipTrigger>
              <TooltipContent>
                A global skill with the same name always wins. This one can never run.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      )
    }
  }),
  columnHelper.accessor('lint_status', {
    id: 'status',
    header: 'Status',
    sortFn: (rowA, rowB) => {
      const order: Record<string, number> = { error: 0, warning: 1, clean: 2 }
      const aVal = order[rowA.original.lint_status] ?? 3
      const bVal = order[rowB.original.lint_status] ?? 3
      return aVal - bVal
    },
    cell: (info) => {
      const row = info.row.original
      return (
        <LintStatusBadge
          status={row.lint_status}
          errorCount={row.error_count}
          warningCount={row.warning_count}
        />
      )
    }
  }),
  columnHelper.accessor(
    (row) => getSourceSortKey(row.source_type, row.source_path, row.plugin_name),
    {
      id: 'source',
      header: 'Source',
      sortFn: 'text',
      cell: (info) => {
        const row = info.row.original
        return (
          <SourceBadge
            type={row.source_type}
            sourcePath={row.source_path}
            pluginName={row.plugin_name}
          />
        )
      }
    }
  ),
  columnHelper.accessor('description', {
    header: 'Description',
    sortFn: 'text',
    sortUndefined: 'last',
    cell: (info) => (
      <span className="block truncate text-muted-foreground">{info.getValue() ?? '—'}</span>
    )
  }),
  columnHelper.accessor('est_listing_tokens', {
    header: 'Tokens',
    sortFn: 'number',
    cell: (info) => (
      <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
        {info.getValue().toLocaleString()}
      </span>
    )
  }),
  columnHelper.accessor('total_invocations', {
    header: 'Uses',
    sortFn: 'number',
    cell: (info) => {
      const value = info.getValue()
      return (
        <span className="block text-right font-mono text-xs tabular-nums text-muted-foreground">
          {value === 0 ? 'Never' : value.toLocaleString()}
        </span>
      )
    }
  })
])

interface SkillInventoryProps {
  skills: SkillRow[]
  loading: boolean
  filter: SourceFilter
  onSelect: (id: number) => void
  onOpenSearch: () => void
  onManageFolders?: () => void
  onGrantFolder?: () => void
}

export function SkillInventory({
  skills,
  loading,
  filter,
  onSelect,
  onOpenSearch,
  onManageFolders,
  onGrantFolder
}: SkillInventoryProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition } =
    useGlideHighlight<number>()

  const table = useTable({
    features,
    columns,
    data: skills,
    state: { sorting },
    onSortingChange: setSorting
  })

  const rows = table.getRowModel().rows
  const safeFocusedIndex = Math.min(focusedIndex, Math.max(rows.length - 1, 0))
  const highlightIndex =
    hoveredId !== null ? rows.findIndex((row) => row.original.id === hoveredId) : -1

  function focusRow(index: number): void {
    const clamped = Math.max(0, Math.min(index, rows.length - 1))
    setFocusedIndex(clamped)
    const rowEl = containerRef.current?.querySelectorAll('tbody tr')[clamped]
    if (rowEl instanceof HTMLElement) rowEl.focus()
  }

  let body: React.JSX.Element
  if (loading) {
    body = (
      <div className="flex-1 overflow-auto">
        <Table className="table-fixed">
          <TableHeadGroup>
            <TableRow className="h-10">
              <TableHead className="w-[200px] px-3 py-2">Name</TableHead>
              <TableHead className="w-[100px] px-3 py-2">Status</TableHead>
              <TableHead className="w-[120px] px-3 py-2">Source</TableHead>
              <TableHead className="px-3 py-2">Description</TableHead>
              <TableHead className="w-[90px] px-3 py-2">Tokens</TableHead>
              <TableHead className="w-[80px] px-3 py-2">Uses</TableHead>
            </TableRow>
          </TableHeadGroup>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i} className="h-10 border-b-0">
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="ml-auto h-4 w-10" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="ml-auto h-4 w-8" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  } else if (rows.length === 0) {
    body = <EmptyState filter={filter} onGrantFolder={onGrantFolder} />
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
                onMouseEnter={() => setHoveredId(row.original.id)}
                onClick={() => onSelect(row.original.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    focusRow(index + 1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    focusRow(index - 1)
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(row.original.id)
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
      <TableHeader
        title={FILTER_LABEL[filter]}
        count={loading ? null : rows.length}
        filter={filter}
        onOpenSearch={onOpenSearch}
        onManageFolders={onManageFolders}
      />
      {body}
    </div>
  )
}

function TableHeader({
  title,
  count,
  filter,
  onOpenSearch,
  onManageFolders
}: {
  title: string
  count: number | null
  filter: SourceFilter
  onOpenSearch: () => void
  onManageFolders?: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          <ClaudeIcon className="size-3.5" />
          Claude Code
        </span>
        <span className="h-4 w-px shrink-0 bg-border" />
        <h2 className="truncate text-[13px] font-semibold">
          {title}
          {count !== null && <span className="font-normal text-muted-foreground"> · {count}</span>}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {filter === 'project' && onManageFolders && (
          <button
            type="button"
            onClick={onManageFolders}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FolderOpen className="size-3.5" />
            Manage Folders
          </button>
        )}
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="size-3.5" />
          Search skills
          <kbd className="rounded border border-border bg-background px-1 font-mono text-[11px]">
            {window.electron?.process?.platform === 'darwin' ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>
    </div>
  )
}

function EmptyState({
  filter,
  onGrantFolder
}: {
  filter: SourceFilter
  onGrantFolder?: () => void
}): React.JSX.Element {
  const isProject = filter === 'project'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderOpen className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">
        {isProject ? 'No project skills found' : 'No skills found'}
      </p>
      <p className="max-w-[320px] text-sm text-muted-foreground">
        {isProject
          ? 'Project-level skills come from repos you grant Megatron access to.'
          : 'Nothing was found for this filter.'}
      </p>
      {isProject && (
        <button
          type="button"
          onClick={onGrantFolder}
          className="mt-2 rounded-md bg-accent-lime px-3 py-1.5 text-sm font-medium text-accent-lime-foreground transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Grant a folder to scan for skills
        </button>
      )}
    </div>
  )
}

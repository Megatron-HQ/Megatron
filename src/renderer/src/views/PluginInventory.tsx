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
import { MarketplaceBadge, PluginStatusBadge } from '@/components/PluginBadges'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { PluginRow } from '../../../shared/ipc'

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

function scopesLabel(plugin: PluginRow): string {
  const scopes = [...new Set(plugin.installs.map((install) => install.scope))].sort()
  return scopes.join(', ')
}

const columnHelper = createColumnHelper<typeof features, PluginRow>()

const nameColumn = columnHelper.accessor('name', {
  header: 'Name',
  sortFn: 'text',
  cell: (info) => <span className="truncate font-medium">{info.getValue()}</span>
})

const marketplaceColumn = columnHelper.accessor('marketplace', {
  header: 'Marketplace',
  sortFn: 'text',
  cell: (info) => <MarketplaceBadge marketplace={info.getValue()} />
})

const versionColumn = columnHelper.accessor('installed_version', {
  header: 'Version',
  sortFn: 'text',
  cell: (info) => (
    <span className="block font-mono text-xs tabular-nums text-muted-foreground">
      {info.getValue()}
    </span>
  )
})

const scopeColumn = columnHelper.accessor(scopesLabel, {
  id: 'scope',
  header: 'Scope',
  sortFn: 'text',
  cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>
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
  cell: (info) => <PluginStatusBadge disabledReason={info.getValue()} />
})

const columns: ColumnDef<typeof features, PluginRow, unknown>[] = columnHelper.columns([
  nameColumn,
  marketplaceColumn,
  versionColumn,
  scopeColumn,
  skillCountColumn,
  statusColumn
])

const COLUMN_WIDTH: Record<string, string> = {
  name: 'w-[200px]',
  marketplace: 'w-[140px]',
  installed_version: 'w-[100px]',
  scope: 'w-[140px]',
  skill_count: 'w-[80px]',
  status: 'w-[110px]'
}

interface PluginInventoryProps {
  plugins: PluginRow[]
  loading: boolean
  onSelect: (plugin: PluginRow) => void
  onOpenSearch: () => void
}

export function PluginInventory({
  plugins,
  loading,
  onSelect,
  onOpenSearch
}: PluginInventoryProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition } =
    useGlideHighlight<string>()

  const table = useTable({
    features,
    columns,
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
              <TableHead className="w-[200px] px-3 py-2">Name</TableHead>
              <TableHead className="w-[140px] px-3 py-2">Marketplace</TableHead>
              <TableHead className="w-[100px] px-3 py-2">Version</TableHead>
              <TableHead className="w-[140px] px-3 py-2">Scope</TableHead>
              <TableHead className="w-[80px] px-3 py-2">Skills</TableHead>
              <TableHead className="w-[110px] px-3 py-2">Status</TableHead>
            </TableRow>
          </TableHeadGroup>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="h-10 border-b-0">
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="ml-auto h-4 w-8" />
                </TableCell>
                <TableCell className="px-3 py-2">
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
        <p className="text-sm font-medium">No plugins installed</p>
        <p className="max-w-[360px] text-sm text-muted-foreground">
          Plugins are discovered from your installed Claude Code plugins.
        </p>
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
          Plugins
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

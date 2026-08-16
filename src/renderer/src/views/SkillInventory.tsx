import { useRef, useState } from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { FolderOpen, Lock, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { ClaudeIcon } from '@/components/ClaudeIcon'
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
import type { SkillRow } from '../../../shared/ipc'

const ROW_HEIGHT = 40
const HEADER_HEIGHT = 40

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text }
})

const columnHelper = createColumnHelper<typeof features, SkillRow>()

const COLUMN_WIDTH: Record<string, string> = {
  name: 'w-[220px]',
  source: 'w-[120px]'
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
        </span>
      )
    }
  }),
  columnHelper.accessor('source_type', {
    id: 'source',
    header: 'Source',
    sortFn: 'text',
    cell: (info) => <SourceBadge type={info.getValue()} />
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    sortFn: 'text',
    sortUndefined: 'last',
    cell: (info) => (
      <span className="block truncate text-muted-foreground">{info.getValue() ?? '—'}</span>
    )
  })
])

interface SkillInventoryProps {
  skills: SkillRow[]
  loading: boolean
  filter: SourceFilter
  onSelect: (id: number) => void
  onOpenSearch: () => void
}

export function SkillInventory({
  skills,
  loading,
  filter,
  onSelect,
  onOpenSearch
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
              <TableHead className="w-[220px] px-3 py-2">Name</TableHead>
              <TableHead className="w-[120px] px-3 py-2">Source</TableHead>
              <TableHead className="px-3 py-2">Description</TableHead>
            </TableRow>
          </TableHeadGroup>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i} className="h-10 border-b-0">
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-48" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  } else if (rows.length === 0) {
    body = <EmptyState filter={filter} />
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
        onOpenSearch={onOpenSearch}
      />
      {body}
    </div>
  )
}

function TableHeader({
  title,
  count,
  onOpenSearch
}: {
  title: string
  count: number | null
  onOpenSearch: () => void
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
  )
}

function EmptyState({ filter }: { filter: SourceFilter }): React.JSX.Element {
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className="mt-2 rounded-md bg-accent-lime px-3 py-1.5 text-sm text-accent-lime-foreground opacity-50"
            >
              Grant a folder to scan for skills
            </button>
          </TooltipTrigger>
          <TooltipContent>Coming soon — folder access is not wired up yet.</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

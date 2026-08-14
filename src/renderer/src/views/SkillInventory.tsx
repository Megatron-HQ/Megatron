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
import { Blocks, FolderGit2, FolderOpen, Globe, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SkillRow, SourceType } from '../../../shared/ipc'
import type { SourceFilter } from '@/components/Sidebar'

const SOURCE_ICON: Record<SourceType, typeof Globe> = {
  global: Globe,
  project: FolderGit2,
  plugin: Blocks
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text }
})

const columnHelper = createColumnHelper<typeof features, SkillRow>()

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Name',
    sortFn: 'text',
    cell: (info) => {
      const row = info.row.original
      return (
        <span className="flex items-center gap-1.5">
          {info.getValue()}
          {row.source_type === 'plugin' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="size-3 text-muted-foreground" />
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
    cell: (info) => {
      const type = info.getValue()
      const Icon = SOURCE_ICON[type]
      return (
        <Badge variant="outline" className="gap-1 font-normal capitalize">
          <Icon className="size-3" />
          {type}
        </Badge>
      )
    }
  }),
  columnHelper.accessor('description', {
    header: 'Description',
    sortFn: 'text',
    sortUndefined: 'last',
    cell: (info) => (
      <span className="block max-w-[360px] truncate text-muted-foreground">
        {info.getValue() ?? '—'}
      </span>
    )
  }),
  columnHelper.accessor(
    (row) => (row.source_type === 'plugin' ? row.plugin_name : row.source_path),
    {
      id: 'path',
      header: 'Path',
      sortFn: 'text',
      cell: (info) => {
        const value = info.getValue() ?? '—'
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-[220px] truncate font-mono text-xs text-muted-foreground">
                {value}
              </span>
            </TooltipTrigger>
            <TooltipContent>{value}</TooltipContent>
          </Tooltip>
        )
      }
    }
  )
])

interface SkillInventoryProps {
  skills: SkillRow[]
  loading: boolean
  filter: SourceFilter
  selectedId: number | null
  onSelect: (id: number) => void
}

export function SkillInventory({
  skills,
  loading,
  filter,
  selectedId,
  onSelect
}: SkillInventoryProps): React.JSX.Element {
  const [sorting, setSorting] = useState<SortingState>([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const table = useTable({
    features,
    columns,
    data: skills,
    state: { sorting },
    onSortingChange: setSorting
  })

  const rows = table.getRowModel().rows
  const safeFocusedIndex = Math.min(focusedIndex, Math.max(rows.length - 1, 0))

  function focusRow(index: number): void {
    const clamped = Math.max(0, Math.min(index, rows.length - 1))
    setFocusedIndex(clamped)
    const rowEl = containerRef.current?.querySelectorAll('tbody tr')[clamped]
    if (rowEl instanceof HTMLElement) rowEl.focus()
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="h-9">
              <TableHead className="px-3 py-2">Name</TableHead>
              <TableHead className="px-3 py-2">Source</TableHead>
              <TableHead className="px-3 py-2">Description</TableHead>
              <TableHead className="px-3 py-2">Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i} className="h-9">
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <Skeleton className="h-4 w-40" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState filter={filter} />
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="h-9">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
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
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={row.id}
              tabIndex={index === safeFocusedIndex ? 0 : -1}
              data-state={row.original.id === selectedId ? 'selected' : undefined}
              className={cn(
                'h-9 cursor-pointer text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
              )}
              onFocus={() => setFocusedIndex(index)}
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
                <TableCell key={cell.id} className="px-3 py-2">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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

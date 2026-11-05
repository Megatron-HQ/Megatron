import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { useUsageProjects } from '@/lib/use-usage-projects'
import type {
  ContextSection,
  RecordedCacheControl,
  RecordedRequest,
  RecordedTextBlock
} from '../../../../shared/ipc'
import type { DrillTarget, RecordedView } from './resident-drill'

function percentOf(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  const percent = (part / whole) * 100
  return percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`
}

function formatChars(chars: number): string {
  return `${chars.toLocaleString()} chars`
}

function formatCacheControl(cache: RecordedCacheControl): string {
  return ['cached', cache.ttl, cache.scope].filter(Boolean).join(' · ')
}

export function ResidentDrillDialog({
  target,
  open,
  onOpenChange,
  onRestoreFocus
}: {
  target: DrillTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreFocus: () => void
}): React.JSX.Element | null {
  if (!target) return null
  const deferred = target.category.group === 'deferred'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        // Radix would focus the first expandable row; land on Close so Escape closes at once.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          content.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[16px]">{target.category.name}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {deferred
              ? `${target.category.display} tokens if loaded. Claude Code keeps these out of context until Claude searches for them.`
              : `${target.category.display} tokens in the global baseline.`}
          </DialogDescription>
        </DialogHeader>
        {target.kind === 'section' ? (
          <SectionTable section={target.section} shared={target.shared} />
        ) : (
          <RecordedDetails key={target.category.name} initialView={target.view} open={open} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SectionTable({
  section,
  shared
}: {
  section: ContextSection
  shared: boolean
}): React.JSX.Element {
  const tokensIndex = section.columns.findIndex((column) => column.toLowerCase() === 'tokens')
  const rows = [...section.rows].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1))
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        Per-item tokens as Claude Code&apos;s /context reports them.
        {shared && ' This table lists loaded and deferred MCP tools together.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left text-[12px]">
          <thead>
            <tr className="h-7 border-b border-border text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {section.columns.map((column, index) => (
                <th
                  key={column}
                  className={cn(
                    'pr-3 font-medium',
                    index === tokensIndex && 'w-20 pr-0 text-right',
                    index === 0 && 'w-[45%]'
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.cells[0]}-${rowIndex}`} className="h-7 border-b border-border">
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    title={cell}
                    className={cn(
                      'truncate pr-3',
                      index === tokensIndex
                        ? 'pr-0 text-right font-mono tabular-nums text-muted-foreground'
                        : index === 0
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SYSTEM_VIEWS: { key: RecordedView; label: string }[] = [
  { key: 'blocks', label: 'System blocks' },
  { key: 'tools', label: 'Tools' },
  { key: 'breakpoints', label: 'Cache breakpoints' }
]

function RecordedDetails({
  initialView,
  open
}: {
  initialView: RecordedView
  open: boolean
}): React.JSX.Element {
  const [view, setView] = useState(initialView)
  const { resolveProjectLabel } = useUsageProjects()
  // Re-read on every open: the newest session changes as the user works, and nothing is kept.
  const { data, isPending, isError } = useQuery({
    queryKey: ['recorded-request'],
    queryFn: () => window.api.getRecordedRequest(),
    enabled: open,
    staleTime: 0,
    networkMode: 'always'
  })

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-64" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    )
  }
  if (isError) {
    return (
      <p role="alert" className="text-[13px] text-muted-foreground">
        Megatron couldn&apos;t read your latest Claude Code session.
      </p>
    )
  }
  if (data === null) {
    return (
      <div className="flex flex-col gap-1 py-6 text-center">
        <p className="text-[13px] font-medium">No interactive Claude Code 2.1.300+ session yet</p>
        <p className="text-[12px] text-muted-foreground">
          Details come from the first request of your newest interactive session. Headless (
          <span className="font-mono">-p</span>) runs don&apos;t count.
        </p>
      </div>
    )
  }

  const systemView = view === 'blocks' || view === 'tools' || view === 'breakpoints'
  // min-w-0: DialogContent is a grid, and a grid item won't shrink below its longest row.
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        <p className="flex flex-wrap gap-x-1.5">
          <span>From</span>
          <span title={data.cwd ?? undefined} className="text-foreground">
            {data.cwd === null ? 'an unknown folder' : resolveProjectLabel(data.cwd)}
          </span>
          <span aria-hidden>·</span>
          <span>{formatRelativeTime(data.requestedAt)}</span>
          <span aria-hidden>·</span>
          <span>Claude Code {data.claudeVersion}</span>
        </p>
        <p>
          The total is the global baseline. These details come from that session&apos;s first
          request, so they include its project&apos;s instructions and MCP servers.
        </p>
      </div>
      {systemView && (
        <div
          role="radiogroup"
          aria-label="System prompt detail"
          className="flex w-fit gap-1 rounded-md border border-border p-0.5"
        >
          {SYSTEM_VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === view}
              onClick={() => setView(key)}
              className={cn(
                'rounded-sm px-2 py-0.5 text-[12px] transition-colors',
                key === view
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <RecordedView view={view} request={data} />
    </div>
  )
}

function RecordedView({
  view,
  request
}: {
  view: RecordedView
  request: RecordedRequest
}): React.JSX.Element {
  if (view === 'blocks') {
    const total = request.systemBlocks.reduce((sum, block) => sum + block.chars, 0)
    return (
      <ExpandableList
        empty="That request recorded no system blocks."
        items={request.systemBlocks.map((block, index) => ({
          key: String(index),
          title: `Block ${index + 1}`,
          preview: block.text.trim().split('\n')[0],
          badge: block.cacheControl ? formatCacheControl(block.cacheControl) : null,
          meta: `${formatChars(block.chars)} · ${percentOf(block.chars, total)}`,
          body: block.text
        }))}
      />
    )
  }
  if (view === 'tools') {
    const total = request.tools.reduce((sum, tool) => sum + tool.chars, 0)
    return (
      <ExpandableList
        empty="That request sent no tool definitions."
        items={request.tools.map((tool) => ({
          key: tool.name,
          title: tool.name,
          preview: null,
          badge: tool.isMcp ? 'MCP' : null,
          meta: `${formatChars(tool.chars)} · ${percentOf(tool.chars, total)}`,
          body: tool.definitionJson
        }))}
      />
    )
  }
  if (view === 'breakpoints') {
    if (request.cacheBreakpoints.length === 0) {
      return <p className="text-[12px] text-muted-foreground">That request set no breakpoints.</p>
    }
    return (
      <div className="flex flex-col divide-y divide-border border-y border-border">
        {request.cacheBreakpoints.map((breakpoint) => (
          <div key={breakpoint.path} className="flex h-8 items-center justify-between gap-3">
            <span className="font-mono text-[12px] text-foreground">{breakpoint.path}</span>
            <span className="text-[11px] text-muted-foreground">
              {formatCacheControl(breakpoint.cacheControl)}
            </span>
          </div>
        ))}
      </div>
    )
  }
  const blocks = view === 'hooks' ? request.hookOutputs : request.mcpInstructions
  return <TextBlocks blocks={blocks} view={view} />
}

function TextBlocks({
  blocks,
  view
}: {
  blocks: RecordedTextBlock[]
  view: 'hooks' | 'mcp'
}): React.JSX.Element {
  const total = blocks.reduce((sum, block) => sum + block.chars, 0)
  return (
    <ExpandableList
      empty={
        view === 'hooks'
          ? 'That session had no SessionStart hook output.'
          : 'That session had no MCP server instructions.'
      }
      items={blocks.map((block) => ({
        key: block.name,
        title: block.name,
        preview: null,
        badge: null,
        meta: `${formatChars(block.chars)} · ${percentOf(block.chars, total)}`,
        body: block.text
      }))}
    />
  )
}

function ExpandableList({
  items,
  empty
}: {
  items: {
    key: string
    title: string
    preview: string | null
    badge: string | null
    meta: string
    body: string
  }[]
  empty: string
}): React.JSX.Element {
  if (items.length === 0) return <p className="text-[12px] text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-col divide-y divide-border border-y border-border">
      {items.map((item) => (
        <details key={item.key} className="group">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm py-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden
              className="text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
            <span className="shrink-0 font-medium text-foreground">{item.title}</span>
            {item.badge && (
              <span className="shrink-0 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">
                {item.badge}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.preview}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {item.meta}
            </span>
          </summary>
          <pre className="mb-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {item.body}
          </pre>
        </details>
      ))}
    </div>
  )
}

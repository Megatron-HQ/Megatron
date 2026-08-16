import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { FileTree } from '@/components/FileTree'
import { SourceBadge } from '@/components/SourceBadge'
import { Input } from '@/components/ui/input'
import { TREE_WIDTH_MAX, TREE_WIDTH_MIN, TREE_WIDTH_STEP } from '@/lib/file-tree'
import { cn } from '@/lib/utils'

interface SkillFileViewerProps {
  skillId: number
  treeWidth: number
  onTreeWidthChange: (width: number) => void
  onClose: () => void
}

export function SkillFileViewer({
  skillId,
  treeWidth,
  onTreeWidthChange,
  onClose
}: SkillFileViewerProps): React.JSX.Element {
  const { data, isPending } = useQuery({
    queryKey: ['skill-files', skillId],
    queryFn: () => window.api.openSkill(skillId)
  })

  const files = useMemo(() => data?.files ?? [], [data])
  const [explicitSelection, setExplicitSelection] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const selectedFile = useMemo(() => {
    if (explicitSelection !== null) {
      return files.find((f) => f.relativePath === explicitSelection) ?? null
    }
    return files.find((f) => f.relativePath === 'SKILL.md') ?? files[0] ?? null
  }, [files, explicitSelection])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (searchQuery) {
        setSearchQuery('')
        return
      }
      onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, searchQuery])

  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, width: treeWidth })

  const handleDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      draggingRef.current = true
      dragStartRef.current = { x: event.clientX, width: treeWidth }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [treeWidth]
  )

  const handleDividerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!draggingRef.current) return
      const delta = event.clientX - dragStartRef.current.x
      const next = Math.min(
        TREE_WIDTH_MAX,
        Math.max(TREE_WIDTH_MIN, dragStartRef.current.width + delta)
      )
      onTreeWidthChange(next)
    },
    [onTreeWidthChange]
  )

  const handleDividerPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  const handleDividerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onTreeWidthChange(Math.max(TREE_WIDTH_MIN, treeWidth - TREE_WIDTH_STEP))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onTreeWidthChange(Math.min(TREE_WIDTH_MAX, treeWidth + TREE_WIDTH_STEP))
      }
    },
    [onTreeWidthChange, treeWidth]
  )

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Skill not found</p>
        <p className="max-w-[320px] text-sm text-muted-foreground">
          It may have been removed since the last scan.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded-md bg-accent-lime px-3 py-1.5 text-sm text-accent-lime-foreground"
        >
          Back to skills
        </button>
      </div>
    )
  }

  const { skill } = data

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to skills"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-base font-semibold">{skill.name}</h2>
          <SourceBadge type={skill.source_type} />
          <span className="truncate font-mono text-xs text-muted-foreground">
            {skill.source_path}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex shrink-0 flex-col overflow-hidden border-r border-border"
          style={{ width: treeWidth }}
        >
          <div className="relative shrink-0 px-2 py-2">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter files…"
              aria-label="Filter skill files"
              className="h-7 pl-7 text-[13px]"
            />
          </div>
          <FileTree
            files={files}
            searchQuery={searchQuery}
            selectedPath={selectedFile?.relativePath ?? null}
            onSelectFile={setExplicitSelection}
          />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={treeWidth}
          aria-valuemin={TREE_WIDTH_MIN}
          aria-valuemax={TREE_WIDTH_MAX}
          aria-label="Resize file tree"
          tabIndex={0}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onKeyDown={handleDividerKeyDown}
          className={cn(
            'w-1 shrink-0 cursor-col-resize touch-none',
            'hover:bg-ring focus-visible:bg-ring focus-visible:outline-none'
          )}
        />

        <div className="min-w-0 flex-1 overflow-auto p-4">
          {selectedFile === null ? (
            <p className="text-sm text-muted-foreground">No files found.</p>
          ) : selectedFile.status === 'ok' ? (
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
              {selectedFile.content}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              {selectedFile.status === 'too_large'
                ? 'File too large to preview.'
                : 'Binary or unreadable file — no preview available.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

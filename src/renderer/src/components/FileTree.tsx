import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { motion } from 'motion/react'
import { resolveFileIcon } from '@/lib/file-icon'
import {
  buildTree,
  collectMatchingIds,
  flattenVisible,
  type FlatRow,
  type TreeNode
} from '@/lib/file-tree'
import { useGlideHighlight } from '@/lib/use-glide-highlight'
import { cn } from '@/lib/utils'
import type { SkillFile } from '../../../shared/ipc'

const ROW_HEIGHT = 28
const BASE_PADDING = 12
const INDENT_SIZE = 16

interface FileTreeProps {
  files: SkillFile[]
  searchQuery: string
  selectedPath: string | null
  onSelectFile: (relativePath: string) => void
}

function findParentIndex(rows: FlatRow[], index: number): number | null {
  const depth = rows[index].node.depth
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].node.depth < depth) return i
  }
  return null
}

export function FileTree({
  files,
  searchQuery,
  selectedPath,
  onSelectFile
}: FileTreeProps): React.JSX.Element {
  const { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition } =
    useGlideHighlight<string>()
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocusId = useRef<string | null>(null)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(files), [files])
  const matchingIds = useMemo(() => collectMatchingIds(tree, searchQuery), [tree, searchQuery])
  const rows = useMemo(
    () => flattenVisible(tree, expandedIds, matchingIds),
    [tree, expandedIds, matchingIds]
  )

  // TanStack Virtual exposes imperative methods that React Compiler must not memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  })

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedId(null)
      return
    }
    if (!focusedId || !rows.some((row) => row.node.id === focusedId)) {
      setFocusedId(rows[0].node.id)
    }
  }, [rows, focusedId])

  useEffect(() => {
    if (!pendingFocusId.current) return
    const button = rowRefs.current.get(pendingFocusId.current)
    if (button) {
      button.focus()
      pendingFocusId.current = null
    }
  })

  const toggleExpanded = useCallback((id: string): void => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const moveFocus = useCallback(
    (nextIndex: number): void => {
      if (rows.length === 0) return
      const clamped = Math.max(0, Math.min(nextIndex, rows.length - 1))
      const targetId = rows[clamped].node.id
      setFocusedId(targetId)
      rowVirtualizer.scrollToIndex(clamped, { align: 'auto' })
      const mounted = rowRefs.current.get(targetId)
      if (mounted) {
        mounted.focus()
      } else {
        pendingFocusId.current = targetId
      }
    },
    [rows, rowVirtualizer]
  )

  const activateNode = useCallback(
    (node: TreeNode): void => {
      if (node.isDirectory) {
        toggleExpanded(node.id)
      } else if (node.file) {
        onSelectFile(node.file.relativePath)
      }
    },
    [onSelectFile, toggleExpanded]
  )

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, row: FlatRow, index: number): void => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveFocus(index + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveFocus(index - 1)
          break
        case 'ArrowRight':
          event.preventDefault()
          if (!row.node.isDirectory) break
          if (expandedIds.has(row.node.id)) moveFocus(index + 1)
          else toggleExpanded(row.node.id)
          break
        case 'ArrowLeft': {
          event.preventDefault()
          if (row.node.isDirectory && expandedIds.has(row.node.id)) {
            toggleExpanded(row.node.id)
            break
          }
          const parentIndex = findParentIndex(rows, index)
          if (parentIndex !== null) moveFocus(parentIndex)
          break
        }
        case 'Home':
          event.preventDefault()
          moveFocus(0)
          break
        case 'End':
          event.preventDefault()
          moveFocus(rows.length - 1)
          break
        case 'Enter':
        case ' ':
          event.preventDefault()
          activateNode(row.node)
          break
        default:
          break
      }
    },
    [activateNode, expandedIds, moveFocus, rows, toggleExpanded]
  )

  const highlightId = hoveredId ?? focusedId
  const highlightIndex = highlightId ? rows.findIndex((row) => row.node.id === highlightId) : -1

  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        {searchQuery.trim() ? `No files match "${searchQuery.trim()}"` : 'No files found.'}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Skill files"
      className="relative flex-1 overflow-auto py-1"
      onMouseLeave={onMouseLeave}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {highlightIndex >= 0 && (
          <motion.div
            className="absolute inset-x-1 z-0 rounded-md bg-accent"
            initial={false}
            animate={{ top: highlightIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            transition={transition}
          />
        )}
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          const { node, siblingIndex, siblingCount } = row
          const isOpen = node.isDirectory && expandedIds.has(node.id)
          const isSelected = !node.isDirectory && node.file?.relativePath === selectedPath
          const Icon = node.isDirectory ? null : resolveFileIcon(node.label)

          return (
            <motion.div
              key={node.id}
              className="absolute inset-x-0 z-10"
              style={{ top: virtualRow.start, height: ROW_HEIGHT }}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
            >
              <button
                ref={(el) => {
                  if (el) rowRefs.current.set(node.id, el)
                  else rowRefs.current.delete(node.id)
                }}
                type="button"
                role="treeitem"
                aria-expanded={node.isDirectory ? isOpen : undefined}
                aria-selected={isSelected}
                aria-level={node.depth + 1}
                aria-posinset={siblingIndex + 1}
                aria-setsize={siblingCount}
                tabIndex={focusedId === node.id ? 0 : -1}
                style={{ paddingLeft: BASE_PADDING + node.depth * INDENT_SIZE }}
                onClick={() => activateNode(node)}
                onFocus={() => setFocusedId(node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onKeyDown={(event) => handleRowKeyDown(event, row, virtualRow.index)}
                className={cn(
                  'flex h-full w-full items-center gap-1.5 truncate pr-3 text-left font-mono text-[13px] focus-visible:outline-none',
                  isSelected ? 'font-medium text-foreground' : 'text-muted-foreground',
                  'hover:text-foreground focus-visible:text-foreground'
                )}
              >
                {node.isDirectory ? (
                  <>
                    <motion.span
                      className="inline-flex shrink-0"
                      animate={{ rotate: isOpen ? 90 : 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 500, damping: 30 }
                      }
                    >
                      <ChevronRight className="size-3.5" />
                    </motion.span>
                    {isOpen ? (
                      <FolderOpen className="size-3.5 shrink-0" />
                    ) : (
                      <Folder className="size-3.5 shrink-0" />
                    )}
                  </>
                ) : (
                  <>
                    <span className="inline-block size-3.5 shrink-0" />
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                  </>
                )}
                <span className="truncate" title={node.label}>
                  {node.label}
                </span>
              </button>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

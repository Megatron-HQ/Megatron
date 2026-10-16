import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronRight, CircleAlert, FolderGit2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectTreeNode } from '@/lib/project-tree'
import { normalizeProjectPath } from '../../../shared/project-path'
import { cn } from '@/lib/utils'

interface Selection {
  path?: string
  exact?: boolean
}
interface ProjectNavigationProps {
  nodes: ProjectTreeNode[]
  selected: boolean
  selection: Selection
  expanded: Set<string>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  onSelect: (path?: string, exact?: boolean) => void
  onItemHover: (element: HTMLElement | null) => void
  unknown?: { count: number; selected: boolean; onSelect: () => void }
}

const GROUP_KEY = '$projects'
const IDLE = 'text-muted-foreground hover:text-accent-foreground'
const SELECTED = 'bg-accent-lime text-accent-lime-foreground'
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ProjectNavigation(props: ProjectNavigationProps): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const { nodes, selected, selection, expanded, setExpanded, onSelect, onItemHover, unknown } =
    props
  const toggle = (key: string): void => {
    setExpanded((before) => {
      const next = new Set(before)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    onItemHover(null)
  }
  const open = (key: string): void => {
    setExpanded((before) => new Set(before).add(key))
    onItemHover(null)
  }
  const total = nodes.reduce((sum, node) => sum + node.count, 0) + (unknown?.count ?? 0)
  return (
    <div className="flex min-w-0 flex-col">
      <div
        onMouseEnter={(event) => onItemHover(event.currentTarget)}
        className={cn(
          'relative z-10 flex h-8 items-center rounded-md px-2 text-sm transition-colors',
          selected && !selection.path ? SELECTED : selected ? 'text-foreground' : IDLE
        )}
      >
        <button
          type="button"
          aria-label="Projects"
          onClick={() => {
            onSelect()
            open(GROUP_KEY)
          }}
          className={cn('flex h-full min-w-0 flex-1 items-center gap-2 text-left', FOCUS)}
        >
          <FolderGit2 className="size-4 shrink-0" />
          <span>Projects</span>
          <Count count={total} selected={selected && !selection.path} />
        </button>
        <Disclosure
          label="project list"
          expanded={expanded.has(GROUP_KEY)}
          onClick={() => toggle(GROUP_KEY)}
        />
      </div>
      <Children open={expanded.has(GROUP_KEY)} reduceMotion={!!reduceMotion}>
        <div className="my-0.5 ml-3 flex min-w-0 flex-col gap-0.5 border-l border-border/70 py-0.5 pl-2">
          {nodes.length === 0 && !unknown?.count && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground italic">No project folders</p>
          )}
          {nodes.map((node) => (
            <ProjectNode
              key={node.key}
              node={node}
              depth={0}
              navigation={props}
              reduceMotion={!!reduceMotion}
              onToggle={toggle}
              onOpen={open}
            />
          ))}
          {!!unknown?.count && (
            <button
              type="button"
              onClick={unknown.onSelect}
              onMouseEnter={(event) => onItemHover(event.currentTarget)}
              className={cn(
                'relative z-10 flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs',
                FOCUS,
                unknown.selected ? SELECTED : IDLE
              )}
            >
              <span className="truncate">Unknown project</span>
              <Count count={unknown.count} selected={unknown.selected} />
            </button>
          )}
        </div>
      </Children>
    </div>
  )
}

function ProjectNode({
  node,
  depth,
  navigation,
  reduceMotion,
  onToggle,
  onOpen
}: {
  node: ProjectTreeNode
  depth: number
  navigation: ProjectNavigationProps
  reduceMotion: boolean
  onToggle: (key: string) => void
  onOpen: (key: string) => void
}): React.JSX.Element {
  const { selected, selection, expanded, onSelect, onItemHover } = navigation
  const hasChildren = node.children.length > 0
  const exact = !hasChildren && node.kind === 'repository'
  const samePath = selection.path !== undefined && normalizeProjectPath(selection.path) === node.key
  const isSelected = selected && samePath && !!selection.exact === exact
  const unavailable = node.status !== 'available'
  return (
    <div className="flex min-w-0 flex-col">
      <div
        title={`${node.path}${unavailable ? ` — ${node.status === 'needs_access' ? 'Folder access required' : 'Unavailable; showing cached data'}` : ''}`}
        onMouseEnter={(event) => onItemHover(event.currentTarget)}
        className={cn(
          'relative z-10 flex h-7 min-w-0 items-center gap-1 rounded-md px-2 text-xs transition-colors',
          isSelected ? SELECTED : IDLE
        )}
      >
        <button
          type="button"
          onClick={() => {
            onSelect(node.path, exact)
            if (hasChildren) onOpen(node.key)
          }}
          className={cn('flex h-full min-w-0 flex-1 items-center gap-1.5 text-left', FOCUS)}
        >
          <span className="truncate">{node.label}</span>
          {unavailable && (
            <CircleAlert
              className="size-3 shrink-0"
              aria-label={node.status === 'needs_access' ? 'Needs folder access' : 'Unavailable'}
            />
          )}
          <Count count={node.count} selected={isSelected} />
        </button>
        {hasChildren && (
          <Disclosure
            label={`${node.label} repositories`}
            expanded={expanded.has(node.key)}
            onClick={() => onToggle(node.key)}
          />
        )}
      </div>
      {hasChildren && (
        <Children open={expanded.has(node.key)} reduceMotion={reduceMotion}>
          <div
            className={cn(
              'my-0.5 flex min-w-0 flex-col gap-0.5',
              depth < 2 && 'ml-3 border-l border-border/70 pl-2'
            )}
          >
            {node.directCount > 0 && (
              <button
                type="button"
                title={`${node.path} — direct items only`}
                onClick={() => onSelect(node.path, true)}
                onMouseEnter={(event) => onItemHover(event.currentTarget)}
                className={cn(
                  'relative z-10 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs',
                  FOCUS,
                  selected && samePath && selection.exact ? SELECTED : IDLE
                )}
              >
                <span className="truncate">This folder</span>
                <Count
                  count={node.directCount}
                  selected={selected && samePath && !!selection.exact}
                />
              </button>
            )}
            {node.children.map((child) => (
              <ProjectNode
                key={child.key}
                node={child}
                depth={depth + 1}
                navigation={navigation}
                reduceMotion={reduceMotion}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        </Children>
      )}
    </div>
  )
}

function Count({ count, selected }: { count: number; selected: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded px-1.5 font-mono text-[12px] tabular-nums',
        selected ? 'bg-accent-lime-foreground/15' : 'bg-muted text-muted-foreground'
      )}
    >
      {count}
    </span>
  )
}

function Disclosure({
  label,
  expanded,
  onClick
}: {
  label: string
  expanded: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
      className={cn('-mr-1 shrink-0 rounded p-1', FOCUS)}
    >
      <ChevronRight
        className={cn(
          'size-3.5 transition-transform duration-200 motion-reduce:transition-none',
          expanded && 'rotate-90'
        )}
      />
    </button>
  )
}

function Children({
  open,
  reduceMotion,
  children
}: {
  open: boolean
  reduceMotion: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
          className="min-w-0 overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

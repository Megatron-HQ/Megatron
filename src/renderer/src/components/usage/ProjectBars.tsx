import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFolderBasename } from '@/lib/source-name'
import { cn } from '@/lib/utils'
import type { ActivityProjectCount } from '../../../../shared/ipc'

const TOP_N = 8

interface ProjectBarsProps {
  byProject: ActivityProjectCount[]
}

// Horizontal bar list on --surface-muted tracks. Top 8, remainder folded into one disclosure
// row. The long tail renders as honestly tiny slivers against the dominant project — the skew
// is the point, so no log scale. Not clickable in PR1.
export function ProjectBars({ byProject }: ProjectBarsProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)

  const max = Math.max(1, ...byProject.map((p) => p.count))
  const head = byProject.slice(0, TOP_N)
  const rest = byProject.slice(TOP_N)
  const restCount = rest.reduce((sum, p) => sum + p.count, 0)

  const row = (project: ActivityProjectCount, index: number): React.JSX.Element => (
    <div
      key={project.project}
      className="flex h-7 items-center gap-3"
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="w-[38%] shrink-0 truncate text-[13px]">
            {getFolderBasename(project.project)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{project.project}</TooltipContent>
      </Tooltip>
      <div className="h-2 flex-1 overflow-hidden rounded-[1px] bg-muted">
        <motion.div
          className={cn(
            'h-full rounded-[1px] bg-usage-bar',
            hovered !== null && hovered !== index && 'opacity-40'
          )}
          style={{ transformOrigin: 'left' }}
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: 1, width: `${(project.count / max) * 100}%` }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.32, ease: 'easeOut', delay: Math.min(index * 0.024, 0.3) }
          }
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {project.count.toLocaleString()}
      </span>
    </div>
  )

  return (
    <div className="flex flex-col">
      {head.map(row)}

      <AnimatePresence initial={false}>
        {expanded && rest.length > 0 && (
          <motion.div
            className="overflow-hidden"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {rest.map((project, i) => row(project, TOP_N + i))}
          </motion.div>
        )}
      </AnimatePresence>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
        >
          {expanded
            ? 'Show fewer'
            : `+ ${rest.length} more project${rest.length === 1 ? '' : 's'} · ${restCount.toLocaleString()} prompts`}
        </button>
      )}
    </div>
  )
}

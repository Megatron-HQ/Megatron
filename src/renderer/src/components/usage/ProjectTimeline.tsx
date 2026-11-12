import { useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import { ProjectName } from '@/components/ProjectName'
import type { UsageCalendar } from '../../../../shared/ipc'
import { formatCount, quantileOpacity } from './chart-utils'
import { percentLabel } from './share-bars'
import { useUsageProjects } from '@/lib/use-usage-projects'
import { ProjectSearch } from './ProjectSearch'
import { matchesUsageProjectSearch } from '../../../../shared/usage-projects'
import { CLAUDE_APP_CHATS_LABEL, splitClaudeAppChats } from '@/lib/claude-app-chats'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const VISIBLE_PROJECTS = 8

interface TimelineRow {
  key: string
  label: string
  tooltip: string
  total: number
  byMonth: number[]
  chat?: boolean // one Claude app chat, shown inside the group: free-text title, indented
  group?: boolean // the Claude app chats group row
}

export function ProjectTimeline({
  data,
  resolveProjectLabel
}: {
  data: UsageCalendar
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const [chatsOpen, setChatsOpen] = useState(false)
  const { projectTooltip } = useUsageProjects()
  const [focusedCell, setFocusedCell] = useState<string | null>(null)
  const cells = useRef(new Map<string, HTMLSpanElement>())
  const opacity = useMemo(
    () => quantileOpacity(data.byProject.flatMap((project) => project.byMonth)),
    [data.byProject]
  )
  const needle = search.trim().toLowerCase()
  const split = splitClaudeAppChats(data.byProject, (project) => project.project)
  const toRow = (project: UsageCalendar['byProject'][number], chat = false): TimelineRow => ({
    key: project.project,
    label: resolveProjectLabel(project.project),
    tooltip: projectTooltip(project.project),
    total: project.total,
    byMonth: project.byMonth,
    chat
  })
  const matchesNeedle = (row: TimelineRow): boolean =>
    matchesUsageProjectSearch(needle, [row.label, ...row.tooltip.split('\n')])
  const matching = split.rows.map((project) => toRow(project)).filter(matchesNeedle)
  const chats = split.chats.map((project) => toRow(project, true))
  const groupMatches = matchesUsageProjectSearch(needle, [CLAUDE_APP_CHATS_LABEL])
  const matchingChats = groupMatches ? chats : chats.filter(matchesNeedle)
  if (matchingChats.length > 0) {
    const count = split.chats.filter((project) => project.total > 0).length
    const total = split.chats.reduce((sum, project) => sum + project.total, 0)
    const rank = matching.findIndex((row) => row.total < total)
    matching.splice(rank < 0 ? matching.length : rank, 0, {
      key: CLAUDE_APP_CHATS_LABEL,
      label: `${CLAUDE_APP_CHATS_LABEL} (${count})`,
      tooltip: `${count} chat${count === 1 ? '' : 's'} started in the Claude app without a project folder`,
      total,
      byMonth: MONTHS.map((_, index) =>
        split.chats.reduce((sum, project) => sum + project.byMonth[index], 0)
      ),
      group: true
    })
  }
  const showChats = chatsOpen || (needle !== '' && !groupMatches)
  const projects = (expanded || needle ? matching : matching.slice(0, VISIBLE_PROJECTS)).flatMap(
    (row) => (row.group && showChats ? [row, ...matchingChats] : [row])
  )
  const topLevelCount = split.rows.length + (split.chats.length > 0 ? 1 : 0)
  const firstMonth = data.months.findIndex((month) => month.coverage !== 'future')
  const tabCell =
    focusedCell !== null && Number(focusedCell.split(':')[0]) < projects.length
      ? focusedCell
      : `0:${firstMonth}`

  return (
    <section aria-label="Project timeline" className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-semibold">Project timeline</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Where your attention went, month by month · recorded prompts
        </p>
      </div>
      {data.byProject.length > 0 && (
        <ProjectSearch
          value={search}
          onChange={(value) => {
            setSearch(value)
            setFocusedCell(null)
          }}
          visible={projects.filter((row) => !row.chat).length}
          total={topLevelCount}
          label="Search project timeline"
        />
      )}
      {projects.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          {needle
            ? 'No matching projects.'
            : data.summary.observedDays === 0
              ? 'Project activity is unavailable for this year.'
              : 'No project prompts recorded in this year.'}
        </p>
      ) : (
        <>
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">Monthly project prompts in {data.year}</caption>
            <colgroup>
              <col className="w-[24%]" />
              {MONTHS.map((month) => (
                <col key={month} />
              ))}
              <col className="w-[12%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-[10px] text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-medium">
                  Project
                </th>
                {MONTHS.map((month) => (
                  <th key={month} scope="col" className="pb-2 text-center font-normal">
                    {month}
                  </th>
                ))}
                <th scope="col" className="pb-2 text-right font-medium">
                  Year
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project, rowIndex) => (
                <tr key={project.key} className="border-b border-border/60">
                  <th
                    scope="row"
                    className={cn(
                      'py-2 pr-3 text-left text-[12px] font-normal',
                      project.chat && 'pl-4'
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {project.group ? (
                          <button
                            type="button"
                            onClick={() => setChatsOpen((open) => !open)}
                            aria-expanded={showChats}
                            className="flex w-full min-w-0 items-center gap-1 rounded-[2px] text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn(
                                'size-3 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none',
                                showChats && 'rotate-90'
                              )}
                            />
                            <span className="truncate">{project.label}</span>
                          </button>
                        ) : (
                          <span
                            tabIndex={0}
                            className="flex min-w-0 rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {project.chat ? (
                              <span className="min-w-0 truncate">{project.label}</span>
                            ) : (
                              <ProjectName label={project.label} />
                            )}
                          </span>
                        )}
                      </TooltipTrigger>
                      <TooltipContent className="whitespace-pre-line">
                        {project.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  {data.months.map((month, monthIndex) => {
                    const count = project.byMonth[monthIndex]
                    const key = `${rowIndex}:${monthIndex}`
                    const unavailable = month.coverage === 'unavailable' && count === 0
                    const valueLabel = unavailable
                      ? 'Unavailable'
                      : `${formatCount(count)} recorded prompts`
                    const share =
                      !unavailable && month.count > 0
                        ? `${percentLabel(count, month.count)} of this month’s prompts`
                        : null
                    const partial = month.coverage === 'partial'
                    const label = `${project.label} · ${MONTHS[monthIndex]} ${data.year} · ${valueLabel}${share ? ` · ${share}` : ''}${partial ? ' · Partial history' : ''}`
                    return (
                      <td key={month.month} className="px-[2px] py-2">
                        {month.coverage === 'future' ? (
                          <span
                            className="block h-5"
                            aria-label={`${MONTHS[monthIndex]} ${data.year} · Future month`}
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="img"
                                aria-label={label}
                                tabIndex={key === tabCell ? 0 : -1}
                                ref={(element) => {
                                  if (element) cells.current.set(key, element)
                                  else cells.current.delete(key)
                                }}
                                onFocus={() => setFocusedCell(key)}
                                onKeyDown={(event) => {
                                  const offset = {
                                    ArrowLeft: [0, -1],
                                    ArrowRight: [0, 1],
                                    ArrowUp: [-1, 0],
                                    ArrowDown: [1, 0]
                                  }[event.key]
                                  if (!offset) return
                                  event.preventDefault()
                                  cells.current
                                    .get(`${rowIndex + offset[0]}:${monthIndex + offset[1]}`)
                                    ?.focus()
                                }}
                                className={cn(
                                  'relative block h-5 overflow-hidden rounded-[2px] border border-border/60 bg-muted outline-none hover:ring-1 hover:ring-usage-bar focus-visible:ring-2 focus-visible:ring-ring',
                                  unavailable && 'border-dashed bg-transparent'
                                )}
                              >
                                {/* Sweeps in from the left, staggered, and settles on its
                                    data shade, like the Resident tax bar. */}
                                {count > 0 && (
                                  <motion.span
                                    aria-hidden
                                    className="absolute inset-0 origin-left bg-usage-bar"
                                    initial={reduceMotion ? false : { opacity: 0, scaleX: 0 }}
                                    animate={{ opacity: opacity(count), scaleX: 1 }}
                                    transition={
                                      reduceMotion
                                        ? { duration: 0 }
                                        : {
                                            duration: 0.32,
                                            ease: 'easeOut',
                                            delay: Math.min((rowIndex + monthIndex) * 0.012, 0.36)
                                          }
                                    }
                                  />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {project.label} · {MONTHS[monthIndex]} {data.year}
                              </p>
                              <p className="mt-1">{valueLabel}</p>
                              {share && <p className="mt-1 opacity-75">{share}</p>}
                              {partial && (
                                <p className="mt-1 opacity-75">
                                  Partial history · recorded activity only
                                </p>
                              )}
                              {month.coverage === 'unavailable' && count > 0 && (
                                <p className="mt-1 opacity-75">
                                  Month coverage unavailable · recorded activity only
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </td>
                    )
                  })}
                  <td className="py-2 pl-2 text-right font-mono text-[12px] tabular-nums">
                    {formatCount(project.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Stronger shading means more prompts · dashed cells: unavailable history</span>
            {!needle && matching.length > VISIBLE_PROJECTS && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="rounded-[2px] font-medium outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {expanded ? 'Show fewer' : `+ ${matching.length - VISIBLE_PROJECTS} more projects`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

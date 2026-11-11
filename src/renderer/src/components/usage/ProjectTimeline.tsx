import { useMemo, useRef, useState } from 'react'
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const VISIBLE_PROJECTS = 8

export function ProjectTimeline({
  data,
  resolveProjectLabel
}: {
  data: UsageCalendar
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const { projectTooltip } = useUsageProjects()
  const [focusedCell, setFocusedCell] = useState<string | null>(null)
  const cells = useRef(new Map<string, HTMLSpanElement>())
  const opacity = useMemo(
    () => quantileOpacity(data.byProject.flatMap((project) => project.byMonth)),
    [data.byProject]
  )
  const needle = search.trim().toLowerCase()
  const matching = data.byProject.filter((project) =>
    matchesUsageProjectSearch(needle, [
      resolveProjectLabel(project.project),
      ...projectTooltip(project.project).split('\n')
    ])
  )
  const projects = expanded || needle ? matching : matching.slice(0, VISIBLE_PROJECTS)
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
          visible={projects.length}
          total={data.byProject.length}
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
                <tr key={project.project} className="border-b border-border/60">
                  <th scope="row" className="py-2 pr-3 text-left text-[12px] font-normal">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className="flex min-w-0 rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <ProjectName label={resolveProjectLabel(project.project)} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="whitespace-pre-line">
                        {projectTooltip(project.project)}
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
                    const label = `${resolveProjectLabel(project.project)} · ${MONTHS[monthIndex]} ${data.year} · ${valueLabel}${share ? ` · ${share}` : ''}${partial ? ' · Partial history' : ''}`
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
                                {count > 0 && (
                                  <span
                                    aria-hidden
                                    className="absolute inset-0 bg-usage-bar"
                                    style={{ opacity: opacity(count) }}
                                  />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>
                                {resolveProjectLabel(project.project)} · {MONTHS[monthIndex]}{' '}
                                {data.year}
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
            {!needle && data.byProject.length > VISIBLE_PROJECTS && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="rounded-[2px] font-medium outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {expanded
                  ? 'Show fewer'
                  : `+ ${data.byProject.length - VISIBLE_PROJECTS} more projects`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BotOff,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitFork,
  Power,
  UserRound,
  Webhook
} from 'lucide-react'
import { LintFindingsPanel } from '@/components/LintFindingsPanel'
import { LintStatusBadge } from '@/components/LintStatusBadge'
import { SourceBadge } from '@/components/SourceBadge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseHookEvents } from '@/lib/hook-events'
import { hasDisableModelInvocationFrontmatter, parseExtraFrontmatterFields } from '@/lib/markdown'
import { formatRelativeTime } from '@/lib/relative-time'
import { getFolderBasename } from '@/lib/source-name'
import { cn } from '@/lib/utils'
import type {
  ProjectCount,
  RecentTrigger,
  SkillUsageDetail,
  TriggerType
} from '../../../shared/ipc'

interface SkillDetailProps {
  skillId: number
  onBack: () => void
  onViewFiles: () => void
  onNavigate: (id: number) => void
}

const TRIGGER_META: Record<TriggerType, { label: string; Icon: typeof UserRound }> = {
  user_invoked: { label: 'Manual', Icon: UserRound },
  autonomous: { label: 'Auto', Icon: Bot },
  subagent: { label: 'Subagent', Icon: GitFork }
}

// Fixed render order + texture fill for each trigger-mix segment. The bar stays monochrome
// (DESIGN.md forbids color-as-category) and tells the three types apart by pattern over one
// common ink shade — solid / faint diagonal hatch / faint dot grid, defined in main.css. The
// icon+label+count legend directly beneath it is what keeps this from being texture-alone.
const TRIGGER_BAR: { type: TriggerType; barClass: string }[] = [
  { type: 'user_invoked', barClass: 'trigger-fill-solid' },
  { type: 'autonomous', barClass: 'trigger-fill-hatch' },
  { type: 'subagent', barClass: 'trigger-fill-dots' }
]

const PROJECT_ROW_CAP = 6

export function SkillDetail({
  skillId,
  onBack,
  onViewFiles,
  onNavigate
}: SkillDetailProps): React.JSX.Element {
  const { data, isPending } = useQuery({
    queryKey: ['skill-meta', skillId],
    queryFn: () => window.api.openSkillMeta(skillId)
  })

  const extraFrontmatterFields = useMemo(
    () => (data?.skillMdContent ? parseExtraFrontmatterFields(data.skillMdContent) : []),
    [data]
  )
  const metadataEntries = useMemo(() => parseMetadataEntries(data?.skill.metadata_json), [data])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      onBack()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

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
        <Button
          onClick={onBack}
          className="mt-2 bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90"
        >
          Back to skills
        </Button>
      </div>
    )
  }

  const { skill, usage, findings = [] } = data

  // Mechanism is derived client-side from the SKILL.md the page already loaded — no schema field
  // backs it. skillMdContent === null (unreadable) means we can't tell, so we say nothing.
  const invocationMechanism =
    data.skillMdContent === null
      ? null
      : hasDisableModelInvocationFrontmatter(data.skillMdContent)
        ? 'via SKILL.md frontmatter'
        : 'via your /skills override'
  const invocationValue =
    invocationMechanism === null
      ? 'User-invocable only'
      : `User-invocable only · ${invocationMechanism}`

  const hookEvents = parseHookEvents(skill.hook_events).join(', ')
  const userInvocableOnly = skill.model_invocable === 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to skills"
            className="shrink-0 text-muted-foreground"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h2 className="min-w-0 truncate text-base font-semibold">{skill.name}</h2>
        </div>
        <Button
          onClick={onViewFiles}
          className="shrink-0 bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90 active:opacity-80"
        >
          <FolderOpen className="size-4" />
          View files
        </Button>
      </div>

      {skill.shadowed_by_skill_id !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">
            A global skill named &ldquo;{skill.name}&rdquo; always wins. This project skill can
            never run.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate(skill.shadowed_by_skill_id!)}
            className="shrink-0 border-warning/40 text-warning hover:bg-warning/20"
          >
            View global skill
          </Button>
        </div>
      )}

      <LintFindingsPanel key={skillId} skill={skill} findings={findings} />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-4 py-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <LintStatusBadge
              status={skill.lint_status}
              errorCount={skill.error_count}
              warningCount={skill.warning_count}
            />
            <SourceBadge
              type={skill.source_type}
              sourcePath={skill.source_path}
              pluginName={skill.plugin_name}
              isSynced={skill.is_synced === 1}
            />
            {skill.disabled_reason !== null && (
              <InfoChip
                icon={Power}
                iconClass="text-disabled-flag"
                label="Disabled"
                tooltip={
                  skill.disabled_reason === 'plugin'
                    ? 'Plugin is disabled — not loaded into context.'
                    : 'Disabled via /skills — not loaded into context.'
                }
              />
            )}
            {userInvocableOnly && (
              <InfoChip
                icon={BotOff}
                iconClass="text-muted-foreground"
                label="User-invocable only"
                tooltip={
                  <>
                    User-invocable only — Claude won&apos;t auto-invoke this. Run it with{' '}
                    <span className="font-mono">/{skill.name}</span>.
                  </>
                }
              />
            )}
            {skill.hook_events !== null && (
              <InfoChip
                icon={Webhook}
                iconClass="text-muted-foreground"
                label="Hooks"
                tooltip={`Also runs via hooks: ${hookEvents}`}
              />
            )}
          </div>

          <div className="grid grid-cols-5 border-y border-border">
            <StatCell
              label="Uses"
              value={
                skill.total_invocations === 0 ? 'Never' : skill.total_invocations.toLocaleString()
              }
            />
            <StatCell
              label="Listing tokens"
              // A user-invocable-only skill's description is kept out of the listing, so its
              // live listing cost is 0 — est_listing_tokens is only the hypothetical "if listed".
              value={userInvocableOnly ? '0' : skill.est_listing_tokens.toLocaleString()}
              title={
                userInvocableOnly
                  ? 'Not listed — user-invocable only, so no idle token cost.'
                  : undefined
              }
            />
            <StatCell label="Body tokens" value={skill.est_body_tokens.toLocaleString()} />
            <StatCell
              label="Last used"
              value={
                skill.last_invoked_at ? new Date(skill.last_invoked_at).toLocaleDateString() : '—'
              }
              title={
                skill.last_invoked_at ? new Date(skill.last_invoked_at).toLocaleString() : undefined
              }
            />
            {skill.modified_at ? (
              <StatCell
                label="Modified"
                value={new Date(skill.modified_at).toLocaleDateString()}
                title={new Date(skill.modified_at).toLocaleString()}
              />
            ) : (
              <StatCell
                label="Scanned"
                value={new Date(skill.last_scanned_at).toLocaleDateString()}
                title={new Date(skill.last_scanned_at).toLocaleString()}
              />
            )}
          </div>

          <section className="space-y-2" aria-labelledby="skill-description-heading">
            <p
              id="skill-description-heading"
              className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              Description
            </p>
            <p
              className={cn(
                'text-[13px] leading-relaxed',
                skill.description ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {skill.description ?? 'No description provided.'}
            </p>
          </section>

          <UsageSection usage={usage} isProjectSkill={skill.source_type === 'project'} />

          <section className="space-y-2" aria-labelledby="skill-details-heading">
            <p
              id="skill-details-heading"
              className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              Details
            </p>
            <dl className="grid gap-x-8 gap-y-2 min-[900px]:grid-cols-2">
              <DetailRow label="Path" value={skill.source_path} mono breakAll />
              {skill.hook_events !== null && <DetailRow label="Hooks" value={hookEvents} />}
              {userInvocableOnly && <DetailRow label="Invocation" value={invocationValue} />}
              {skill.disabled_reason !== null && (
                <DetailRow
                  label="Disabled"
                  value={skill.disabled_reason === 'plugin' ? 'Plugin' : '/skills override'}
                />
              )}
              {metadataEntries.map(([key, value]) => (
                <DetailRow
                  key={`meta-${key}`}
                  label={key}
                  value={formatMetadataValue(value)}
                  mono
                />
              ))}
              {extraFrontmatterFields.map(([key, value]) => (
                <DetailRow key={`fm-${key}`} label={key} value={String(value)} mono />
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

function parseMetadataEntries(metadataJson: string | null | undefined): [string, unknown][] {
  if (!metadataJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(metadataJson)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  return Object.entries(parsed as Record<string, unknown>)
}

function formatMetadataValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function InfoChip({
  icon: Icon,
  iconClass,
  label,
  tooltip
}: {
  icon: typeof Power
  iconClass: string
  label: string
  tooltip: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground select-none">
          <Icon className={cn('size-3 shrink-0', iconClass)} />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function StatCell({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 border-l border-border px-3 py-2.5 first:border-l-0 first:pl-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className="truncate text-base font-semibold font-mono tabular-nums text-foreground"
        title={title}
      >
        {value}
      </p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
  breakAll
}: {
  label: string
  value: string
  mono?: boolean
  breakAll?: boolean
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-[13px]">
      <dt className="break-words text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-foreground',
          breakAll ? 'break-all' : 'break-words',
          mono && 'font-mono text-xs'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function UsageSection({
  usage,
  isProjectSkill
}: {
  usage: SkillUsageDetail
  isProjectSkill: boolean
}): React.JSX.Element {
  const hasUsage = usage.byTriggerType.length > 0
  const total = usage.byTriggerType.reduce((sum, t) => sum + t.count, 0)
  const countFor = (type: TriggerType): number =>
    usage.byTriggerType.find((t) => t.trigger_type === type)?.count ?? 0

  return (
    <section className="space-y-3" aria-labelledby="skill-usage-heading">
      <p
        id="skill-usage-heading"
        className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        Usage
      </p>

      {!hasUsage ? (
        <p className="text-[13px] text-muted-foreground">No recorded uses yet.</p>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex h-3 w-full origin-left overflow-hidden rounded-full bg-muted animate-bar-grow motion-reduce:animate-none">
              {TRIGGER_BAR.map(({ type, barClass }) => {
                const count = countFor(type)
                if (count === 0) return null
                return (
                  <div
                    key={type}
                    className={cn('h-full', barClass)}
                    style={{ width: `${(count / total) * 100}%` }}
                  />
                )
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {TRIGGER_BAR.map(({ type }) => {
                const count = countFor(type)
                if (count === 0) return null
                const { label, Icon } = TRIGGER_META[type]
                return (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {label}
                    <span className="font-mono tabular-nums text-foreground">{count}</span>
                  </span>
                )
              })}
            </div>
          </div>

          {/* A project skill lives in exactly one project and its usage is already scoped to
              that root — the by-project breakdown would be a single self-referential row. */}
          {!isProjectSkill && usage.byProject.length > 0 && <ByProject rows={usage.byProject} />}

          {usage.recentTriggers.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Recent activity
              </p>
              <div className="divide-y divide-border">
                {usage.recentTriggers.map((trigger, index) => (
                  <RecentTriggerRow key={index} trigger={trigger} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Kept inline and self-contained: PR 2 lifts this row out into a shared, searchable
// lifetime-history surface once a second consumer exists.
function RecentTriggerRow({ trigger }: { trigger: RecentTrigger }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { label, Icon } = TRIGGER_META[trigger.trigger_type]
  const isCommand = trigger.preceding_user_text.startsWith('/')
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="py-2 text-[13px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Chevron className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={label} />
        <span
          className={cn(
            'min-w-0 flex-1 text-foreground',
            !expanded && 'line-clamp-2',
            isCommand && 'font-mono text-xs'
          )}
        >
          {trigger.preceding_user_text}
        </span>
        <time
          className="mt-px shrink-0 text-[11px] text-muted-foreground"
          dateTime={trigger.invoked_at}
          title={new Date(trigger.invoked_at).toLocaleString()}
        >
          {formatRelativeTime(trigger.invoked_at)}
        </time>
      </button>

      {expanded && (
        <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 pl-[3.25rem] text-[11px]">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="min-w-0 break-words text-foreground">
            {getFolderBasename(trigger.cwd) || trigger.cwd}
            {trigger.git_branch !== null && (
              <span className="text-muted-foreground"> · {trigger.git_branch}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">When</dt>
          <dd className="text-foreground">{new Date(trigger.invoked_at).toLocaleString()}</dd>
          {trigger.trigger_type === 'subagent' && trigger.agent_id !== null && (
            <>
              <dt className="text-muted-foreground">Subagent</dt>
              <dd className="min-w-0 break-words font-mono text-foreground">{trigger.agent_id}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}

function ByProject({ rows }: { rows: ProjectCount[] }): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => [...rows].sort((a, b) => b.count - a.count), [rows])
  const max = sorted[0]?.count ?? 1
  const visible = showAll ? sorted : sorted.slice(0, PROJECT_ROW_CAP)

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        By project
      </p>
      <div className="space-y-0.5">
        {visible.map((row) => {
          const label = getFolderBasename(row.cwd) || row.cwd
          const width = `${Math.max((row.count / max) * 100, 3)}%`
          return (
            <div
              key={row.cwd}
              className="grid grid-cols-[minmax(4rem,7rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1"
            >
              <span className="truncate text-[13px] text-foreground" title={row.cwd}>
                {label}
              </span>
              <span className="flex h-1.5 min-w-0 overflow-hidden rounded-full bg-muted">
                <span className="rounded-full bg-muted-foreground/60" style={{ width }} />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {row.count}
              </span>
            </div>
          )
        })}
      </div>
      {sorted.length > PROJECT_ROW_CAP && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          {showAll ? 'Show less' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  )
}

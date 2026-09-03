import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Bot, FolderOpen, GitFork, Power, UserRound } from 'lucide-react'
import { LintFindingsPanel } from '@/components/LintFindingsPanel'
import { LintStatusBadge } from '@/components/LintStatusBadge'
import { SourceBadge } from '@/components/SourceBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseHookEvents } from '@/lib/hook-events'
import { parseExtraFrontmatterFields } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import type { SkillUsageDetail } from '../../../shared/ipc'

interface SkillDetailProps {
  skillId: number
  onBack: () => void
  onViewFiles: () => void
  onNavigate: (id: number) => void
}

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
  const hookEvents = parseHookEvents(data?.skill.hook_events).join(', ')

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
          {skill.disabled_reason !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Power className="size-4 shrink-0 text-disabled-flag" />
              </TooltipTrigger>
              <TooltipContent>
                {skill.disabled_reason === 'plugin'
                  ? 'Plugin is disabled — not loaded into context.'
                  : 'Disabled via /skills — not loaded into context.'}
              </TooltipContent>
            </Tooltip>
          )}
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
          <section className="space-y-4" aria-label="Skill details">
            <div className="space-y-2">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Path
              </p>
              <div className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                <p className="break-all" title={skill.source_path}>
                  {skill.source_path}
                </p>
              </div>
            </div>

            <div className="space-y-2" aria-labelledby="skill-information-heading">
              <p
                id="skill-information-heading"
                className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                Skill information
              </p>
              <div className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
                {skill.description ?? 'No description provided.'}
              </div>
              {extraFrontmatterFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {extraFrontmatterFields.map(([key, value]) => (
                    <Badge key={key} variant="outline" className="max-w-full font-normal">
                      {key}: <span className="min-w-0 truncate font-mono">{String(value)}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-2" aria-labelledby="skill-summary-heading">
            <p
              id="skill-summary-heading"
              className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              Skill metrics
            </p>
            <Card className="shadow-none py-4">
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 min-[1100px]:grid-cols-3 min-[1350px]:grid-cols-4">
                <Stat
                  label="Est. listing tokens"
                  value={skill.est_listing_tokens.toLocaleString()}
                  mono
                />
                <Stat
                  label="Uses"
                  value={
                    skill.total_invocations === 0
                      ? 'Never'
                      : skill.total_invocations.toLocaleString()
                  }
                  mono
                />
                <Stat
                  label="Last used"
                  value={
                    skill.last_invoked_at
                      ? new Date(skill.last_invoked_at).toLocaleDateString()
                      : '—'
                  }
                  title={
                    skill.last_invoked_at
                      ? new Date(skill.last_invoked_at).toLocaleString()
                      : undefined
                  }
                />
                {skill.modified_at && (
                  <Stat
                    label="Modified"
                    value={new Date(skill.modified_at).toLocaleDateString()}
                    title={new Date(skill.modified_at).toLocaleString()}
                  />
                )}
                {skill.hook_events !== null && (
                  <Stat label="Hooks" value={hookEvents} title={hookEvents} />
                )}
                {skill.model_invocable === 0 && <Stat label="Model-invocable" value="No" />}
                {skill.disabled_reason !== null && (
                  <Stat
                    label="Disabled"
                    value={skill.disabled_reason === 'plugin' ? 'Plugin' : '/skills override'}
                  />
                )}
              </CardContent>
            </Card>
          </section>

          <div className="flex flex-col gap-6">
            {metadataEntries.length > 0 && (
              <section className="space-y-2" aria-labelledby="skill-metadata-heading">
                <p
                  id="skill-metadata-heading"
                  className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Metadata
                </p>
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
                    {metadataEntries.map(([key, value]) => (
                      <p key={key} className="min-w-0 break-all">
                        <span className="font-medium text-foreground">{key}:</span>{' '}
                        <span className="font-mono text-xs">{formatMetadataValue(value)}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <UsageBreakdown usage={usage} />
          </div>
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

function Stat({
  label,
  value,
  mono,
  title
}: {
  label: string
  value: string
  mono?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn('truncate text-[13px]', mono && 'font-mono text-xs tabular-nums')}
        title={title}
      >
        {value}
      </p>
    </div>
  )
}

function UsageBreakdown({ usage }: { usage: SkillUsageDetail }): React.JSX.Element {
  const hasUsage = usage.byTriggerType.length > 0
  return (
    <section className="space-y-2" aria-labelledby="skill-usage-heading">
      <p
        id="skill-usage-heading"
        className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        Usage
      </p>

      <div className="rounded-lg border border-border p-4">
        {!hasUsage ? (
          <p className="text-[13px] text-muted-foreground">No recorded uses yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Trigger breakdown
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {usage.byTriggerType.map((trigger) => {
                  const Icon =
                    trigger.trigger_type === 'user_invoked'
                      ? UserRound
                      : trigger.trigger_type === 'subagent'
                        ? GitFork
                        : Bot
                  const label =
                    trigger.trigger_type === 'user_invoked'
                      ? 'Manual'
                      : trigger.trigger_type === 'subagent'
                        ? 'Subagent'
                        : 'Auto'
                  return (
                    <Badge
                      key={trigger.trigger_type}
                      variant="outline"
                      className="gap-1.5 font-normal"
                    >
                      <Icon className="size-3" />
                      {label}: <span className="font-mono tabular-nums">{trigger.count}</span>
                    </Badge>
                  )
                })}
              </div>
            </div>

            {usage.byProject.length > 0 && (
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  By project
                </p>
                <div className="mt-2 space-y-1">
                  {usage.byProject.map((project) => (
                    <p
                      key={project.cwd}
                      className="truncate font-mono text-xs text-muted-foreground"
                    >
                      {project.cwd} — {project.count}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {usage.recentTriggers.length > 0 && (
              <div>
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Recent triggers
                </p>
                <div className="mt-2 divide-y divide-border">
                  {usage.recentTriggers.map((trigger, index) => {
                    const Icon =
                      trigger.trigger_type === 'user_invoked'
                        ? UserRound
                        : trigger.trigger_type === 'subagent'
                          ? GitFork
                          : Bot
                    const label =
                      trigger.trigger_type === 'user_invoked'
                        ? 'Manual'
                        : trigger.trigger_type === 'subagent'
                          ? 'Subagent'
                          : 'Auto'
                    return (
                      <div key={index} className="flex items-center gap-2 py-2 text-[13px]">
                        <span className="inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                          <Icon className="size-3" />
                          {label}
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-muted-foreground',
                            trigger.preceding_user_text.startsWith('/') && 'font-mono text-xs'
                          )}
                          title={trigger.preceding_user_text}
                        >
                          {trigger.preceding_user_text}
                        </span>
                        <time
                          className="shrink-0 text-[11px] text-muted-foreground"
                          dateTime={trigger.invoked_at}
                          title={new Date(trigger.invoked_at).toLocaleString()}
                        >
                          {new Date(trigger.invoked_at).toLocaleDateString()}
                        </time>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

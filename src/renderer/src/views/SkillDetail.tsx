import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, FolderOpen } from 'lucide-react'
import { LintFindingsPanel } from '@/components/LintFindingsPanel'
import { LintStatusBadge } from '@/components/LintStatusBadge'
import { SourceBadge } from '@/components/SourceBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
          <LintStatusBadge
            status={skill.lint_status}
            errorCount={skill.error_count}
            warningCount={skill.warning_count}
          />
          <SourceBadge
            type={skill.source_type}
            sourcePath={skill.source_path}
            pluginName={skill.plugin_name}
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
        <div className="flex flex-col gap-4 px-4 py-4 pl-10">
          <p className="truncate font-mono text-xs text-muted-foreground" title={skill.source_path}>
            {skill.source_path}
          </p>

          {skill.description && (
            <p className="max-w-[72ch] text-[13px] text-muted-foreground">{skill.description}</p>
          )}

          {extraFrontmatterFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {extraFrontmatterFields.map(([key, value]) => (
                <Badge key={key} variant="outline" className="font-normal">
                  {key}: <span className="font-mono">{String(value)}</span>
                </Badge>
              ))}
            </div>
          )}

          <Card className="shadow-none py-4">
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 sm:grid-cols-4">
              <Stat label="Est. tokens" value={skill.est_listing_tokens.toLocaleString()} mono />
              <Stat
                label="Uses"
                value={
                  skill.total_invocations === 0 ? 'Never' : skill.total_invocations.toLocaleString()
                }
                mono
              />
              <Stat
                label="Last used"
                value={
                  skill.last_invoked_at ? new Date(skill.last_invoked_at).toLocaleDateString() : '—'
                }
              />
              <Stat label="Path" value={skill.source_path} mono title={skill.source_path} />
            </CardContent>
          </Card>

          <UsageBreakdown usage={usage} />
        </div>
      </div>
    </div>
  )
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

function UsageBreakdown({ usage }: { usage: SkillUsageDetail }): React.JSX.Element | null {
  if (usage.byTriggerType.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Trigger breakdown
        </p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {usage.byTriggerType.map((t) => `${t.trigger_type}: ${t.count}`).join(' · ')}
        </p>
      </div>

      {usage.byProject.length > 0 && (
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            By project
          </p>
          {usage.byProject.map((p) => (
            <p key={p.cwd} className="truncate font-mono text-xs text-muted-foreground">
              {p.cwd} — {p.count}
            </p>
          ))}
        </div>
      )}

      {usage.recentTriggers.length > 0 && (
        <div>
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Recent triggers
          </p>
          {usage.recentTriggers.map((trigger, index) => (
            <p key={index} className="truncate text-[13px] text-muted-foreground">
              {trigger.preceding_user_text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

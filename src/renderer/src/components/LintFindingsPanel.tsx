import React, { useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LintFindingRow, SkillRow } from '../../../shared/ipc'

interface LintFindingsPanelProps {
  findings: LintFindingRow[]
  skill?: SkillRow
}

interface LinterRuleDefinition {
  id: string
  name: string
  description: string
  passDescription: string
  isApplicable: (skill?: SkillRow) => boolean
}

const LINTER_RULES: LinterRuleDefinition[] = [
  {
    id: 'yaml-frontmatter',
    name: 'YAML Frontmatter',
    description: 'Validates that SKILL.md begins with a valid YAML frontmatter block',
    passDescription: 'Frontmatter block is valid and properly formatted',
    isApplicable: (skill) => !skill || skill.source_type !== 'plugin'
  },
  {
    id: 'missing-description',
    name: 'Description Presence',
    description: 'Validates that a non-empty description is defined in the frontmatter',
    passDescription: 'Non-empty description present for trigger matching',
    isApplicable: (skill) => !skill || skill.source_type !== 'plugin'
  },
  {
    id: 'broken-file-paths',
    name: 'File Reference Integrity',
    description: 'Verifies referenced bundled scripts, docs, and assets exist on disk',
    passDescription: 'All referenced file and directory paths exist',
    isApplicable: () => true
  },
  {
    id: 'missing-mcp-server',
    name: 'MCP Server Availability',
    description: 'Checks that referenced MCP servers are configured in Claude settings',
    passDescription: 'All referenced MCP servers are configured',
    isApplicable: () => true
  },
  {
    id: 'name-collision',
    name: 'Name Collision & Shadowing',
    description: 'Checks if project skill is shadowed by a global skill of the same name',
    passDescription: 'No naming collisions or global shadowing detected',
    isApplicable: (skill) => skill?.source_type === 'project'
  }
]

function matchesRuleId(findingRuleId: string, targetRuleId: string): boolean {
  if (findingRuleId === targetRuleId) return true
  if (targetRuleId === 'broken-file-paths' && findingRuleId === 'broken-file-path') return true
  if (targetRuleId === 'missing-mcp-server' && findingRuleId === 'missing-mcp-servers') return true
  return false
}

export function LintFindingsPanel({ findings, skill }: LintFindingsPanelProps): React.JSX.Element {
  const hasIssues = findings.length > 0
  const [isExpanded, setIsExpanded] = useState(hasIssues)
  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length

  const extraFindings = findings.filter(
    (f) => !LINTER_RULES.some((r) => matchesRuleId(f.rule_id, r.id))
  )

  return (
    <div className="border-b border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Lint Status:
            </span>
            {hasIssues ? (
              <div className="flex items-center gap-2 text-xs font-medium">
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="size-3.5" />
                    {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3.5" />
                    {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
                  </span>
                )}
              </div>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-success">
                <CircleCheck className="size-3.5" />
                Passed all checks
              </span>
            )}
          </div>
        </div>

        <span className="text-[11px] text-muted-foreground">
          {isExpanded ? 'Click to collapse' : 'Click to view checks'}
        </span>
      </button>

      {isExpanded && (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-background/50 px-4 py-1">
          {LINTER_RULES.map((rule) => {
            const applicable = rule.isApplicable(skill)
            const ruleFindings = applicable
              ? findings.filter((f) => matchesRuleId(f.rule_id, rule.id))
              : []
            const hasErrors = ruleFindings.some((f) => f.severity === 'error')

            if (!applicable) {
              return null
            }

            if (ruleFindings.length > 0) {
              return (
                <div key={rule.id} className="flex items-start gap-2 py-2 text-xs">
                  {hasErrors ? (
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-foreground">{rule.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {rule.id}
                      </span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.2 font-mono text-[10px] font-medium',
                          hasErrors
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-warning/15 text-warning'
                        )}
                      >
                        {hasErrors ? 'Failed' : 'Warning'}
                      </span>
                    </div>

                    {ruleFindings.map((finding, idx) => (
                      <div
                        key={finding.id || idx}
                        className="space-y-1 rounded-md border border-border/50 bg-muted/30 p-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">{finding.message}</span>
                          {finding.file_path && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {finding.file_path}
                              {finding.line_number ? `:${finding.line_number}` : ''}
                            </span>
                          )}
                        </div>
                        {finding.detail && (
                          <p className="whitespace-pre-wrap rounded border border-border/40 bg-background/80 p-1.5 font-mono text-[11px] text-muted-foreground">
                            {finding.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            }

            return (
              <div key={rule.id} className="flex items-start gap-2 py-2 text-xs">
                <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">{rule.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {rule.id}
                    </span>
                    <span className="rounded bg-success/15 px-1.5 py-0.2 font-mono text-[10px] font-medium text-success">
                      Passed
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{rule.passDescription}</p>
                </div>
              </div>
            )
          })}

          {extraFindings.length > 0 && (
            <div className="flex items-start gap-2 py-2 text-xs">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <span className="font-semibold text-foreground">Additional Findings</span>
                {extraFindings.map((finding, idx) => (
                  <div
                    key={finding.id || idx}
                    className="space-y-1 rounded-md border border-border/50 bg-muted/30 p-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{finding.message}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {finding.rule_id}
                      </span>
                    </div>
                    {finding.detail && (
                      <p className="whitespace-pre-wrap rounded border border-border/40 bg-background/80 p-1.5 font-mono text-[11px] text-muted-foreground">
                        {finding.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

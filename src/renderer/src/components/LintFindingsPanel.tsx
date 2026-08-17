import React, { useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, CircleCheck } from 'lucide-react'
import type { LintFindingRow } from '../../../shared/ipc'

interface LintFindingsPanelProps {
  findings: LintFindingRow[]
}

export function LintFindingsPanel({ findings }: LintFindingsPanelProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(findings.length > 0)
  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length

  const hasIssues = findings.length > 0

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
          {hasIssues ? (isExpanded ? 'Click to collapse' : 'Click to view details') : ''}
        </span>
      </button>

      {isExpanded && hasIssues && (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-background/50 px-4 py-2">
          {findings.map((finding) => (
            <div
              key={finding.id || `${finding.rule_id}-${finding.line_number}-${finding.message}`}
              className="py-2 text-xs"
            >
              <div className="flex items-start gap-2">
                {finding.severity === 'error' ? (
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                )}
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-foreground">{finding.message}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {finding.rule_id}
                    </span>
                    {finding.file_path && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {finding.file_path}
                        {finding.line_number ? `:${finding.line_number}` : ''}
                      </span>
                    )}
                  </div>
                  {finding.detail && (
                    <p className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap rounded bg-muted/40 p-1.5">
                      {finding.detail}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

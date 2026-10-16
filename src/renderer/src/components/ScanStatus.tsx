import { TextLink } from '@/components/TextLink'
import type { ScanIssue, ScanSummary } from '../../../shared/ipc'

const SOURCE_LABELS: Record<string, string> = {
  scanSkills: 'Skills',
  scanPluginRegistry: 'Plugins',
  scanTranscripts: 'Transcripts',
  scanPromptHistory: 'Prompt history',
  runLinter: 'Skill checks',
  scanWorker: 'Scan worker'
}

const ISSUE_MESSAGES: Record<ScanIssue['code'], string> = {
  permission_required: 'Folder access is required. Grant this folder or a parent folder.',
  project_missing:
    'Project folder no longer exists. If it moved, its Claude plugin records need updating.',
  settings_invalid: 'Settings could not be parsed or contain invalid values.',
  source_unavailable: 'The source could not be read. Check file access and try rescanning.',
  scan_limit: 'The source exceeds the scan limit. Its cached data was preserved.'
}

interface ScanStatusProps {
  summary: ScanSummary
}

export function ScanStatusBanner({
  summary,
  onOpenDetails
}: ScanStatusProps & { onOpenDetails: () => void }): React.JSX.Element | null {
  if (summary.outcome === 'complete') return null
  const needsAccess = summary.sources.some((source) =>
    source.issues?.some((issue) => issue.code === 'permission_required')
  )
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
    >
      <p>
        {summary.outcome === 'failed'
          ? 'Scan failed. Showing the last available data.'
          : needsAccess
            ? 'Some project settings need folder access. Showing the last available data.'
            : 'Some sources could not be refreshed. Showing the last available data.'}
      </p>
      <TextLink onClick={onOpenDetails} className="shrink-0 hover:text-foreground">
        Scan details
      </TextLink>
    </div>
  )
}

export function ScanIssueDetails({
  summary,
  onManageFolders
}: ScanStatusProps & { onManageFolders: () => void }): React.JSX.Element | null {
  if (summary.outcome === 'complete') return null
  const affectedSources = summary.sources.filter((source) => source.status !== 'complete')
  const needsAccess = affectedSources.some((source) =>
    source.issues?.some((issue) => issue.code === 'permission_required')
  )
  return (
    <section
      aria-label="Scan details"
      className="flex min-w-0 flex-col gap-2 border-t border-border py-3"
    >
      <p className="text-sm font-medium">Scan needs attention</p>
      <ul className="max-h-40 space-y-3 overflow-y-auto text-xs text-muted-foreground">
        {affectedSources.map((source) => (
          <li key={source.name}>
            <p className="font-medium text-foreground">
              {SOURCE_LABELS[source.name] ?? source.name}
            </p>
            {source.issues?.length ? (
              <ul className="mt-1 space-y-2">
                {source.issues.map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>
                    <p>{ISSUE_MESSAGES[issue.code]}</p>
                    <p className="mt-0.5 break-all font-mono text-[11px]">{issue.path}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">
                {source.status === 'failed'
                  ? 'This source could not be scanned. Try rescanning.'
                  : 'Some files could not be read or exceeded scan limits. Try rescanning.'}
              </p>
            )}
          </li>
        ))}
      </ul>
      {needsAccess && (
        <TextLink
          onClick={onManageFolders}
          className="self-start text-xs text-muted-foreground hover:text-foreground"
        >
          Manage folder access
        </TextLink>
      )}
    </section>
  )
}

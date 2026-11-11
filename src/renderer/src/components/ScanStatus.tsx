import { TextLink } from '@/components/TextLink'
import type { ScanIssue, ScanSummary } from '../../../shared/ipc'
import { MISSING_PROJECT_SCAN_MESSAGE } from '../../../shared/missing-project'
import { isMissingProjectOnlyScan } from '../../../shared/scan-banner'

const SOURCE_LABELS: Record<string, string> = {
  scanSkills: 'Skills',
  scanPluginRegistry: 'Plugins',
  scanTranscripts: 'Transcripts',
  scanPromptHistory: 'Prompt history',
  archiveTokens: 'Token history',
  archivePrompts: 'Contribution history',
  archivePluginSkills: 'Plugin skill history',
  runLinter: 'Skill checks',
  scanWorker: 'Scan worker'
}

const ISSUE_MESSAGES: Record<ScanIssue['code'], string> = {
  permission_required: 'Folder access is required. Grant this folder or a parent folder.',
  project_missing: MISSING_PROJECT_SCAN_MESSAGE,
  settings_invalid: 'Settings could not be parsed or contain invalid values.',
  source_unavailable: 'The source could not be read. Check file access and try rescanning.',
  scan_limit: 'The source exceeds the scan limit. Its cached data was preserved.'
}

const SCAN_BANNER_CLASS =
  'flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground'

interface ScanStatusProps {
  summary: ScanSummary
}

export function ScanUpdatingBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div role="status" className={SCAN_BANNER_CLASS}>
      <p>{message}</p>
    </div>
  )
}

export function ScanStatusBanner({
  summary,
  onOpenDetails
}: ScanStatusProps & { onOpenDetails: () => void }): React.JSX.Element | null {
  if (summary.outcome === 'complete' || isMissingProjectOnlyScan(summary)) return null
  const needsAccess = summary.sources.some((source) =>
    source.issues?.some((issue) => issue.code === 'permission_required')
  )
  return (
    <div role="status" className={SCAN_BANNER_CLASS}>
      <p>
        {summary.outcome === 'failed'
          ? 'The startup scan could not finish. Open Scan details for more information.'
          : needsAccess
            ? 'Some project settings need folder access to finish scanning.'
            : 'Some sources could not be refreshed. Open Scan details for more information.'}
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
      <p className="text-sm font-medium">
        {isMissingProjectOnlyScan(summary) ? 'Missing project folders' : 'Scan needs attention'}
      </p>
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
                {source.failureReason === 'timeout'
                  ? 'This stage exceeded its time limit. Try rescanning.'
                  : source.failureReason === 'worker_crash'
                    ? 'The scan worker stopped unexpectedly. Try rescanning.'
                    : source.status === 'failed'
                      ? 'This source could not be refreshed. Try rescanning.'
                      : source.name === 'archiveTokens' || source.name === 'archivePrompts'
                        ? 'This history was preserved because its source scan was incomplete.'
                        : 'This source could not be fully refreshed. Try rescanning.'}
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

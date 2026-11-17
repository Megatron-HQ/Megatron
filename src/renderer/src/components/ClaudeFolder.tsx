import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleX, FolderOpen, TriangleAlert } from 'lucide-react'
import { SCAN_BANNER_CLASS } from '@/components/ScanStatus'
import { TextLink } from '@/components/TextLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { folderLabel } from '@/lib/folder-label'
import type {
  ClaudeFolderChoice,
  ClaudeFolderIssue,
  ClaudeFolderStatus,
  ClaudeFolderTag
} from '../../../shared/ipc'

const TAG_LABELS: Record<ClaudeFolderTag, string> = {
  default: 'Default',
  environment: 'CLAUDE_CONFIG_DIR'
}

const SOURCE_LINES: Record<ClaudeFolderStatus['source'], string> = {
  settings: 'Chosen in Settings.',
  environment: 'From CLAUDE_CONFIG_DIR.',
  default: 'Claude Code’s default.'
}

// Each follows "it", so one phrase serves the banner, Settings and a refused pick.
const REASONS: Record<ClaudeFolderIssue['reason'], string> = {
  invalid: 'isn’t a folder Megatron can read safely',
  missing: 'doesn’t exist',
  'no-marker': 'has no Claude Code data yet'
}

function label(path: string, home: string): string {
  return folderLabel(path, home, window.api.platform)
}

function claudeFolderNotice(status: ClaudeFolderStatus, home: string): string | null {
  const { issue, state } = status
  if (state === 'switching')
    return 'Switching Claude Code folders. Megatron restarts once running plugin changes finish.'
  if (!issue) return null
  if (state === 'paused')
    return issue.reason === 'missing'
      ? `${label(status.path, home)} is missing. Scans and plugin changes are paused until it’s back.`
      : `${label(status.path, home)} is back, but it ${REASONS[issue.reason]}. Scans and plugin changes stay paused.`
  const origin = issue.source === 'settings' ? 'Settings' : 'CLAUDE_CONFIG_DIR'
  return `Couldn’t use ${label(issue.value, home)} from ${origin}: it ${REASONS[issue.reason]}. Reading ${label(status.path, home)} instead.`
}

function useChooseClaudeFolder(home: string): {
  run: (request: () => Promise<ClaudeFolderChoice>) => Promise<void>
  pending: boolean
  refused: string | null
} {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  async function run(request: () => Promise<ClaudeFolderChoice>): Promise<void> {
    setPending(true)
    setRefused(null)
    try {
      const choice = await request()
      if (choice.outcome === 'chosen') queryClient.setQueryData(['claudeFolder'], choice.status)
      else if (choice.outcome === 'rejected')
        setRefused(`Can’t use ${label(choice.path, home)}: it ${REASONS[choice.reason]}.`)
    } catch {
      setRefused('Couldn’t change the Claude Code folder. Try again.')
    } finally {
      setPending(false)
    }
  }
  return { run, pending, refused }
}

export function ClaudeFolderChoices({
  status,
  home
}: {
  status: ClaudeFolderStatus
  home: string
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const { run, pending, refused } = useChooseClaudeFolder(home)
  // Mounted when Settings or onboarding opens, so a profile created since launch is suggested.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['claudeFolder'] })
  }, [queryClient])
  const switching = status.state === 'switching'
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul
        aria-label="Claude Code folders"
        className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border"
      >
        {status.options.map((option) => {
          const name = label(option.path, home)
          return (
            <li
              key={option.id}
              className="flex min-h-9 items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={option.path}>
                {name}
              </span>
              {option.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="font-mono text-[10px] font-normal text-muted-foreground"
                >
                  {TAG_LABELS[tag]}
                </Badge>
              ))}
              {option.active ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" aria-hidden />
                  Active
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={`Switch to ${name}`}
                  disabled={pending || switching}
                  onClick={() => void run(() => window.api.chooseClaudeFolder(option.id))}
                >
                  Switch
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || switching}
          onClick={() => void run(() => window.api.pickClaudeFolder())}
        >
          <FolderOpen className="size-4" />
          Choose folder…
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {switching ? 'Restarting…' : 'Switching restarts Megatron.'}
        </p>
      </div>
      {refused && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CircleX className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
          {refused}
        </p>
      )}
    </div>
  )
}

export function ClaudeFolderNotice({
  status,
  home
}: {
  status: ClaudeFolderStatus
  home: string
}): React.JSX.Element | null {
  const notice = claudeFolderNotice(status, home)
  if (!notice || status.state === 'switching') return null
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      {notice}
    </p>
  )
}

export function ClaudeFolderSettings({
  status,
  home
}: {
  status: ClaudeFolderStatus
  home: string
}): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-border py-3">
      <div>
        <p className="text-sm font-medium">Claude Code folder</p>
        <p className="text-xs text-muted-foreground">
          {SOURCE_LINES[status.source]} Megatron reads one folder at a time.
        </p>
      </div>
      <ClaudeFolderNotice status={status} home={home} />
      <ClaudeFolderChoices status={status} home={home} />
    </section>
  )
}

export function ClaudeFolderBanner({
  status,
  home,
  onChooseAnother
}: {
  status: ClaudeFolderStatus
  home: string
  onChooseAnother: () => void
}): React.JSX.Element | null {
  const { run, pending, refused } = useChooseClaudeFolder(home)
  const notice = claudeFolderNotice(status, home)
  if (!notice) return null
  return (
    <div role="status" className={SCAN_BANNER_CLASS}>
      <p className="min-w-0">{refused ?? notice}</p>
      {status.state !== 'switching' && (
        <div className="flex shrink-0 items-center gap-4">
          <TextLink onClick={onChooseAnother} className="hover:text-foreground">
            Choose another…
          </TextLink>
          <TextLink
            disabled={pending}
            onClick={() => void run(() => window.api.chooseClaudeFolder('default'))}
            className="hover:text-foreground disabled:opacity-50"
          >
            Use default
          </TextLink>
        </div>
      )}
    </div>
  )
}

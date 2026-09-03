import { CircleCheck, CircleHelp, Power, ShieldCheck, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFolderBasename } from '@/lib/source-name'
import { cn } from '@/lib/utils'
import type { PluginScope } from '../../../shared/ipc'

// Hardcoded recognition of Anthropic's own marketplace — every other marketplace groups and
// badges under its own real name.
const OFFICIAL_MARKETPLACE = 'claude-plugins-official'

export function MarketplaceBadge({
  marketplace,
  className
}: {
  marketplace: string
  className?: string
}): React.JSX.Element {
  const isOfficial = marketplace === OFFICIAL_MARKETPLACE
  const Icon = isOfficial ? ShieldCheck : Store
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('inline-flex max-w-full items-center gap-1 font-normal', className)}
        >
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{isOfficial ? 'Official' : marketplace}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isOfficial ? `Official marketplace (${marketplace})` : `Marketplace: ${marketplace}`}
      </TooltipContent>
    </Tooltip>
  )
}

// `known: false` is a third state, not a styling of Enabled: a project/local install whose
// project folder hasn't been granted keeps its enabledPlugins map out of reach, so Megatron
// genuinely cannot say. Rendering that as Enabled would be a confident guess.
export function PluginStatusBadge({
  disabledReason,
  known = true
}: {
  disabledReason: string | null
  known?: boolean
}): React.JSX.Element {
  const disabled = disabledReason !== null
  const Icon = !known ? CircleHelp : disabled ? Power : CircleCheck
  const iconColor = !known
    ? 'text-muted-foreground'
    : disabled
      ? 'text-disabled-flag'
      : 'text-success'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground select-none">
          <Icon className={cn('size-3 shrink-0', iconColor)} />
          <span className="truncate">{!known ? 'Unknown' : disabled ? 'Disabled' : 'Enabled'}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        {!known
          ? "Grant this plugin's project folder to read whether it's enabled there."
          : disabled
            ? 'Not loaded into context.'
            : 'Loaded into context.'}
      </TooltipContent>
    </Tooltip>
  )
}

const SCOPE_LABEL: Record<PluginScope, string> = {
  user: 'User',
  project: 'Project',
  local: 'Local'
}

const SCOPE_DESCRIPTION: Record<PluginScope, string> = {
  user: 'Installed for you, in every project.',
  project: 'Installed for this project and committed to its repo (.claude/settings.json).',
  local: 'Installed for this project, on this machine only (.claude/settings.local.json).'
}

// Scope and owning project share one cell so the inventory keeps six columns — a seventh would
// overflow the 860px minimum window width. The project's folder name carries the context; its
// absolute path stays in the tooltip and the detail view, per the Table columns locked decision.
export function PluginScopeLabel({
  scope,
  projectPath
}: {
  scope: PluginScope
  projectPath: string | null
}): React.JSX.Element {
  const projectName = projectPath === null ? null : getFolderBasename(projectPath)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex max-w-full cursor-default items-center gap-1 truncate text-muted-foreground">
          {SCOPE_LABEL[scope]}
          {projectName !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate text-foreground">{projectName}</span>
            </>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {SCOPE_DESCRIPTION[scope]}
        {projectPath !== null && <span className="block font-mono">{projectPath}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

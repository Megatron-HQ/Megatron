import { resolve } from 'path'
import type {
  PluginActionInput,
  PluginActionResult,
  PluginDetailResult,
  PluginUpdatePhase,
  ScanSummary
} from '../shared/ipc'
import { normalizeProjectPath } from '../shared/project-path'
import { isUpdateAvailable } from '../shared/version'

export type PluginActionVerb = 'enable' | 'disable' | 'update' | 'uninstall'
const FOCUSED_VERIFICATION_ATTEMPTS = 2
type PluginCommand = (
  input: PluginActionInput,
  onProgress?: (phase: PluginUpdatePhase) => void
) => Promise<PluginActionResult>

interface PluginActionDependencies {
  execute: Record<PluginActionVerb, PluginCommand>
  refresh: (scope: 'all' | 'plugins') => Promise<ScanSummary>
  readDetail: (input: PluginActionInput) => PluginDetailResult | null
  scheduleBackground: () => void
  reportError: (verb: PluginActionVerb, error: unknown) => void
}

function projectKey(path: string | null): string | null {
  return path === null ? null : normalizeProjectPath(resolve(path))
}

function installationKey(input: PluginActionInput): string {
  return JSON.stringify([input.name, input.marketplace, input.scope, projectKey(input.projectPath)])
}

function registryRefreshed(summary: ScanSummary): boolean {
  const registry = summary.sources.find((source) => source.name === 'scanPluginRegistry')
  if (registry?.status === 'complete') return true
  if (registry?.status !== 'partial' || !registry.issues?.length) return false
  return registry.issues.every(
    (issue) => issue.code === 'permission_required' || issue.code === 'project_missing'
  )
}

function verifyInstallation(
  verb: PluginActionVerb,
  input: PluginActionInput,
  detail: PluginDetailResult | null
): void {
  const install = detail?.plugin.installs.find(
    (row) =>
      row.scope === input.scope && projectKey(row.project_path) === projectKey(input.projectPath)
  )
  if (verb === 'uninstall') {
    if (install) throw new Error('The selected installation is still registered')
    return
  }
  if (!install || !install.enablement_known || install.project_missing) {
    throw new Error('The selected installation or its settings are unavailable')
  }
  if (verb === 'enable' || verb === 'disable') {
    if ((install.disabled_reason !== null) !== (verb === 'disable')) {
      throw new Error(
        `The selected installation is still ${install.disabled_reason === null ? 'enabled' : 'disabled'}. Another settings scope may override the command`
      )
    }
    return
  }
  const available = install.available_version ?? detail?.plugin.available_version ?? null
  if (isUpdateAvailable(install.installed_version, available, install.git_commit_sha)) {
    throw new Error(
      `The selected installation still has an update available (${install.installed_version} -> ${available})`
    )
  }
}

async function refreshVerifiedDetail(
  dependencies: PluginActionDependencies,
  verb: PluginActionVerb,
  input: PluginActionInput
): Promise<PluginDetailResult | null> {
  const attempts = verb === 'uninstall' ? 1 : FOCUSED_VERIFICATION_ATTEMPTS
  let failure: unknown
  // Only repeat the read/scan. Repeating the CLI could undo a newer user action.
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const summary = await dependencies.refresh(verb === 'uninstall' ? 'all' : 'plugins')
      if (!registryRefreshed(summary)) throw new Error('Plugin registry scan was incomplete')
      const detail = dependencies.readDetail(input)
      verifyInstallation(verb, input, detail)
      return detail
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

export function createPluginActionService(dependencies: PluginActionDependencies): {
  run: (
    verb: PluginActionVerb,
    input: PluginActionInput,
    onUpdateProgress?: (phase: PluginUpdatePhase) => void
  ) => Promise<PluginActionResult>
} {
  const pending = new Set<string>()
  return {
    async run(verb, input, onUpdateProgress) {
      const key = installationKey(input)
      if (pending.has(key))
        return { ok: false, stderr: 'Another action is already running for this installation.' }
      pending.add(key)
      try {
        const result = await dependencies.execute[verb](input, onUpdateProgress)
        if (!result.ok) return result
        if (verb === 'update') onUpdateProgress?.('verify')
        try {
          const detail = await refreshVerifiedDetail(dependencies, verb, input)
          return { ...result, detail }
        } catch (error) {
          dependencies.reportError(verb, error)
          const reason = error instanceof Error ? error.message : 'The current state is unavailable'
          return {
            ...result,
            verificationError: `The ${verb} command completed, but the plugin inventory could not be verified. ${reason}. Rescan to check its current state.`
          }
        } finally {
          if (verb !== 'uninstall') dependencies.scheduleBackground()
        }
      } finally {
        pending.delete(key)
      }
    }
  }
}

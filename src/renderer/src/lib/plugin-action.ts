import type { PluginActionInput, PluginActionResult, PluginDetailResult } from '../../../shared/ipc'
import { isUpdateAvailable } from '../../../shared/version'

export type PluginActionVerb = 'enable' | 'disable' | 'update' | 'uninstall'
export interface PluginActionVariables {
  verb: PluginActionVerb
  input: PluginActionInput
  previousVersion: string
}
export interface PluginActionApi {
  enablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  disablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  updatePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  uninstallPlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  getPluginDetail: (name: string, marketplace: string) => Promise<PluginDetailResult | null>
}

export async function performPluginAction(
  { verb, input, previousVersion }: PluginActionVariables,
  api: PluginActionApi
): Promise<{ message: string; detail: PluginDetailResult | null }> {
  let result: PluginActionResult
  try {
    result = await api[`${verb}Plugin`](input)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').trim()
        : ''
    throw new Error(message || 'Action failed unexpectedly. Try again.')
  }
  if (!result.ok) throw new Error(result.stderr?.trim() || 'Action failed. Try again.')

  const verificationMessage = `The ${verb} command completed, but Megatron could not verify the result. Refresh the plugin list to check its current state.`
  let detail: PluginDetailResult | null
  try {
    detail = await api.getPluginDetail(input.name, input.marketplace)
  } catch {
    throw new Error(verificationMessage)
  }
  const install = detail?.plugin.installs.find(
    (row) => row.scope === input.scope && row.project_path === input.projectPath
  )
  if (verb === 'uninstall') {
    if (install) throw new Error(verificationMessage)
    return { message: `${input.name} uninstalled`, detail }
  }
  if (!install || !install.enablement_known) throw new Error(verificationMessage)
  if (verb === 'enable' || verb === 'disable') {
    if ((install.disabled_reason !== null) !== (verb === 'disable')) {
      throw new Error(verificationMessage)
    }
    return { message: `${input.name} ${verb === 'enable' ? 'enabled' : 'disabled'}`, detail }
  }

  const availableVersion = install.available_version ?? detail?.plugin.available_version ?? null
  if (isUpdateAvailable(install.installed_version, availableVersion)) {
    throw new Error(
      `Claude Code finished, but ${input.name} still has an update available (${install.installed_version} → ${availableVersion}). Refresh the plugin list and try again.`
    )
  }
  const message =
    install.installed_version !== previousVersion
      ? `${input.name} updated to ${install.installed_version}`
      : availableVersion && availableVersion !== 'unknown'
        ? `${input.name} is up to date (${install.installed_version})`
        : `${input.name}: no version change (${install.installed_version})`
  return { message, detail }
}

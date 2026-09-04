import type { PluginRow } from '../../../shared/ipc'
import { isUpdateAvailable } from '../../../shared/version'

function withoutVersionPrefix(version: string): string {
  return version.trim().replace(/^v/i, '')
}

export function pluginUpdateDetails(plugin: PluginRow): {
  hasUpdate: boolean
  message: string
  availableVersion: string | null
} {
  const behindInstalls = plugin.installs.filter((install) =>
    isUpdateAvailable(
      install.installed_version,
      install.available_version ?? plugin.available_version
    )
  )
  if (behindInstalls.length === 0) {
    return { hasUpdate: false, message: '', availableVersion: null }
  }

  const targetVersion = behindInstalls[0].available_version ?? plugin.available_version
  const targetLabel = targetVersion ? `v${withoutVersionPrefix(targetVersion)}` : 'latest'

  if (behindInstalls.length === 1) {
    const inst = {
      ...behindInstalls[0],
      installed_version: withoutVersionPrefix(behindInstalls[0].installed_version)
    }
    const scopeLabel =
      inst.scope === 'user'
        ? 'User scope'
        : inst.project_path
          ? `Project (${inst.project_path})`
          : `${inst.scope} scope`
    return {
      hasUpdate: true,
      availableVersion: targetVersion,
      message: `Update available for ${scopeLabel}: v${inst.installed_version} → ${targetLabel}`
    }
  }

  const scopes = behindInstalls.map((i) => i.scope).join(', ')
  return {
    hasUpdate: true,
    availableVersion: targetVersion,
    message: `Update available (${scopes}): → ${targetLabel}`
  }
}

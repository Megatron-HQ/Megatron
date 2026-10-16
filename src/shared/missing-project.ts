export const MISSING_PROJECT_STATUS_TOOLTIP =
  "This project folder is missing, so Megatron can't tell whether this install is enabled."

export const MISSING_PROJECT_SCAN_MESSAGE =
  'This project folder is missing. Showing the last available data.'

export function missingProjectInstallMessage(projectPath: string): string {
  return (
    `This install is registered to ${projectPath}, and that folder is missing. Megatron can't update, enable, disable, or uninstall it. ` +
    'Put the project back at that path to keep this install, or install the plugin again from its new location in Claude Code. ' +
    'The next scan shows the new install. This record stays until Claude Code removes it.'
  )
}

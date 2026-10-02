export function isTrustedRendererUrl(raw: string, trusted: string): boolean {
  try {
    const candidate = new URL(raw)
    const expected = new URL(trusted)
    candidate.hash = ''
    expected.hash = ''
    return candidate.href === expected.href
  } catch {
    return false
  }
}

export function isTrustedIpcSender(
  event: { sender: unknown; senderFrame: unknown },
  contents: { mainFrame: { url: string } },
  trusted: string
): boolean {
  return (
    event.sender === contents &&
    event.senderFrame === contents.mainFrame &&
    isTrustedRendererUrl(contents.mainFrame.url, trusted)
  )
}

export function canManagePluginInstall(input: unknown, plugin: PluginRow | null): boolean {
  if (
    !isPluginActionInput(input) ||
    plugin === null ||
    input.name !== plugin.name ||
    input.marketplace !== plugin.marketplace
  )
    return false
  const key = (path: string | null): string | null =>
    path === null
      ? null
      : process.platform === 'win32'
        ? resolve(path).toLowerCase()
        : resolve(path)
  return plugin.installs.some(
    (install) =>
      install.scope === input.scope &&
      key(install.project_path) === key(input.projectPath) &&
      install.enablement_known
  )
}

export function validateIpcArguments(channel: string, args: unknown[]): void {
  const value = args[0]
  const text = (input: unknown): input is string =>
    typeof input === 'string' &&
    input.length > 0 &&
    input.length <= MAX_IPC_STRING_LENGTH &&
    !input.includes('\0')
  let valid: boolean
  switch (channel) {
    case IPC_CHANNELS.openSkill:
    case IPC_CHANNELS.openSkillMeta:
    case IPC_CHANNELS.openSkillHistory:
      valid = args.length === 1 && Number.isSafeInteger(value) && (value as number) > 0
      break
    case IPC_CHANNELS.setTheme:
      valid = args.length === 1 && ['light', 'dark', 'system'].includes(value as string)
      break
    case IPC_CHANNELS.setLastSection:
      valid = args.length === 1 && (APP_SECTIONS as readonly unknown[]).includes(value)
      break
    case IPC_CHANNELS.revokeAllowedPath:
    case IPC_CHANNELS.openExternal:
      valid = args.length === 1 && text(value)
      break
    case IPC_CHANNELS.getPluginDetail:
      valid = args.length === 2 && args.every(text)
      break
    case IPC_CHANNELS.enablePlugin:
    case IPC_CHANNELS.disablePlugin:
    case IPC_CHANNELS.updatePlugin:
    case IPC_CHANNELS.uninstallPlugin:
      valid = args.length === 1 && isPluginActionInput(value)
      break
    case IPC_CHANNELS.usageSkillInvocations: {
      const slice = value as Record<string, unknown> | null
      valid =
        args.length === 1 &&
        typeof slice === 'object' &&
        slice !== null &&
        text(slice.startAt) &&
        text(slice.endAt) &&
        Number.isFinite(Date.parse(slice.startAt)) &&
        Number.isFinite(Date.parse(slice.endAt)) &&
        Date.parse(slice.startAt) < Date.parse(slice.endAt) &&
        (slice.skillName === undefined || text(slice.skillName))
      break
    }
    default:
      valid = Object.values(IPC_CHANNELS).includes(channel as never) && args.length === 0
  }
  if (!valid) throw new Error('Invalid application request')
}
import { resolve } from 'path'
import { IPC_CHANNELS, APP_SECTIONS, type PluginRow } from '../shared/ipc'
import { isPluginActionInput } from './plugin-actions'

const MAX_IPC_STRING_LENGTH = 8192

// A Settings group a deep link lands on. Its caption carries this id, which the dialog focuses
// when it opens there.
export type SettingsTarget = 'claude-folder' | 'project-folders' | 'index'

export const settingsTargetId = (target: SettingsTarget): string => `settings-${target}`

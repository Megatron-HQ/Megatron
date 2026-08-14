export const IPC_CHANNELS = {
  listSkills: 'skills:list',
  getInitialTheme: 'theme:getInitial',
  setTheme: 'theme:set',
  scanComplete: 'scan:complete'
} as const

export type SourceType = 'global' | 'project' | 'plugin'

export interface SkillRow {
  id: number
  name: string
  source_type: SourceType
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
}

export interface SkillsListResult {
  skills: SkillRow[]
  scanComplete: boolean
}

export type Theme = 'light' | 'dark'

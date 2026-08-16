import type { SourceType } from '../../../shared/ipc'

export type SourceFilter = 'all' | SourceType

export const FILTER_LABEL: Record<SourceFilter, string> = {
  all: 'All Skills',
  global: 'Global',
  project: 'Project',
  plugin: 'Plugin'
}

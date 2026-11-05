import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { normalizeProjectPath } from '../../../shared/project-path'
import { resolveUsageProjectPath } from '../../../shared/usage-projects'
import type { UsageProjectCatalog } from '../../../shared/usage-projects'
import type { ProjectLabelResolver } from './project-tree'
import { createUsageProjectLabelResolver } from './usage-project-label'
import { useProjectLabel } from './use-project-label'

export const USAGE_PROJECTS_QUERY_KEY = ['usage', 'projects'] as const

export function useUsageProjects(): UseQueryResult<UsageProjectCatalog> & {
  resolveProjectLabel: ProjectLabelResolver
  projectTooltip: ProjectLabelResolver
} {
  const hierarchy = useProjectLabel()
  const query = useQuery({
    queryKey: USAGE_PROJECTS_QUERY_KEY,
    queryFn: () => window.api.getUsageProjects(),
    staleTime: Infinity
  })
  const resolveProjectLabel = useMemo(
    () => createUsageProjectLabelResolver([], hierarchy, query.data),
    [hierarchy, query.data]
  )
  const projectTooltip = (path: string): string => {
    if (!query.data) return path
    const root = normalizeProjectPath(resolveUsageProjectPath(path, query.data.locations))
    const project = query.data.projects.find((entry) => normalizeProjectPath(entry.path) === root)
    if (!project) return path
    const paths = project.locations.map((location) => location.path)
    if (!paths.some((entry) => normalizeProjectPath(entry) === normalizeProjectPath(path)))
      paths.push(path)
    return paths.join('\n')
  }
  return { ...query, resolveProjectLabel, projectTooltip }
}

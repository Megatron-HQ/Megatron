import { createContext, useContext } from 'react'
import type { ProjectLabelResolver } from './project-tree'

export const ProjectLabelContext = createContext<ProjectLabelResolver | null>(null)

export function useProjectLabel(): ProjectLabelResolver {
  const resolveProjectLabel = useContext(ProjectLabelContext)
  if (resolveProjectLabel === null) {
    throw new Error('Project labels require ProjectLabelContext.Provider')
  }
  return resolveProjectLabel
}

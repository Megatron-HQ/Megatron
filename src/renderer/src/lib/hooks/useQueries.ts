import { useQuery, UseQueryResult } from '@tanstack/react-query'
import type { Skill, Invocation, Plugin, Session } from '../../../../shared/types'

export function useSkills(): UseQueryResult<Skill[], Error> {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => window.api.getSkills()
  })
}

export function useInvocations(): UseQueryResult<Invocation[], Error> {
  return useQuery({
    queryKey: ['invocations'],
    queryFn: () => window.api.getInvocations()
  })
}

export function usePlugins(): UseQueryResult<Plugin[], Error> {
  return useQuery({
    queryKey: ['plugins'],
    queryFn: () => window.api.getPlugins()
  })
}

export function useSessions(): UseQueryResult<Session[], Error> {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => window.api.getSessions()
  })
}

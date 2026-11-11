import { queryOptions } from '@tanstack/react-query'

// Shared by the Usage view and onboarding's Usage card so both read one cache and one poll.
export const usageOverviewQuery = queryOptions({
  queryKey: ['usage'],
  queryFn: () => window.api.getUsageOverview(),
  refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
})

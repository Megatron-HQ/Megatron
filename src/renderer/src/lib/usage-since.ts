// The date Uses, Last used and MCP call counts are complete from (usageHistorySince in main):
// the start of Megatron's unbroken transcript coverage. Short within this year, with the year
// otherwise, so a long archive never reads as this year's date.
export function formatUsageSince(since: string | null, now: Date = new Date()): string | null {
  if (since === null) return null
  const date = new Date(since)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  })
}

export function usesSinceTitle(since: string | null): string | undefined {
  const date = formatUsageSince(since)
  return date === null
    ? undefined
    : `Every use since ${date}, including ones whose transcripts Claude Code has since deleted.`
}

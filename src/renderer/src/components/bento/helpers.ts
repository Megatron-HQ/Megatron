export function initials(name: string): string {
  const parts = name.split(/[-_\s@/]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export const AVATAR_COLORS = ['#0b4f6c', '#f7a034', '#0c3854', '#e23d28', '#2f6b4f'] as const

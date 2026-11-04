import type { ContextCategory, ContextSection, ContextUsage } from '../../../../shared/ipc'

export type RecordedView = 'blocks' | 'tools' | 'breakpoints' | 'hooks' | 'mcp'

export type DrillTarget =
  | { kind: 'section'; category: ContextCategory; section: ContextSection; shared: boolean }
  | { kind: 'recorded'; category: ContextCategory; view: RecordedView }

// /context itemizes these categories itself; the rest are explained from the latest transcript.
// Keyed by category name, so a renamed category simply loses its drill-in instead of breaking.
const RECORDED_VIEWS: Record<string, RecordedView> = {
  'system prompt': 'blocks',
  'system tools': 'tools',
  messages: 'hooks',
  'mcp server instructions': 'mcp'
}

function categoryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\(deferred\)$/, '')
}

export function resolveDrillTarget(
  usage: ContextUsage,
  category: ContextCategory
): DrillTarget | null {
  if (category.group === 'free' || category.group === 'buffer') return null
  const key = categoryKey(category.name)
  const section = usage.sections.find((candidate) => candidate.title.toLowerCase() === key)
  if (section !== undefined && section.rows.length > 0) {
    // /context prints one MCP Tools table for both the loaded and the deferred MCP rows.
    const shared = usage.categories.filter((other) => categoryKey(other.name) === key).length > 1
    return { kind: 'section', category, section, shared }
  }
  // A deferred tool isn't in the request at all, so the transcript can't explain it.
  const view = category.group === 'used' ? RECORDED_VIEWS[key] : undefined
  return view === undefined ? null : { kind: 'recorded', category, view }
}

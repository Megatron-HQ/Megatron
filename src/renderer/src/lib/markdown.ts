import { parse } from 'yaml'

export function isMarkdownFile(relativePath: string): boolean {
  return /\.(md|markdown)$/i.test(relativePath)
}

export interface FrontmatterSplit {
  frontmatter: string | null
  body: string
}

// Mirrors skill-parser.ts's extractFrontmatterBlock delimiter rules, so main and renderer agree
// on what counts as a frontmatter block.
export function splitFrontmatter(content: string): FrontmatterSplit {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { frontmatter: null, body: normalized }

  const closingIndex = normalized.indexOf('\n---', 4)
  if (closingIndex === -1) return { frontmatter: null, body: normalized }

  const frontmatter = normalized.slice(4, closingIndex)
  const closingLineStart = closingIndex + 1
  const eol = normalized.indexOf('\n', closingLineStart + 3)
  const body = eol === -1 ? '' : normalized.slice(eol + 1)

  return { frontmatter, body }
}

type ScalarFrontmatterField = [string, string | number | boolean]

// Reads whatever a SKILL.md's frontmatter declares beyond name/description — deliberately not
// hardcoded to a known field list, so a skill that declares a new field just shows it.
export function parseExtraFrontmatterFields(content: string): ScalarFrontmatterField[] {
  const { frontmatter } = splitFrontmatter(content)
  if (frontmatter === null) return []

  let parsed: unknown
  try {
    parsed = parse(frontmatter)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []

  return Object.entries(parsed as Record<string, unknown>).filter(
    (entry): entry is ScalarFrontmatterField =>
      entry[0] !== 'name' &&
      entry[0] !== 'description' &&
      // First-class on the detail page now (surfaced as the Invocation stat) — don't also echo
      // it as a raw frontmatter badge.
      entry[0] !== 'disable-model-invocation' &&
      ['string', 'number', 'boolean'].includes(typeof entry[1])
  )
}

// True only when SKILL.md's frontmatter carries `disable-model-invocation: true` as a bare
// boolean. Mirrors skill-parser.ts's strict `=== true` check exactly: a quoted "true", a number,
// or any other value is not the opt-out and the scanner ignores it, so this must too — otherwise
// the detail page would credit "SKILL.md frontmatter" for a skill the scanner never flagged.
export function hasDisableModelInvocationFrontmatter(content: string): boolean {
  const { frontmatter } = splitFrontmatter(content)
  if (frontmatter === null) return false

  let parsed: unknown
  try {
    parsed = parse(frontmatter)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false

  return (parsed as Record<string, unknown>)['disable-model-invocation'] === true
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function resolveInternalLink(
  fromRelativePath: string,
  href: string,
  files: { relativePath: string }[]
): string | null {
  if (href === '' || href.startsWith('#') || href.startsWith('/') || HAS_SCHEME.test(href)) {
    return null
  }

  const pathPart = href.split(/[?#]/)[0]
  if (pathPart === '') return null

  const fromDir = fromRelativePath.includes('/')
    ? fromRelativePath.slice(0, fromRelativePath.lastIndexOf('/'))
    : ''
  const combined = fromDir ? `${fromDir}/${pathPart}` : pathPart

  const normalized = normalizeRelativePath(combined)
  if (normalized === null) return null

  return files.some((f) => f.relativePath === normalized) ? normalized : null
}

function normalizeRelativePath(path: string): string | null {
  const segments: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(part)
  }
  return segments.join('/')
}

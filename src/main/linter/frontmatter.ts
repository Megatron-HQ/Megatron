import { parse } from 'yaml'

export function extractFrontmatterBlock(content: string): string | null {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const normalized = withoutBom.replace(/\r\n/g, '\n')
  const startMatch = normalized.match(/^---[ \t]*(?:\n|$)/)
  if (!startMatch) return null

  const startOffset = startMatch[0].length
  const closingMatch = normalized.slice(startOffset).match(/\n---[ \t]*(?:\n|$)/)
  if (!closingMatch || closingMatch.index === undefined) return null

  const closingIndex = startOffset + closingMatch.index
  return normalized.slice(startOffset, closingIndex)
}

export function parseFrontmatterObject(block: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = parse(block)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

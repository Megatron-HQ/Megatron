import { basename, join } from 'path'
import { parse } from 'yaml'
import { allowedReadFileSync } from '../permissions'

export interface ParsedSkill {
  name: string
  description: string | null
  est_listing_tokens: number
  est_body_tokens: number
}

// Verbatim from Claude Code's compiled binary (function `xv` and its skill-listing call site).
// `chars / 4` isn't an approximation — it's the literal mechanism that decides when a live
// session truncates a skill's description, so a "more accurate" tokenizer would disagree with
// real behavior. Math.round (not floor/ceil) matches that call site's rounding mode.
const LISTING_DESCRIPTION_MAX_CHARS = 1536

function estimateTokens(text: string): number {
  return Math.round(text.length / 4)
}

function estimateListingTokens(name: string, description: string | null): number {
  const capped =
    description !== null && description.length > LISTING_DESCRIPTION_MAX_CHARS
      ? description.slice(0, LISTING_DESCRIPTION_MAX_CHARS)
      : description
  return estimateTokens([name, capped].filter(Boolean).join(' '))
}

function parseFrontmatter(
  content: string,
  fallbackName: string
): { name: string; description: string | null } {
  const block = extractFrontmatterBlock(content)
  if (block === null) return { name: fallbackName, description: null }

  let parsed: unknown
  try {
    parsed = parse(block)
  } catch {
    return { name: fallbackName, description: null }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { name: fallbackName, description: null }
  }

  const record = parsed as Record<string, unknown>
  const trimmedName = typeof record.name === 'string' ? record.name.trim() : ''
  const name = trimmedName === '' ? fallbackName : trimmedName
  const rawDescription = typeof record.description === 'string' ? record.description.trim() : ''
  const description = rawDescription === '' ? null : rawDescription

  return { name, description }
}

export function parseSkillDirectory(dirPath: string): ParsedSkill {
  const fallbackName = basename(dirPath)
  const skillMdPath = join(dirPath, 'SKILL.md')

  const fileContents = allowedReadFileSync(skillMdPath)
  if (fileContents === null) {
    return { name: fallbackName, description: null, est_listing_tokens: 0, est_body_tokens: 0 }
  }

  const content = fileContents.toString('utf8')
  const { name, description } = parseFrontmatter(content, fallbackName)

  return {
    name,
    description,
    est_listing_tokens: estimateListingTokens(name, description),
    est_body_tokens: estimateTokens(content)
  }
}

function extractFrontmatterBlock(content: string): string | null {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const normalized = withoutBom.replace(/\r\n/g, '\n')
  const startMatch = normalized.match(/^---[ \t]*(?:\n|$)/)
  if (!startMatch) return null

  const startOffset = startMatch[0].length
  const closingMatch = normalized.slice(startOffset).match(/\n---[ \t]*(?:\n|$)/)
  if (!closingMatch || closingMatch.index === undefined) return null

  return normalized.slice(startOffset, startOffset + closingMatch.index)
}

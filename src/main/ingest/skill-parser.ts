import { basename, join } from 'path'
import { parse } from 'yaml'
import { allowedReadFileSync } from '../permissions'

export interface ParsedSkill {
  name: string
  description: string | null
  license: string | null
  metadata_json: string | null
  est_listing_tokens: number
  est_body_tokens: number
}

// Still verbatim from Claude Code's compiled binary (function `xv` and its skill-listing call
// site): the real cap it applies to a description before truncating it in its own system prompt.
const LISTING_DESCRIPTION_MAX_CHARS = 1536

// Empirically calibrated 2026-08-24, NOT verbatim from Claude Code's binary — see
// docs/mvp-build-spec.md's Token estimation section for the full story. Claude Code doesn't
// publish an offline tokenizer for current models, and Anthropic's own docs explicitly disclaim
// third-party tokenizers (tiktoken, gpt-tokenizer) as wrong for its vocabulary, so this is the
// closest available approximation, not an exact count. Derived by comparing Megatron's prior
// chars/4 estimate against Claude Code's own `/context` output across 25 real skills: chars/4
// averaged 74.6% of the real number (4 × 0.746 ≈ 3.0). `queries.ts`'s CONTEXT_BUDGET_LIMIT
// imports this same constant so the two stay in lockstep — see its comment for why.
export const CHARS_PER_TOKEN = 3

function estimateTokens(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN)
}

function estimateListingTokens(name: string, description: string | null): number {
  const capped =
    description !== null && description.length > LISTING_DESCRIPTION_MAX_CHARS
      ? description.slice(0, LISTING_DESCRIPTION_MAX_CHARS)
      : description
  return estimateTokens([name, capped].filter(Boolean).join(' '))
}

interface ParsedFrontmatter {
  name: string
  description: string | null
  license: string | null
  metadata_json: string | null
}

function parseFrontmatter(content: string, fallbackName: string): ParsedFrontmatter {
  const block = extractFrontmatterBlock(content)
  if (block === null) {
    return { name: fallbackName, description: null, license: null, metadata_json: null }
  }

  let parsed: unknown
  try {
    parsed = parse(block)
  } catch {
    return { name: fallbackName, description: null, license: null, metadata_json: null }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { name: fallbackName, description: null, license: null, metadata_json: null }
  }

  const record = parsed as Record<string, unknown>
  const trimmedName = typeof record.name === 'string' ? record.name.trim() : ''
  const name = trimmedName === '' ? fallbackName : trimmedName
  const rawDescription = typeof record.description === 'string' ? record.description.trim() : ''
  const description = rawDescription === '' ? null : rawDescription
  const rawLicense = typeof record.license === 'string' ? record.license.trim() : ''
  const license = rawLicense === '' ? null : rawLicense
  const metadata_json =
    typeof record.metadata === 'object' &&
    record.metadata !== null &&
    !Array.isArray(record.metadata)
      ? JSON.stringify(record.metadata)
      : null

  return { name, description, license, metadata_json }
}

export function parseSkillDirectory(dirPath: string): ParsedSkill {
  const fallbackName = basename(dirPath)
  const skillMdPath = join(dirPath, 'SKILL.md')

  const fileContents = allowedReadFileSync(skillMdPath)
  if (fileContents === null) {
    return {
      name: fallbackName,
      description: null,
      license: null,
      metadata_json: null,
      est_listing_tokens: 0,
      est_body_tokens: 0
    }
  }

  const content = fileContents.toString('utf8')
  const { name, description, license, metadata_json } = parseFrontmatter(content, fallbackName)

  return {
    name,
    description,
    license,
    metadata_json,
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

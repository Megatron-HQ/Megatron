import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { parse } from 'yaml'
import { isPathAllowed } from '../permissions'

export interface ParsedSkill {
  name: string
  description: string | null
}

export function parseSkillDirectory(dirPath: string): ParsedSkill {
  const fallback: ParsedSkill = { name: basename(dirPath), description: null }
  const skillMdPath = join(dirPath, 'SKILL.md')

  if (!isPathAllowed(skillMdPath) || !existsSync(skillMdPath)) return fallback

  const content = readFileSync(skillMdPath, 'utf8')
  const block = extractFrontmatterBlock(content)
  if (block === null) return fallback

  let parsed: unknown
  try {
    parsed = parse(block)
  } catch {
    return fallback
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback

  const record = parsed as Record<string, unknown>
  const trimmedName = typeof record.name === 'string' ? record.name.trim() : ''
  const name = trimmedName === '' ? fallback.name : trimmedName
  const rawDescription = typeof record.description === 'string' ? record.description.trim() : ''
  const description = rawDescription === '' ? null : rawDescription

  return { name, description }
}

function extractFrontmatterBlock(content: string): string | null {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null

  const closingIndex = normalized.indexOf('\n---', 4)
  if (closingIndex === -1) return null

  return normalized.slice(4, closingIndex)
}

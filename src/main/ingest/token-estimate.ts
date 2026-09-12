import { CHARS_PER_TOKEN } from './skill-parser'

export function estimateResidentTokens(characterCount: number): number {
  if (!Number.isInteger(characterCount) || characterCount < 0) {
    throw new RangeError('Resident character count must be a non-negative integer')
  }
  return Math.ceil(characterCount / CHARS_PER_TOKEN)
}

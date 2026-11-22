// Claude Code writes "[Image: original {W}x{H}, displayed at ...]" into its own transcript
// whenever a screenshot is attached — a coordinate-mapping note, not a file reference. Stored
// raw (see queries.ts), it renders as garbage in a history row, so the renderer turns it into a
// label here. The original dimensions are kept because without them an image-heavy skill's log
// is a wall of identical rows, which itself reads as a bug.
import type { SkillInvocationEntry } from '../../../shared/ipc'

const IMAGE_CAPTION = /^\[Image: original (\d+)x(\d+)/

export type InvocationPrompt =
  | { kind: 'image'; label: string; dimensions: string }
  | { kind: 'text'; label: string }
  | { kind: 'pruned'; label: string }

export const PRUNED_PROMPT_EXPLANATION =
  "Claude Code deleted this session's transcript. Megatron kept when and where the skill ran, never what was typed."

// A use only the usage archive still holds has no prompt to show (#51): say so rather than
// render an empty row or invent the slash command nobody typed.
export function invocationPrompt(
  entry: Pick<SkillInvocationEntry, 'preceding_user_text' | 'transcript_pruned'>
): InvocationPrompt {
  if (entry.transcript_pruned === 1) return { kind: 'pruned', label: 'Transcript pruned' }
  return parseInvocationPrompt(entry.preceding_user_text)
}

export function parseInvocationPrompt(raw: string): InvocationPrompt {
  const match = IMAGE_CAPTION.exec(raw)
  if (match) {
    return { kind: 'image', label: 'Image attachment', dimensions: `${match[1]}×${match[2]}` }
  }
  return { kind: 'text', label: raw }
}

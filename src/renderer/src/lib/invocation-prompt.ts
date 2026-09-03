// Claude Code writes "[Image: original {W}x{H}, displayed at ...]" into its own transcript
// whenever a screenshot is attached — a coordinate-mapping note, not a file reference. Stored
// raw (see queries.ts), it renders as garbage in a history row, so the renderer turns it into a
// label here. The original dimensions are kept because without them an image-heavy skill's log
// is a wall of identical rows, which itself reads as a bug.
const IMAGE_CAPTION = /^\[Image: original (\d+)x(\d+)/

export type InvocationPrompt =
  { kind: 'image'; label: string; dimensions: string } | { kind: 'text'; label: string }

export function parseInvocationPrompt(raw: string): InvocationPrompt {
  const match = IMAGE_CAPTION.exec(raw)
  if (match) {
    return { kind: 'image', label: 'Image attachment', dimensions: `${match[1]}×${match[2]}` }
  }
  return { kind: 'text', label: raw }
}

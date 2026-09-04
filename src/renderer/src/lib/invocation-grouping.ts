import { parseInvocationPrompt } from './invocation-prompt'
import type { SkillInvocationEntry } from '../../../shared/ipc'

// A run of image-only rows (Claude Code's coordinate-mapping placeholder, see
// invocation-prompt.ts) carries no distinguishing signal between entries — same skill, same
// trigger, often the same dimensions, seconds apart. Left as individual rows they read as
// duplicates; collapsed into one summary row they read as what they are, one screenshot sweep.
const RUN_GAP_MS = 15 * 60 * 1000
const MIN_RUN_LENGTH = 2

export type InvocationListItem =
  | { kind: 'single'; entry: SkillInvocationEntry }
  | { kind: 'group'; entries: SkillInvocationEntry[] }

// entries is invoked_at DESC (see queries.ts), so within a run entries[0] is the newest.
export function groupInvocationEntries(entries: SkillInvocationEntry[]): InvocationListItem[] {
  const items: InvocationListItem[] = []
  let run: SkillInvocationEntry[] = []

  const flushRun = (): void => {
    if (run.length >= MIN_RUN_LENGTH) {
      items.push({ kind: 'group', entries: run })
    } else {
      for (const entry of run) items.push({ kind: 'single', entry })
    }
    run = []
  }

  for (const entry of entries) {
    const isImage = parseInvocationPrompt(entry.preceding_user_text).kind === 'image'
    const last = run[run.length - 1]
    const extendsRun =
      last !== undefined &&
      last.trigger_type === entry.trigger_type &&
      new Date(last.invoked_at).getTime() - new Date(entry.invoked_at).getTime() <= RUN_GAP_MS

    if (isImage && (run.length === 0 || extendsRun)) {
      run.push(entry)
    } else {
      flushRun()
      if (isImage) run.push(entry)
      else items.push({ kind: 'single', entry })
    }
  }
  flushRun()

  return items
}

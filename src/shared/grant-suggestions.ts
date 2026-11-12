import { isWithinProjectPath, normalizeProjectPath } from './project-path'
import { isClaudeAppScratchPath } from './usage-projects'

// String-only, no `path`: the renderer filters onboarding rows with the same rule main uses to
// pick the folder picker's starting point, and the sandboxed renderer has no Node modules.

function isRoot(path: string): boolean {
  const normalized = normalizeProjectPath(path)
  return (
    normalized === '/' || /^[a-z]:$/.test(normalized) || /^\/\/[^/]+(?:\/[^/]+)?$/.test(normalized)
  )
}

// Most people have run `claude` in their home folder at some point. Offering home, anything
// above it, or a drive/share root invites a grant far wider than any one project needs. A Claude
// app chat folder lives in Claude's own app data, which Megatron never asks to read.
export function isSuggestableFolder(path: string, home: string): boolean {
  return !isRoot(path) && !isWithinProjectPath(home, path) && !isClaudeAppScratchPath(path)
}

// Ancestors in the recorded form, separators and casing intact, because the result is handed
// to the native dialog as-is.
function strictAncestors(path: string): string[] {
  const ancestors: string[] = []
  let current = path.replace(/[\\/]+$/, '')
  for (;;) {
    const cut = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'))
    if (cut <= 0) return ancestors
    current = current.slice(0, cut)
    ancestors.push(current)
  }
}

// Strict ancestors only: opening inside a repo hides it, while opening beside it lets the user
// pick it or click Open to take the whole folder. The deepest folder wins a tie, since a narrower
// starting point is never wider than the user asked for.
export function suggestGrantStart(
  detected: string[],
  grants: string[],
  home: string
): string | undefined {
  const candidates = new Map<string, { path: string; count: number; depth: number }>()
  for (const folder of detected) {
    if (!isSuggestableFolder(folder, home)) continue
    if (grants.some((grant) => isWithinProjectPath(folder, grant))) continue
    for (const ancestor of strictAncestors(folder)) {
      if (!isSuggestableFolder(ancestor, home)) continue
      const key = normalizeProjectPath(ancestor)
      const entry = candidates.get(key) ?? {
        path: ancestor,
        count: 0,
        depth: key.split('/').length
      }
      entry.count++
      candidates.set(key, entry)
    }
  }
  let best: { path: string; count: number; depth: number } | undefined
  for (const candidate of candidates.values()) {
    if (
      !best ||
      candidate.count > best.count ||
      (candidate.count === best.count && candidate.depth > best.depth)
    )
      best = candidate
  }
  return best?.path
}

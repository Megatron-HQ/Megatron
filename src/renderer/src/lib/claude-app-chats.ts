import { isClaudeAppScratchPath } from '../../../shared/usage-projects'

export const CLAUDE_APP_CHATS_LABEL = 'Claude app chats'

// Each folderless Claude desktop chat is its own working directory, so a heavy user's project
// lists would fill with one-off chats. Callers fold them into one group row ranked by their sum.
export function splitClaudeAppChats<T>(
  rows: T[],
  pathOf: (row: T) => string
): { rows: T[]; chats: T[] } {
  return {
    rows: rows.filter((row) => !isClaudeAppScratchPath(pathOf(row))),
    chats: rows.filter((row) => isClaudeAppScratchPath(pathOf(row)))
  }
}

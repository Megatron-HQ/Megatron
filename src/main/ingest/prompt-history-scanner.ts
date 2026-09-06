import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { resolve } from 'path'
import { allowedReadFileSync } from '../permissions'

export interface PromptHistoryRow {
  session_id: string
  project: string
  typed_at: string
  is_slash_command: 0 | 1
}

// ponytail: /^\/[a-z][\w-]*$/i conflates tool control (/clear, /quit) with a bare skill run
// typed with no args (/visual-verify) — ~1% of lines, always in the conservative direction
// (slightly undercounts real prompts). A built-in allowlist goes stale every Claude Code
// release; a skill_invocations join is out of PR1 scope. Upgrade path: join skill_invocations.
const BARE_SLASH_COMMAND = /^\/[a-z][\w-]*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Pure: split on newlines, JSON.parse each non-empty line, skip anything malformed or missing a
// required field — mirrors parseLines in transcript-scanner.ts. No prompt text is retained; only
// the session, project, time and the derived is_slash_command flag.
export function parsePromptHistory(raw: string): PromptHistoryRow[] {
  const rows: PromptHistoryRow[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue

    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(record)) continue

    const { sessionId, project, timestamp } = record
    if (
      typeof sessionId !== 'string' ||
      typeof project !== 'string' ||
      typeof timestamp !== 'number'
    ) {
      continue
    }

    const typedAt = new Date(timestamp)
    if (Number.isNaN(typedAt.getTime())) continue

    rows.push({
      session_id: sessionId,
      project,
      typed_at: typedAt.toISOString(),
      is_slash_command: BARE_SLASH_COMMAND.test(String(record.display ?? '').trim()) ? 1 : 0
    })
  }
  return rows
}

// Wiped and reloaded each Scan (pattern: replaceAllLintFindings). A null read is a transient
// failure, not "history is empty" — leave the table as it was. An empty file is authoritative:
// clear the table. The injectable path lets tests grantPath a temp dir, same shape as
// scanTranscripts(db, projectsDir?).
export function scanPromptHistory(
  db: Database.Database,
  historyFile: string = resolve(homedir(), '.claude/history.jsonl')
): void {
  const contents = allowedReadFileSync(historyFile)
  if (contents === null) return

  const rows = parsePromptHistory(contents.toString('utf8'))
  const insert = db.prepare(
    `INSERT INTO prompt_history (session_id, project, typed_at, is_slash_command)
     VALUES (@session_id, @project, @typed_at, @is_slash_command)`
  )
  db.transaction(() => {
    db.prepare('DELETE FROM prompt_history').run()
    for (const row of rows) insert.run(row)
  })()
}

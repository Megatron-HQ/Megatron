import type Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { isPathAllowed } from '../permissions'

export interface TranscriptSession {
  session_id: string
  cwd: string
  git_branch: string | null
  started_at: string
  message_count: number
}

export type TriggerType = 'harness_command' | 'text_mention' | 'autonomous'

export interface TranscriptInvocation {
  source_uuid: string
  session_id: string
  skill_name: string
  args_text: string | null
  invoked_at: string
  trigger_type: TriggerType
}

export interface TranscriptParse {
  session: TranscriptSession | null
  invocations: TranscriptInvocation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLines(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, 'utf8').split('\n')
  const records: Record<string, unknown>[] = []
  for (const line of raw) {
    if (line.trim() === '') continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) records.push(parsed)
    } catch {
      continue
    }
  }
  return records
}

function extractSession(records: Record<string, unknown>[]): TranscriptSession | null {
  const metaRecord = records.find((record) => typeof record.cwd === 'string')
  if (metaRecord === undefined) return null
  if (typeof metaRecord.sessionId !== 'string') return null

  const startedAt = typeof metaRecord.timestamp === 'string' ? metaRecord.timestamp : null
  if (startedAt === null) return null

  const gitBranch =
    typeof metaRecord.gitBranch === 'string' && metaRecord.gitBranch !== ''
      ? metaRecord.gitBranch
      : null

  const messageCount = records.filter(
    (record) => record.type === 'user' || record.type === 'assistant'
  ).length

  return {
    session_id: metaRecord.sessionId,
    cwd: metaRecord.cwd as string,
    git_branch: gitBranch,
    started_at: startedAt,
    message_count: messageCount
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function classifyTrigger(precedingMessage: string | null, skillName: string): TriggerType {
  if (precedingMessage === null) return 'autonomous'

  const escapedSkillName = escapeRegExp(skillName)

  const harnessCommandPattern = new RegExp(`<command-name>/${escapedSkillName}</command-name>`)
  if (harnessCommandPattern.test(precedingMessage)) return 'harness_command'

  const textMentionPattern = new RegExp(`/${escapedSkillName}\\b`)
  if (textMentionPattern.test(precedingMessage)) return 'text_mention'

  return 'autonomous'
}

function extractInvocations(records: Record<string, unknown>[]): TranscriptInvocation[] {
  const invocations: TranscriptInvocation[] = []
  let precedingMessage: string | null = null

  for (const record of records) {
    if (record.isSidechain !== false) continue

    if (record.type === 'user') {
      const message = record.message
      if (isRecord(message) && typeof message.content === 'string') {
        precedingMessage = message.content
      }
      continue
    }

    const message = record.message
    if (!isRecord(message)) continue
    const content = message.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (!isRecord(block)) continue
      if (block.type !== 'tool_use' || block.name !== 'Skill') continue

      const input = block.input
      if (!isRecord(input)) continue
      const skillName = input.skill
      if (typeof skillName !== 'string') continue

      const sourceUuid = record.uuid
      const sessionId = record.sessionId
      const invokedAt = record.timestamp
      if (
        typeof sourceUuid !== 'string' ||
        typeof sessionId !== 'string' ||
        typeof invokedAt !== 'string'
      ) {
        continue
      }

      invocations.push({
        source_uuid: sourceUuid,
        session_id: sessionId,
        skill_name: skillName,
        args_text: typeof input.args === 'string' ? input.args : null,
        invoked_at: invokedAt,
        // A cascade of several invocations from one trigger message all get that same
        // message's classification, even several turns later — accepted heuristic
        // limitation, not a bug. See docs/mvp-build-spec.md, Invocation trigger
        // classification.
        trigger_type: classifyTrigger(precedingMessage, skillName)
      })
    }
  }

  return invocations
}

export function parseTranscript(filePath: string): TranscriptParse {
  if (!isPathAllowed(filePath) || !existsSync(filePath)) {
    return { session: null, invocations: [] }
  }

  const records = parseLines(filePath)
  return { session: extractSession(records), invocations: extractInvocations(records) }
}

export function scanTranscripts(
  db: Database.Database,
  projectsDir: string = resolve(homedir(), '.claude', 'projects')
): void {
  const upsertSession = db.prepare(`
    INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms)
    VALUES (@session_id, @cwd, @git_branch, @started_at, @message_count, @source_mtime_ms)
    ON CONFLICT(session_id) DO UPDATE SET
      cwd = excluded.cwd,
      git_branch = excluded.git_branch,
      started_at = excluded.started_at,
      message_count = excluded.message_count,
      source_mtime_ms = excluded.source_mtime_ms
  `)

  const insertInvocation = db.prepare(`
    INSERT OR IGNORE INTO skill_invocations
      (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type)
    VALUES (@source_uuid, @session_id, @skill_name, @args_text, @invoked_at, @trigger_type)
  `)

  const getStoredMtime = db.prepare(
    'SELECT source_mtime_ms FROM sessions_meta WHERE session_id = ?'
  )

  const runScan = db.transaction(() => {
    const seenSessionIds = new Set<string>()

    let projectDirNames: string[] = []
    if (existsSync(projectsDir)) {
      try {
        projectDirNames = readdirSync(projectsDir)
      } catch {
        projectDirNames = []
      }
    }

    for (const projectDirName of projectDirNames) {
      const projectDirPath = join(projectsDir, projectDirName)

      let projectStat: ReturnType<typeof statSync>
      try {
        projectStat = statSync(projectDirPath)
      } catch {
        continue
      }
      if (!projectStat.isDirectory()) continue

      let fileNames: string[]
      try {
        fileNames = readdirSync(projectDirPath)
      } catch {
        continue
      }

      for (const fileName of fileNames) {
        if (!fileName.endsWith('.jsonl')) continue
        const filePath = join(projectDirPath, fileName)
        if (!isPathAllowed(filePath)) continue

        let fileStat: ReturnType<typeof statSync>
        try {
          fileStat = statSync(filePath)
        } catch {
          continue
        }
        const mtimeMs = Math.round(fileStat.mtimeMs)
        const basenameSessionId = fileName.slice(0, -'.jsonl'.length)

        const stored = getStoredMtime.get(basenameSessionId) as
          { source_mtime_ms: number } | undefined
        if (stored !== undefined && stored.source_mtime_ms === mtimeMs) {
          seenSessionIds.add(basenameSessionId)
          continue
        }

        const parsed = parseTranscript(filePath)
        if (parsed.session === null) continue

        seenSessionIds.add(parsed.session.session_id)
        upsertSession.run({ ...parsed.session, source_mtime_ms: mtimeMs })
        for (const invocation of parsed.invocations) {
          insertInvocation.run(invocation)
        }
      }
    }

    if (seenSessionIds.size === 0) {
      db.prepare('DELETE FROM skill_invocations').run()
      db.prepare('DELETE FROM sessions_meta').run()
    } else {
      const placeholders = [...seenSessionIds].map(() => '?').join(', ')
      db.prepare(`DELETE FROM skill_invocations WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
      db.prepare(`DELETE FROM sessions_meta WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
    }
  })

  runScan()
}

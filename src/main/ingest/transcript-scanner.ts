import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import {
  allowedReadFileSync,
  allowedStatSync,
  isPathAllowed,
  readAllowedDirectory
} from '../permissions'
import type { TriggerType } from '../../shared/ipc'

export interface TranscriptSession {
  session_id: string
  cwd: string
  git_branch: string | null
  started_at: string
  message_count: number
}

export interface TranscriptInvocation {
  source_uuid: string
  session_id: string
  skill_name: string
  args_text: string | null
  invoked_at: string
  trigger_type: TriggerType
  agent_id: string | null
  preceding_user_text: string | null
}

interface InvocationCandidate {
  invocation: TranscriptInvocation
  source: 'structured' | 'attribution'
  turn: number
  order: number
}

const PRECEDING_TEXT_MAX_CHARS = 2000
const TRANSCRIPT_PARSER_VERSION = 1

function truncatePrecedingText(text: string | null): string | null {
  return text === null ? null : text.slice(0, PRECEDING_TEXT_MAX_CHARS)
}

export interface TranscriptParse {
  session: TranscriptSession | null
  invocations: TranscriptInvocation[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLines(filePath: string): Record<string, unknown>[] {
  const contents = allowedReadFileSync(filePath)
  if (contents === null) return []

  const raw = contents.toString('utf8').split('\n')
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

  const mentionPattern = new RegExp(`/${escapeRegExp(skillName)}\\b`)
  return mentionPattern.test(precedingMessage) ? 'user_invoked' : 'autonomous'
}

const COMMAND_NAME_PATTERN = /<command-name>\/([^<\s]+)<\/command-name>/
const COMMAND_ARGS_PATTERN = /<command-args>([^<]*)<\/command-args>/
const BASE_DIRECTORY_MARKER = 'Base directory for this skill:'

// A slash-command line only proves a real skill ran (vs. a built-in like /clear or /model) if its
// own DIRECT child record carries this marker — confirmed against real transcript data: every
// genuine skill invocation has one, no built-in ever does, and a 3-record lookahead instead of the
// parentUuid link misclassifies /clear when an unrelated record sits between it and the next
// command. See docs/mvp-build-spec.md's "Still-open gap" note.
function hasBaseDirectoryMarker(record: Record<string, unknown> | undefined): boolean {
  if (record === undefined) return false
  const message = record.message
  if (!isRecord(message)) return false
  const content = message.content
  if (typeof content === 'string') return content.includes(BASE_DIRECTORY_MARKER)
  if (!Array.isArray(content)) return false
  return content.some(
    (block) =>
      isRecord(block) &&
      typeof block.text === 'string' &&
      block.text.includes(BASE_DIRECTORY_MARKER)
  )
}

function buildChildrenByParentUuid(
  records: Record<string, unknown>[]
): Map<string, Record<string, unknown>[]> {
  const childrenByParentUuid = new Map<string, Record<string, unknown>[]>()
  for (const record of records) {
    const parentUuid = record.parentUuid
    if (typeof parentUuid !== 'string') continue
    const children = childrenByParentUuid.get(parentUuid) ?? []
    children.push(record)
    childrenByParentUuid.set(parentUuid, children)
  }
  return childrenByParentUuid
}

function extractInvocations(
  records: Record<string, unknown>[],
  agentId: string | null = null
): TranscriptInvocation[] {
  const candidates: InvocationCandidate[] = []
  const attributedSkillKeys = new Set<string>()
  const structuredSkillKeys = new Set<string>()
  let precedingMessage: string | null = null
  let userTurn = 0
  let order = 0
  const childrenByParentUuid = buildChildrenByParentUuid(records)

  const addCandidate = (
    invocation: TranscriptInvocation,
    source: InvocationCandidate['source']
  ): void => {
    const skillKey = `${userTurn}\u0000${invocation.skill_name}`
    if (source === 'attribution') {
      attributedSkillKeys.add(skillKey)
    } else {
      structuredSkillKeys.add(skillKey)
    }
    candidates.push({ invocation, source, turn: userTurn, order: order++ })
  }

  for (const record of records) {
    // Records from a dedicated subagent file (agentId !== null) are all real conversation turns
    // in their own right — there's no inline main-chain content in that file to avoid double
    // counting, unlike a main transcript's interleaved sidechain records.
    if (agentId === null && record.isSidechain !== false) continue

    if (record.type === 'user') {
      const message = record.message
      if (isRecord(message) && typeof message.content === 'string') {
        const content = message.content
        precedingMessage = content
        userTurn += 1

        const commandMatch = COMMAND_NAME_PATTERN.exec(content)
        const sourceUuid = record.uuid
        const sessionId = record.sessionId
        const invokedAt = record.timestamp

        if (
          commandMatch !== null &&
          typeof sourceUuid === 'string' &&
          typeof sessionId === 'string' &&
          typeof invokedAt === 'string' &&
          (childrenByParentUuid.get(sourceUuid) ?? []).some(hasBaseDirectoryMarker)
        ) {
          const argsMatch = COMMAND_ARGS_PATTERN.exec(content)
          const argsText = argsMatch !== null && argsMatch[1] !== '' ? argsMatch[1] : null

          addCandidate(
            {
              source_uuid: sourceUuid,
              session_id: sessionId,
              skill_name: commandMatch[1],
              args_text: argsText,
              invoked_at: invokedAt,
              trigger_type: agentId !== null ? 'subagent' : 'user_invoked',
              agent_id: agentId,
              // precedingMessage here is this same command record's own content — storing it
              // would duplicate args_text, not add ambient context. See docs/transcript-ingest.md.
              preceding_user_text: null
            },
            'structured'
          )
        }
      }
      continue
    }

    const attributedSkill =
      typeof record.attributionSkill === 'string' ? record.attributionSkill.trim() : null
    if (
      attributedSkill !== null &&
      attributedSkill !== '' &&
      !attributedSkillKeys.has(`${userTurn}\u0000${attributedSkill}`)
    ) {
      const sourceUuid = record.uuid
      const sessionId = record.sessionId
      const invokedAt = record.timestamp
      if (
        typeof sourceUuid === 'string' &&
        typeof sessionId === 'string' &&
        typeof invokedAt === 'string'
      ) {
        addCandidate(
          {
            source_uuid: sourceUuid,
            session_id: sessionId,
            skill_name: attributedSkill,
            args_text: null,
            invoked_at: invokedAt,
            trigger_type:
              agentId !== null ? 'subagent' : classifyTrigger(precedingMessage, attributedSkill),
            agent_id: agentId,
            preceding_user_text: truncatePrecedingText(precedingMessage)
          },
          'attribution'
        )
      }
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

      addCandidate(
        {
          source_uuid: sourceUuid,
          session_id: sessionId,
          skill_name: skillName,
          args_text: typeof input.args === 'string' ? input.args : null,
          invoked_at: invokedAt,
          // A cascade of several invocations from one trigger message all get that same
          // message's classification, even several turns later — accepted heuristic
          // limitation, not a bug. See docs/mvp-build-spec.md, Invocation trigger
          // classification.
          trigger_type:
            agentId !== null ? 'subagent' : classifyTrigger(precedingMessage, skillName),
          agent_id: agentId,
          preceding_user_text: truncatePrecedingText(precedingMessage)
        },
        'structured'
      )
    }
  }

  return candidates
    .filter(
      (candidate) =>
        candidate.source !== 'attribution' ||
        !structuredSkillKeys.has(`${candidate.turn}\u0000${candidate.invocation.skill_name}`)
    )
    .sort((a, b) => a.order - b.order)
    .map((candidate) => candidate.invocation)
}

export function parseTranscript(filePath: string): TranscriptParse {
  if (!isPathAllowed(filePath)) {
    return { session: null, invocations: [] }
  }

  const records = parseLines(filePath)
  return { session: extractSession(records), invocations: extractInvocations(records) }
}

// Deliberately never calls extractSession: every record in a subagent file carries the parent
// session's own sessionId and cwd, so upserting a "session" from this file would overwrite the
// parent's real sessions_meta row with the subagent's own started_at/message_count.
export function parseSubagentInvocations(filePath: string): TranscriptInvocation[] {
  if (!isPathAllowed(filePath)) return []

  const agentId = basename(filePath, '.jsonl')
  return extractInvocations(parseLines(filePath), agentId)
}

export function scanTranscripts(
  db: Database.Database,
  projectsDir: string = resolve(homedir(), '.claude', 'projects')
): void {
  const upsertSession = db.prepare(`
    INSERT INTO sessions_meta
      (session_id, cwd, git_branch, started_at, message_count, source_mtime_ms, source_size_bytes,
       transcript_parser_version)
    VALUES
      (@session_id, @cwd, @git_branch, @started_at, @message_count, @source_mtime_ms, @source_size_bytes,
       @transcript_parser_version)
    ON CONFLICT(session_id) DO UPDATE SET
      cwd = excluded.cwd,
      git_branch = excluded.git_branch,
      started_at = excluded.started_at,
      message_count = excluded.message_count,
      source_mtime_ms = excluded.source_mtime_ms,
      source_size_bytes = excluded.source_size_bytes,
      transcript_parser_version = excluded.transcript_parser_version
  `)

  const insertInvocation = db.prepare(`
    INSERT OR IGNORE INTO skill_invocations
      (source_uuid, session_id, skill_name, args_text, invoked_at, trigger_type, agent_id, preceding_user_text)
    VALUES (@source_uuid, @session_id, @skill_name, @args_text, @invoked_at, @trigger_type, @agent_id, @preceding_user_text)
  `)

  const deleteSessionInvocations = db.prepare('DELETE FROM skill_invocations WHERE session_id = ?')

  const getStoredMtime = db.prepare(
    `SELECT source_mtime_ms, source_size_bytes, transcript_parser_version
     FROM sessions_meta WHERE session_id = ?`
  )

  const runScan = db.transaction(() => {
    const seenSessionIds = new Set<string>()
    let scanIsAuthoritative = true

    const projectsDirectory = readAllowedDirectory(projectsDir)
    if (projectsDirectory.status === 'unavailable') return

    for (const projectDirName of projectsDirectory.entries) {
      const projectDirPath = join(projectsDir, projectDirName)

      const projectStat = allowedStatSync(projectDirPath)
      if (projectStat === null || !projectStat.isDirectory()) continue

      const projectDirectory = readAllowedDirectory(projectDirPath)
      if (projectDirectory.status === 'unavailable') {
        scanIsAuthoritative = false
        continue
      }

      for (const fileName of projectDirectory.entries) {
        if (!fileName.endsWith('.jsonl')) continue
        const filePath = join(projectDirPath, fileName)
        if (!isPathAllowed(filePath)) continue

        const fileStat = allowedStatSync(filePath)
        if (fileStat === null) continue
        const basenameSessionId = fileName.slice(0, -'.jsonl'.length)

        // A subagent transcript can be written after its parent's mtime was last cached, so
        // freshness is the max of the parent and every one of its subagent files — any of them
        // changing forces a rescan of this session.
        const subagentsDir = join(projectDirPath, basenameSessionId, 'subagents')
        const subagentsDirectory = readAllowedDirectory(subagentsDir)
        const subagentsStat = allowedStatSync(subagentsDir)
        if (subagentsStat?.isDirectory() && subagentsDirectory.status !== 'ok') {
          scanIsAuthoritative = false
          continue
        }
        const subagentFilePaths = subagentsDirectory.entries
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) => join(subagentsDir, name))
        const subagentStats = subagentFilePaths
          .map((path) => allowedStatSync(path))
          .filter((stat): stat is NonNullable<typeof stat> => stat !== null)
        const subagentMtimes = subagentStats.map((stat) => stat.mtimeMs)

        const mtimeMs = Math.round(Math.max(fileStat.mtimeMs, ...subagentMtimes))
        const sourceSizeBytes =
          fileStat.size + subagentStats.reduce((total, stat) => total + stat.size, 0)

        const stored = getStoredMtime.get(basenameSessionId) as
          | {
              source_mtime_ms: number
              source_size_bytes: number
              transcript_parser_version: number
            }
          | undefined
        if (
          stored !== undefined &&
          stored.source_mtime_ms === mtimeMs &&
          stored.source_size_bytes === sourceSizeBytes &&
          stored.transcript_parser_version === TRANSCRIPT_PARSER_VERSION
        ) {
          seenSessionIds.add(basenameSessionId)
          continue
        }

        const parsed = parseTranscript(filePath)
        if (parsed.session === null) {
          scanIsAuthoritative = false
          continue
        }

        seenSessionIds.add(parsed.session.session_id)
        upsertSession.run({
          ...parsed.session,
          source_mtime_ms: mtimeMs,
          source_size_bytes: sourceSizeBytes,
          transcript_parser_version: TRANSCRIPT_PARSER_VERSION
        })
        deleteSessionInvocations.run(parsed.session.session_id)
        for (const invocation of parsed.invocations) {
          insertInvocation.run(invocation)
        }
        for (const subagentFilePath of subagentFilePaths) {
          for (const invocation of parseSubagentInvocations(subagentFilePath)) {
            insertInvocation.run(invocation)
          }
        }
      }
    }

    if (!scanIsAuthoritative) return

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

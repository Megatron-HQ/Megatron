import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import {
  allowedStatSync,
  isPathAllowed,
  readAllowedDirectory,
  visitAllowedUtf8LinesSync
} from '../permissions'
import type { TriggerType } from '../../shared/ipc'
import {
  extractCostState,
  extractTurnUsage,
  toModelCostRows,
  type SessionCost,
  type TurnUsageRow
} from './cost-parser'
import { rebuildSessionSkillCosts } from './skill-cost-allocation'

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
// Bumps on any parser-semantic change across the whole walk, cost-state included (no separate
// cost_parser_version — see docs/usage-analytics.md §8). A bump forces one safe reindex of all
// already-indexed sessions. 3→4: cost-state ingest (session_cost / session_model_cost).
const TRANSCRIPT_PARSER_VERSION = 5

function truncatePrecedingText(text: string | null): string | null {
  return text === null ? null : text.slice(0, PRECEDING_TEXT_MAX_CHARS)
}

export interface TranscriptParse {
  session: TranscriptSession | null
  invocations: TranscriptInvocation[]
  turns: TurnUsageRow[]
  // The last cost-state line's parsed shape, or null when the transcript has none (pre-v2.1.241
  // history). Main transcripts only — subagent cost is already inside the parent's total.
  cost: SessionCost | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (record.type !== 'user' && record.type !== 'assistant') return record
  const message = record.message
  if (!isRecord(message) || !Array.isArray(message.content)) return record

  const content = message.content.flatMap((block): Record<string, unknown>[] => {
    if (!isRecord(block)) return []
    if (block.type === 'tool_result') return [{ type: 'tool_result' }]
    if (block.type === 'tool_use' && block.name === 'Skill') return [block]
    if (block.type === 'text' && typeof block.text === 'string') {
      return [
        block.text.includes(BASE_DIRECTORY_MARKER)
          ? { type: 'text', text: BASE_DIRECTORY_MARKER }
          : block
      ]
    }
    return []
  })

  return { ...record, message: { ...message, content } }
}

function parseLines(filePath: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  visitAllowedUtf8LinesSync(filePath, (line) => {
    if (line.trim() === '') return
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) records.push(compactRecord(parsed))
    } catch {
      return
    }
  })
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

// A real chat turn's content is either a plain string, or an array of blocks the human actually
// authored (text, image). Two other record shapes are also role:user and array-shaped, but
// aren't a chat turn to attribute to the human, so both mean "skip", matching the pre-existing
// behavior: a tool_result turn (the harness feeding a tool's output back to the assistant), and
// a slash command's own base-directory marker child (see hasBaseDirectoryMarker below — same
// constant, so a turn is never treated as "trigger text" by one check and "marker" by the
// other). An image-only array (no text block) has nothing to extract either.
function extractUserTurnText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  if (content.some((block) => isRecord(block) && block.type === 'tool_result')) return null
  const text = content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => (block as Record<string, unknown>).text as string)
    .join('')
  return text === '' || text.includes(BASE_DIRECTORY_MARKER) ? null : text
}

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
      const userText = isRecord(message) ? extractUserTurnText(message.content) : null
      if (userText !== null) {
        const content = userText
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
          const slashCommandText =
            argsText !== null ? `/${commandMatch[1]} ${argsText}` : `/${commandMatch[1]}`

          addCandidate(
            {
              source_uuid: sourceUuid,
              session_id: sessionId,
              skill_name: commandMatch[1],
              args_text: argsText,
              invoked_at: invokedAt,
              trigger_type: agentId !== null ? 'subagent' : 'user_invoked',
              agent_id: agentId,
              preceding_user_text: truncatePrecedingText(slashCommandText)
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
    return { session: null, invocations: [], turns: [], cost: null }
  }

  const records = parseLines(filePath)
  return {
    session: extractSession(records),
    invocations: extractInvocations(records),
    turns: extractTurnUsage(records),
    cost: extractCostState(records)
  }
}

interface SubagentParse {
  invocations: TranscriptInvocation[]
  turns: TurnUsageRow[]
}

function parseSubagent(filePath: string): SubagentParse {
  if (!isPathAllowed(filePath)) return { invocations: [], turns: [] }
  const agentId = basename(filePath, '.jsonl')
  const records = parseLines(filePath)
  return {
    invocations: extractInvocations(records, agentId),
    turns: extractTurnUsage(records, agentId)
  }
}

// Deliberately never calls extractSession: every record in a subagent file carries the parent
// session's own sessionId and cwd, so upserting a "session" from this file would overwrite the
// parent's real sessions_meta row with the subagent's own started_at/message_count.
export function parseSubagentInvocations(filePath: string): TranscriptInvocation[] {
  return parseSubagent(filePath).invocations
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
  const deleteSessionTurns = db.prepare('DELETE FROM turn_usage WHERE session_id = ?')

  const insertTurn = db.prepare(`
    INSERT INTO turn_usage
      (logical_turn_key, source_uuid, session_id, request_id, message_id, turn_index, model,
       effort, input_tokens, cache_read_tokens, cache_creation_tokens,
       cache_creation_5m_tokens, cache_creation_1h_tokens, output_tokens, thinking_tokens,
       web_search_requests, agent_id, active_skill, invoked_at)
    VALUES
      (@logical_turn_key, @source_uuid, @session_id, @request_id, @message_id, @turn_index, @model,
       @effort, @input_tokens, @cache_read_tokens, @cache_creation_tokens,
       @cache_creation_5m_tokens, @cache_creation_1h_tokens, @output_tokens, @thinking_tokens,
       @web_search_requests, @agent_id, @active_skill, @invoked_at)
  `)

  // session_model_cost rows cascade off session_cost (ON DELETE CASCADE); FKs are enabled by
  // applySchema, so a bare DELETE here also clears the per-model rows.
  const deleteSessionCost = db.prepare('DELETE FROM session_cost WHERE session_id = ?')

  const insertSessionCost = db.prepare(`
    INSERT INTO session_cost
      (session_id, total_cost_usd, has_unknown_model_cost, is_zeroed, continued_in_session_id)
    VALUES
      (@session_id, @total_cost_usd, @has_unknown_model_cost, @is_zeroed, @continued_in_session_id)
  `)

  const insertModelCost = db.prepare(`
    INSERT INTO session_model_cost
      (session_id, model, cost_usd, input_tokens, output_tokens, thinking_tokens,
       cache_read_tokens, cache_creation_tokens, web_search_requests)
    VALUES
      (@session_id, @model, @cost_usd, @input_tokens, @output_tokens, @thinking_tokens,
       @cache_read_tokens, @cache_creation_tokens, @web_search_requests)
  `)

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
        deleteSessionTurns.run(parsed.session.session_id)
        deleteSessionCost.run(parsed.session.session_id)
        if (parsed.cost !== null) {
          insertSessionCost.run({
            session_id: parsed.session.session_id,
            total_cost_usd: parsed.cost.totalCostUsd,
            has_unknown_model_cost: parsed.cost.hasUnknownModelCost ? 1 : 0,
            is_zeroed: parsed.cost.isZeroed ? 1 : 0,
            continued_in_session_id: parsed.cost.continuedInSessionId
          })
          for (const row of toModelCostRows(parsed.cost)) {
            insertModelCost.run({ session_id: parsed.session.session_id, ...row })
          }
        }
        for (const invocation of parsed.invocations) {
          insertInvocation.run(invocation)
        }
        for (const turn of parsed.turns) {
          insertTurn.run(turn)
        }
        for (const subagentFilePath of subagentFilePaths) {
          const subagent = parseSubagent(subagentFilePath)
          for (const invocation of subagent.invocations) {
            insertInvocation.run(invocation)
          }
          for (const turn of subagent.turns) insertTurn.run(turn)
        }
      }
    }

    if (!scanIsAuthoritative) {
      rebuildSessionSkillCosts(db)
      return
    }

    // session_cost is deleted before sessions_meta: its FK to sessions_meta has no cascade, so a
    // parent row can't go first. session_model_cost follows session_cost via cascade.
    if (seenSessionIds.size === 0) {
      db.prepare('DELETE FROM skill_invocations').run()
      db.prepare('DELETE FROM turn_usage').run()
      db.prepare('DELETE FROM session_cost').run()
      db.prepare('DELETE FROM sessions_meta').run()
    } else {
      const placeholders = [...seenSessionIds].map(() => '?').join(', ')
      db.prepare(`DELETE FROM skill_invocations WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
      db.prepare(`DELETE FROM turn_usage WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
      db.prepare(`DELETE FROM session_cost WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
      db.prepare(`DELETE FROM sessions_meta WHERE session_id NOT IN (${placeholders})`).run(
        ...seenSessionIds
      )
    }
    rebuildSessionSkillCosts(db)
  })

  runScan()
}

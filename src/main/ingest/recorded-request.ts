import { homedir } from 'os'
import { join, resolve } from 'path'
import { allowedStatSync, readAllowedDirectory, visitAllowedUtf8LinesSync } from '../permissions'
import type {
  RecordedCacheBreakpoint,
  RecordedCacheControl,
  RecordedRequest,
  RecordedSystemBlock,
  RecordedTextBlock,
  RecordedTool
} from '../../shared/ipc'
import { compareSemver } from '../../shared/version'

// Headless (`-p` / SDK) sessions record `sdk` and run a different system prompt; they never
// describe what an interactive session carries.
const INTERACTIVE_QUERY_SOURCE = 'repl_main_thread'
// The first Claude Code release that writes api-request / api-request-shape records.
const FIRST_RECORDING_VERSION = '2.1.300'

type TranscriptRecord = Record<string, unknown>

function isRecord(value: unknown): value is TranscriptRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cacheControlOf(value: unknown): RecordedCacheControl | null {
  if (!isRecord(value)) return null
  return {
    ttl: typeof value.ttl === 'string' ? value.ttl : null,
    scope: typeof value.scope === 'string' ? value.scope : null
  }
}

function formatPath(path: unknown): string | null {
  if (!Array.isArray(path) || path.length === 0) return null
  let formatted = ''
  for (const part of path) {
    if (typeof part === 'number') formatted += `[${part}]`
    else if (typeof part === 'string') formatted += formatted === '' ? part : `.${part}`
    else return null
  }
  return formatted
}

function textBlock(name: string, text: string): RecordedTextBlock {
  return { name, text, chars: text.length }
}

function hookOutputs(records: TranscriptRecord[]): RecordedTextBlock[] {
  return records.flatMap((record) => {
    const attachment = record.type === 'attachment' ? record.attachment : null
    if (
      !isRecord(attachment) ||
      attachment.type !== 'hook_success' ||
      attachment.hookEvent !== 'SessionStart' ||
      attachment.exitCode !== 0
    )
      return []
    const text =
      typeof attachment.content === 'string'
        ? attachment.content
        : typeof attachment.stdout === 'string'
          ? attachment.stdout.trimEnd()
          : null
    if (text === null || text === '') return []
    const name =
      typeof attachment.hookName === 'string' && attachment.hookName !== ''
        ? attachment.hookName
        : 'SessionStart'
    return [textBlock(name, text)]
  })
}

function mcpInstructions(records: TranscriptRecord[]): RecordedTextBlock[] {
  const byServer = new Map<string, string>()
  for (const record of records) {
    const attachment = record.type === 'attachment' ? record.attachment : null
    if (!isRecord(attachment) || attachment.type !== 'mcp_instructions_delta') continue
    const names = Array.isArray(attachment.addedNames) ? attachment.addedNames : []
    const blocks = Array.isArray(attachment.addedBlocks) ? attachment.addedBlocks : []
    blocks.forEach((block, index) => {
      const text =
        typeof block === 'string'
          ? block
          : isRecord(block)
            ? [block.content, block.text, block.instructions].find(
                (value): value is string => typeof value === 'string'
              )
            : undefined
      if (text === undefined) return
      const name = [names[index], isRecord(block) ? block.name : undefined].find(
        (value): value is string => typeof value === 'string'
      )
      byServer.set(name ?? `Server ${index + 1}`, text)
    })
    if (Array.isArray(attachment.removedNames)) {
      for (const name of attachment.removedNames)
        if (typeof name === 'string') byServer.delete(name)
    }
  }
  return [...byServer].map(([name, text]) => textBlock(name, text))
}

export function extractRecordedRequest(records: TranscriptRecord[]): RecordedRequest | null {
  const requestIndex = records.findIndex(
    (record) => record.type === 'api-request' && record.querySource === INTERACTIVE_QUERY_SOURCE
  )
  if (requestIndex === -1) return null
  const request = records[requestIndex]
  const shapeRecord = records.find(
    (record) => record.type === 'api-request-shape' && record.shapeHash === request.shapeHash
  )
  const shape = isRecord(shapeRecord?.shape) ? shapeRecord.shape : null
  if (
    shape === null ||
    typeof request.shapeHash !== 'string' ||
    typeof request.sessionId !== 'string' ||
    typeof request.version !== 'string' ||
    typeof request.timestamp !== 'string'
  )
    return null

  const breakpoints: RecordedCacheBreakpoint[] = (
    Array.isArray(request.cacheControl) ? request.cacheControl : []
  ).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const path = formatPath(entry.path)
    const cacheControl = cacheControlOf(entry.value)
    return path === null || cacheControl === null ? [] : [{ path, cacheControl }]
  })
  const breakpointAt = new Map(breakpoints.map((entry) => [entry.path, entry.cacheControl]))

  const system =
    typeof shape.system === 'string'
      ? [{ type: 'text', text: shape.system }]
      : Array.isArray(shape.system)
        ? shape.system
        : []
  const systemBlocks: RecordedSystemBlock[] = system.flatMap((block, index) =>
    isRecord(block) && typeof block.text === 'string'
      ? [
          {
            text: block.text,
            chars: block.text.length,
            cacheControl: breakpointAt.get(`system[${index}]`) ?? null
          }
        ]
      : []
  )

  const tools: RecordedTool[] = (Array.isArray(shape.tools) ? shape.tools : [])
    .flatMap((tool): RecordedTool[] =>
      isRecord(tool) && typeof tool.name === 'string'
        ? [
            {
              name: tool.name,
              chars: JSON.stringify(tool).length,
              definitionJson: JSON.stringify(tool, null, 2),
              isMcp: tool.name.startsWith('mcp__')
            }
          ]
        : []
    )
    .sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name))

  // Only what was injected before the request counts as resident context.
  const preamble = records.slice(0, requestIndex)
  const cwd = records.find((record) => typeof record.cwd === 'string')?.cwd
  const params = isRecord(request.params) ? request.params : {}

  return {
    sessionId: request.sessionId,
    cwd: typeof cwd === 'string' ? cwd : null,
    claudeVersion: request.version,
    requestedAt: request.timestamp,
    model: typeof params.model === 'string' ? params.model : null,
    systemBlocks,
    tools,
    cacheBreakpoints: breakpoints,
    hookOutputs: hookOutputs(preamble),
    mcpInstructions: mcpInstructions(preamble)
  }
}

class StopReading extends Error {}

function isRetained(record: TranscriptRecord, haveCwd: boolean): boolean {
  return (
    record.type === 'api-request' ||
    record.type === 'api-request-shape' ||
    record.type === 'attachment' ||
    (!haveCwd && typeof record.cwd === 'string')
  )
}

function readRecordedRequest(path: string): RecordedRequest | null {
  const records: TranscriptRecord[] = []
  const shapeHashes = new Set<string>()
  let requestShapeHash: string | null = null
  let versionChecked = false
  let haveCwd = false
  try {
    const status = visitAllowedUtf8LinesSync(path, (line) => {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        return
      }
      if (!isRecord(record)) return
      if (!versionChecked && typeof record.version === 'string') {
        versionChecked = true
        // An older transcript can't contain request records; don't read the rest of it.
        if ((compareSemver(record.version, FIRST_RECORDING_VERSION) ?? 0) < 0)
          throw new StopReading()
      }
      if (!isRetained(record, haveCwd)) return
      records.push(record)
      haveCwd ||= typeof record.cwd === 'string'
      if (record.type === 'api-request-shape' && typeof record.shapeHash === 'string')
        shapeHashes.add(record.shapeHash)
      if (
        requestShapeHash === null &&
        record.type === 'api-request' &&
        record.querySource === INTERACTIVE_QUERY_SOURCE &&
        typeof record.shapeHash === 'string'
      )
        requestShapeHash = record.shapeHash
      // Everything the dialog shows precedes the first request; the rest is conversation.
      if (requestShapeHash !== null && shapeHashes.has(requestShapeHash)) throw new StopReading()
    })
    if (status !== 'ok') return null
  } catch (error) {
    if (!(error instanceof StopReading)) throw error
  }
  return extractRecordedRequest(records)
}

// Newest first by mtime: the most recently active interactive session best reflects the user's
// current setup. Subagent transcripts live a level deeper (<session>/subagents/) and are never
// candidates.
export function findNewestRecordedRequest(
  projectsDir: string = resolve(homedir(), '.claude', 'projects')
): RecordedRequest | null {
  const candidates: { path: string; mtimeMs: number }[] = []
  for (const project of readAllowedDirectory(projectsDir).entries) {
    const projectPath = join(projectsDir, project)
    if (!allowedStatSync(projectPath)?.isDirectory()) continue
    for (const name of readAllowedDirectory(projectPath).entries) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(projectPath, name)
      const stat = allowedStatSync(path)
      if (stat?.isFile()) candidates.push({ path, mtimeMs: stat.mtimeMs })
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { path } of candidates) {
    const recorded = readRecordedRequest(path)
    if (recorded !== null) return recorded
  }
  return null
}

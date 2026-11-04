import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import { extractRecordedRequest, findNewestRecordedRequest } from './recorded-request'

// Record shapes follow a real Claude Code 2.1.314 transcript: the shape record (system blocks
// and full tool definitions) precedes the api-request that references it by shapeHash, and
// cache breakpoints live on the request, not the shape.
const bashTool = {
  name: 'Bash',
  description: 'Run a shell command',
  input_schema: { type: 'object' }
}
const mcpTool = {
  name: 'mcp__docs__search',
  description: 'Search the documentation index for a query and return ranked passages',
  input_schema: { type: 'object', properties: { query: { type: 'string' } } }
}

function shape(hash: string, system: string[], tools: unknown[]): Record<string, unknown> {
  return {
    type: 'api-request-shape',
    sessionId: 's1',
    shapeHash: hash,
    version: '2.1.314',
    timestamp: '2026-11-04T02:07:13.362Z',
    shape: { system: system.map((text) => ({ type: 'text', text })), tools }
  }
}

function request(
  hash: string,
  querySource: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'api-request',
    sessionId: 's1',
    version: '2.1.314',
    timestamp: '2026-11-04T02:07:13.400Z',
    querySource,
    shapeHash: hash,
    params: { model: 'claude-opus-5-5' },
    cacheControl: [],
    ...fields
  }
}

function attachment(value: Record<string, unknown>): Record<string, unknown> {
  return { type: 'attachment', timestamp: '2026-11-04T02:07:12.944Z', attachment: value }
}

const interactiveRecords: Record<string, unknown>[] = [
  { type: 'user', sessionId: 's1', cwd: '/Users/me/project', version: '2.1.314' },
  attachment({
    type: 'hook_success',
    hookEvent: 'SessionStart',
    hookName: 'SessionStart:startup',
    exitCode: 0,
    content: 'PONYTAIL MODE ACTIVE'
  }),
  attachment({
    type: 'hook_success',
    hookEvent: 'SessionStart',
    hookName: 'SessionStart:broken',
    exitCode: 1,
    content: 'boom'
  }),
  attachment({
    type: 'mcp_instructions_delta',
    addedNames: ['docs', 'chrome'],
    addedBlocks: ['## docs\nUse docs first.', '## chrome\nLoad tools in one call.'],
    removedNames: []
  }),
  shape('first', ['You are Claude Code.', 'Environment details'], [bashTool, mcpTool]),
  request('first', 'repl_main_thread', {
    cacheControl: [
      { path: ['system', 1], value: { type: 'ephemeral', ttl: '1h', scope: 'global' } },
      { path: ['messages', 1, 'content', 3], value: { type: 'ephemeral', ttl: '1h' } }
    ]
  }),
  shape('later', ['A different prompt'], []),
  request('later', 'repl_main_thread')
]

describe('extractRecordedRequest', () => {
  it("reads the first interactive request's system blocks and cache breakpoints", () => {
    const recorded = extractRecordedRequest(interactiveRecords)
    expect(recorded?.systemBlocks).toEqual([
      { text: 'You are Claude Code.', chars: 20, cacheControl: null },
      { text: 'Environment details', chars: 19, cacheControl: { ttl: '1h', scope: 'global' } }
    ])
    expect(recorded?.cacheBreakpoints).toEqual([
      { path: 'system[1]', cacheControl: { ttl: '1h', scope: 'global' } },
      { path: 'messages[1].content[3]', cacheControl: { ttl: '1h', scope: null } }
    ])
  })

  it('ranks tool definitions by their serialized size and flags MCP tools', () => {
    const tools = extractRecordedRequest(interactiveRecords)?.tools
    expect(tools?.map((tool) => [tool.name, tool.chars, tool.isMcp])).toEqual([
      ['mcp__docs__search', JSON.stringify(mcpTool).length, true],
      ['Bash', JSON.stringify(bashTool).length, false]
    ])
    expect(JSON.parse(tools?.[1].definitionJson ?? '')).toEqual(bashTool)
  })

  it('keeps successful SessionStart hook output and named MCP instruction blocks', () => {
    const recorded = extractRecordedRequest(interactiveRecords)
    expect(recorded?.hookOutputs).toEqual([
      { name: 'SessionStart:startup', text: 'PONYTAIL MODE ACTIVE', chars: 20 }
    ])
    expect(recorded?.mcpInstructions).toEqual([
      { name: 'docs', text: '## docs\nUse docs first.', chars: 23 },
      { name: 'chrome', text: '## chrome\nLoad tools in one call.', chars: 33 }
    ])
  })

  it('records where and when the request was made', () => {
    expect(extractRecordedRequest(interactiveRecords)).toMatchObject({
      sessionId: 's1',
      cwd: '/Users/me/project',
      claudeVersion: '2.1.314',
      requestedAt: '2026-11-04T02:07:13.400Z',
      model: 'claude-opus-5-5'
    })
  })

  it('ignores headless requests', () => {
    const records = [
      shape('headless', ['SDK prompt'], []),
      request('headless', 'sdk'),
      shape('interactive', ['REPL prompt'], []),
      request('interactive', 'repl_main_thread')
    ]
    expect(extractRecordedRequest(records)?.systemBlocks.map((block) => block.text)).toEqual([
      'REPL prompt'
    ])
    expect(extractRecordedRequest(records.slice(0, 2))).toBeNull()
  })

  it('returns null for a transcript recorded before request shapes existed', () => {
    expect(
      extractRecordedRequest([
        { type: 'user', sessionId: 'old', cwd: '/Users/me/project', version: '2.1.200' },
        { type: 'assistant', sessionId: 'old', message: { model: 'claude-opus-4-1' } }
      ])
    ).toBeNull()
  })

  it('returns null when the referenced shape was never recorded', () => {
    expect(extractRecordedRequest([request('missing', 'repl_main_thread')])).toBeNull()
  })
})

describe('findNewestRecordedRequest', () => {
  let projectsDir: string

  function writeTranscript(
    project: string,
    sessionId: string,
    records: Record<string, unknown>[],
    mtimeSeconds: number
  ): void {
    const directory = join(projectsDir, project)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${sessionId}.jsonl`)
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
    utimesSync(path, mtimeSeconds, mtimeSeconds)
  }

  function withSession(
    records: Record<string, unknown>[],
    sessionId: string
  ): Record<string, unknown>[] {
    return records.map((record) => ({ ...record, sessionId }))
  }

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), 'megatron-recorded-request-'))
    grantPath(projectsDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    rmSync(projectsDir, { recursive: true, force: true })
  })

  it('returns the newest interactive transcript across projects', () => {
    writeTranscript('-Users-me-a', 'older', withSession(interactiveRecords, 'older'), 1_000)
    writeTranscript('-Users-me-b', 'newer', withSession(interactiveRecords, 'newer'), 2_000)
    expect(findNewestRecordedRequest(projectsDir)?.sessionId).toBe('newer')
  })

  it('falls back past a newer headless transcript', () => {
    writeTranscript(
      '-Users-me-a',
      'interactive',
      withSession(interactiveRecords, 'interactive'),
      1_000
    )
    writeTranscript(
      '-Users-me-a',
      'headless',
      [shape('h', ['SDK prompt'], []), request('h', 'sdk', { sessionId: 'headless' })],
      2_000
    )
    expect(findNewestRecordedRequest(projectsDir)?.sessionId).toBe('interactive')
  })

  it('skips transcripts written before Claude Code 2.1.300', () => {
    const old = [
      { type: 'user', sessionId: 'old', cwd: '/Users/me/project', version: '2.1.299' },
      ...interactiveRecords.slice(1)
    ]
    writeTranscript('-Users-me-a', 'old', old, 1_000)
    expect(findNewestRecordedRequest(projectsDir)).toBeNull()
  })

  it('ignores subagent transcripts', () => {
    const subagents = join(projectsDir, '-Users-me-a', 'parent', 'subagents')
    mkdirSync(subagents, { recursive: true })
    writeFileSync(
      join(subagents, 'agent-1.jsonl'),
      interactiveRecords.map((record) => JSON.stringify(record)).join('\n')
    )
    expect(findNewestRecordedRequest(projectsDir)).toBeNull()
  })

  it('returns null outside the approved folders', () => {
    writeTranscript('-Users-me-a', 'interactive', interactiveRecords, 1_000)
    resetGrantedPaths()
    expect(findNewestRecordedRequest(projectsDir)).toBeNull()
  })
})

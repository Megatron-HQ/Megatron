import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths } from '../permissions'
import { parseSubagentInvocations, parseTranscript, scanTranscripts } from './transcript-scanner'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

function linesToJsonl(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

function writeTranscriptFile(dirPath: string, sessionId: string, lines: unknown[]): string {
  mkdirSync(dirPath, { recursive: true })
  const filePath = join(dirPath, `${sessionId}.jsonl`)
  writeFileSync(filePath, linesToJsonl(lines))
  return filePath
}

function writeSubagentTranscriptFile(
  projectDir: string,
  parentSessionId: string,
  agentFileStem: string,
  lines: unknown[]
): string {
  const subagentsDir = join(projectDir, parentSessionId, 'subagents')
  mkdirSync(subagentsDir, { recursive: true })
  const filePath = join(subagentsDir, `${agentFileStem}.jsonl`)
  writeFileSync(filePath, linesToJsonl(lines))
  return filePath
}

function metaLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'user',
    sessionId: 'sess-1',
    cwd: '/repo',
    gitBranch: 'main',
    timestamp: '2024-01-01T00:00:00.000Z',
    uuid: 'uuid-meta',
    isSidechain: false,
    message: { content: 'hello' },
    ...overrides
  }
}

function skillInvocationLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'assistant',
    sessionId: 'sess-1',
    timestamp: '2024-01-01T00:01:00.000Z',
    uuid: 'uuid-invocation',
    isSidechain: false,
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'block-id',
          name: 'Skill',
          input: { skill: 'my-skill', args: 'do it' }
        }
      ]
    },
    ...overrides
  }
}

describe('parseTranscript', () => {
  it('uses a later cwd-bearing line when line 0 is a header with no cwd', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [{ type: 'mode' }, metaLine()])

    const result = parseTranscript(filePath)

    expect(result.session).toEqual({
      session_id: 'sess-1',
      cwd: '/repo',
      git_branch: 'main',
      started_at: '2024-01-01T00:00:00.000Z',
      message_count: 1
    })
  })

  it('sets git_branch to NULL when gitBranch is missing', () => {
    const line = metaLine()
    delete line.gitBranch
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [line])

    expect(parseTranscript(filePath).session?.git_branch).toBeNull()
  })

  it('sets git_branch to NULL when gitBranch is empty', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine({ gitBranch: '' })])

    expect(parseTranscript(filePath).session?.git_branch).toBeNull()
  })

  it('counts only user/assistant lines toward message_count', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
      metaLine({ type: 'user' }),
      { type: 'summary', sessionId: 'sess-1' },
      { type: 'assistant', sessionId: 'sess-1', isSidechain: false, message: { content: 'ok' } },
      { type: 'mode', sessionId: 'sess-1' }
    ])

    expect(parseTranscript(filePath).session?.message_count).toBe(2)
  })

  it('maps a Skill tool_use block to one invocation with source_uuid from the line, not the block', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), skillInvocationLine()])

    const result = parseTranscript(filePath)

    expect(result.invocations).toEqual([
      {
        source_uuid: 'uuid-invocation',
        session_id: 'sess-1',
        skill_name: 'my-skill',
        args_text: 'do it',
        invoked_at: '2024-01-01T00:01:00.000Z',
        trigger_type: 'autonomous',
        agent_id: null,
        preceding_user_text: 'hello'
      }
    ])
  })

  it('ignores non-Skill tool_use blocks and plain text blocks', () => {
    const line = skillInvocationLine({
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'block-id', name: 'Bash', input: { command: 'ls' } }
        ]
      }
    })
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), line])

    expect(parseTranscript(filePath).invocations).toEqual([])
  })

  it('excludes an invocation from an isSidechain: true line', () => {
    const line = skillInvocationLine({ isSidechain: true })
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), line])

    expect(parseTranscript(filePath).invocations).toEqual([])
  })

  it('skips a malformed JSON line mid-file without throwing, ingesting surrounding valid lines', () => {
    const filePath = join(tmpDir, 'sess-1.jsonl')
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(
      filePath,
      [
        JSON.stringify(metaLine()),
        'not valid json {{{',
        JSON.stringify(skillInvocationLine())
      ].join('\n')
    )

    expect(() => parseTranscript(filePath)).not.toThrow()
    const result = parseTranscript(filePath)
    expect(result.session?.session_id).toBe('sess-1')
    expect(result.invocations).toHaveLength(1)
  })

  it('skips lines with missing message, non-array content, or tool_use with no input, without throwing', () => {
    const noMessage = { ...skillInvocationLine(), message: undefined }
    delete noMessage.message
    const stringContent = skillInvocationLine({ message: { content: 'just text' } })
    const noInput = skillInvocationLine({
      message: { content: [{ type: 'tool_use', id: 'block-id', name: 'Skill' }] }
    })
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
      metaLine(),
      noMessage,
      stringContent,
      noInput
    ])

    expect(() => parseTranscript(filePath)).not.toThrow()
    expect(parseTranscript(filePath).invocations).toEqual([])
  })

  it('keys the session on sessionId (camelCase), not session_id (snake_case)', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
      metaLine({ session_id: 'wrong-id', sessionId: 'correct-id' })
    ])

    expect(parseTranscript(filePath).session?.session_id).toBe('correct-id')
  })

  it('produces no session when no line carries a cwd field', () => {
    const line = metaLine()
    delete line.cwd
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [line])

    expect(parseTranscript(filePath).session).toBeNull()
  })

  describe('trigger_type classification', () => {
    function skillLine(
      skillName: string,
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
      return skillInvocationLine({
        message: {
          content: [
            { type: 'tool_use', id: 'block-id', name: 'Skill', input: { skill: skillName } }
          ]
        },
        ...overrides
      })
    }

    it('classifies a harness slash-command tag as user_invoked', () => {
      const trigger = metaLine({
        message: { content: '<command-name>/my-skill</command-name><command-args></command-args>' }
      })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('my-skill')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('user_invoked')
    })

    it('classifies a bare slash-mention in free text as user_invoked', () => {
      const trigger = metaLine({ message: { content: 'please run /my-skill for me' } })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('my-skill')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('user_invoked')
    })

    it('classifies as autonomous when neither pattern matches', () => {
      const trigger = metaLine({ message: { content: 'do something unrelated' } })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('my-skill')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('autonomous')
    })

    it('does not let /grill-mean false-match /grill-me (word-boundary check)', () => {
      const trigger = metaLine({ message: { content: 'please run /grill-mean now' } })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('grill-me')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('autonomous')
    })

    it('attributes correctly across several intervening assistant/tool-result turns', () => {
      const trigger = metaLine({ message: { content: '/my-skill please' } })
      const assistantTurn = {
        type: 'assistant',
        sessionId: 'sess-1',
        isSidechain: false,
        message: { content: [{ type: 'text', text: 'working on it' }] }
      }
      const toolResultUserTurn = {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'result' }] }
      }
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
        trigger,
        assistantTurn,
        toolResultUserTurn,
        skillLine('my-skill')
      ])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('user_invoked')
    })

    it('skips a tool-result-carrying array-content user line rather than treating it as the trigger', () => {
      const trigger = metaLine({ message: { content: 'no mention of any skill here' } })
      const toolResultUserTurn = {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x',
              content: '/my-skill mentioned inside a tool result'
            }
          ]
        }
      }
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
        trigger,
        toolResultUserTurn,
        skillLine('my-skill')
      ])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('autonomous')
    })

    it('classifies a transcript with no string-content user message at all as autonomous', () => {
      const trigger = metaLine({
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'not string' }] }
      })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('my-skill')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('autonomous')
    })

    it('classifies multiple invocations cascading from one trigger message the same way', () => {
      // Accepted heuristic limitation, not a bug: "most recent user text before this
      // invocation" attributes every call in a cascade to the same original message, even
      // several turns later — see docs/mvp-build-spec.md, Invocation trigger classification.
      const trigger = metaLine({ message: { content: '/my-skill please, twice' } })
      const assistantTurn = {
        type: 'assistant',
        sessionId: 'sess-1',
        isSidechain: false,
        message: { content: [{ type: 'text', text: 'doing it again' }] }
      }
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
        trigger,
        skillLine('my-skill', { uuid: 'uuid-inv-1' }),
        assistantTurn,
        skillLine('my-skill', { uuid: 'uuid-inv-2' })
      ])

      const invocations = parseTranscript(filePath).invocations
      expect(invocations).toHaveLength(2)
      expect(invocations[0].trigger_type).toBe('user_invoked')
      expect(invocations[1].trigger_type).toBe('user_invoked')
    })

    it('classifies two different skills independently, without one mention bleeding into the other', () => {
      const triggerA = metaLine({ message: { content: '/skill-a mention' } })
      const triggerB = {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        message: { content: '/skill-b now please' }
      }
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
        triggerA,
        skillLine('skill-a', { uuid: 'uuid-a' }),
        triggerB,
        skillLine('skill-b', { uuid: 'uuid-b' })
      ])

      const invocations = parseTranscript(filePath).invocations
      expect(invocations.find((inv) => inv.skill_name === 'skill-a')?.trigger_type).toBe(
        'user_invoked'
      )
      expect(invocations.find((inv) => inv.skill_name === 'skill-b')?.trigger_type).toBe(
        'user_invoked'
      )
    })

    it('does not classify skill-a as mentioned when only skill-b is named in the trigger text', () => {
      const trigger = metaLine({
        message: { content: '/skill-b mentioned here, but skill-a runs autonomously' }
      })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillLine('skill-a')])

      expect(parseTranscript(filePath).invocations[0].trigger_type).toBe('autonomous')
    })
  })

  describe('harness slash-command invocations', () => {
    function commandLine(
      skillName: string,
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
      return {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        uuid: 'uuid-command',
        timestamp: '2024-01-01T00:01:00.000Z',
        message: {
          content: `<command-message>${skillName}</command-message>\n<command-name>/${skillName}</command-name>`
        },
        ...overrides
      }
    }

    function markerLine(
      parentUuid: string,
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
      return {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        isMeta: true,
        parentUuid,
        message: {
          content: [
            { type: 'text', text: 'Base directory for this skill: /Users/x/.claude/skills/foo' }
          ]
        },
        ...overrides
      }
    }

    it('records an invocation for a slash command followed by its skill base-directory marker', () => {
      const command = commandLine('domain-modeling')
      const marker = markerLine('uuid-command')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command, marker])

      const result = parseTranscript(filePath)

      expect(result.invocations).toEqual([
        {
          source_uuid: 'uuid-command',
          session_id: 'sess-1',
          skill_name: 'domain-modeling',
          args_text: null,
          invoked_at: '2024-01-01T00:01:00.000Z',
          trigger_type: 'user_invoked',
          agent_id: null,
          preceding_user_text: null
        }
      ])
    })

    it('captures non-empty command-args as args_text', () => {
      const command = commandLine('domain-modeling', {
        message: {
          content:
            '<command-message>domain-modeling</command-message>\n<command-name>/domain-modeling</command-name>\n<command-args>focus on billing</command-args>'
        }
      })
      const marker = markerLine('uuid-command')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command, marker])

      expect(parseTranscript(filePath).invocations[0].args_text).toBe('focus on billing')
    })

    it('normalizes an empty command-args tag to a NULL args_text', () => {
      const command = commandLine('domain-modeling', {
        message: {
          content:
            '<command-message>domain-modeling</command-message>\n<command-name>/domain-modeling</command-name>\n<command-args></command-args>'
        }
      })
      const marker = markerLine('uuid-command')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command, marker])

      expect(parseTranscript(filePath).invocations[0].args_text).toBeNull()
    })

    it('does not record an invocation for a slash command with no base-directory marker child', () => {
      const command = commandLine('clear')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command])

      expect(parseTranscript(filePath).invocations).toEqual([])
    })

    it('does not attribute a real skill marker to an unrelated earlier built-in command', () => {
      const clearCommand = commandLine('clear', { uuid: 'uuid-clear' })
      const systemRecord = {
        type: 'system',
        sessionId: 'sess-1',
        isSidechain: false,
        uuid: 'uuid-system',
        parentUuid: 'uuid-clear'
      }
      const realCommand = commandLine('improve-codebase-architecture', {
        uuid: 'uuid-real',
        parentUuid: 'uuid-system'
      })
      const marker = markerLine('uuid-real')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [
        metaLine(),
        clearCommand,
        systemRecord,
        realCommand,
        marker
      ])

      const invocations = parseTranscript(filePath).invocations
      expect(invocations).toHaveLength(1)
      expect(invocations[0].skill_name).toBe('improve-codebase-architecture')
    })

    it('preserves the plugin:skill colon in a plugin-scoped slash command name', () => {
      const command = commandLine('ponytail:ponytail-review')
      const marker = markerLine('uuid-command')
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command, marker])

      expect(parseTranscript(filePath).invocations[0].skill_name).toBe('ponytail:ponytail-review')
    })

    it('excludes a slash-command invocation from an isSidechain: true line', () => {
      const command = commandLine('domain-modeling', { isSidechain: true })
      const marker = markerLine('uuid-command', { isSidechain: true })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), command, marker])

      expect(parseTranscript(filePath).invocations).toEqual([])
    })

    it('does not create a duplicate invocation when a command-name trigger is followed by a Skill tool_use instead of its own marker', () => {
      const trigger = metaLine({
        message: { content: '<command-name>/my-skill</command-name><command-args></command-args>' }
      })
      const skillToolUse = skillInvocationLine({
        message: {
          content: [
            { type: 'tool_use', id: 'block-id', name: 'Skill', input: { skill: 'my-skill' } }
          ]
        }
      })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillToolUse])

      expect(parseTranscript(filePath).invocations).toHaveLength(1)
    })
  })

  it('sets agent_id to null on an ordinary main-session invocation', () => {
    const filePath = writeTranscriptFile(tmpDir, 'sess-1', [metaLine(), skillInvocationLine()])

    expect(parseTranscript(filePath).invocations[0].agent_id).toBeNull()
  })

  describe('preceding_user_text capture', () => {
    it('captures the nearest preceding user message on the tool_use path', () => {
      const trigger = metaLine({ message: { content: 'please look into the flaky test' } })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillInvocationLine()])

      expect(parseTranscript(filePath).invocations[0].preceding_user_text).toBe(
        'please look into the flaky test'
      )
    })

    it('stores null on the slash-command path even though a preceding message exists', () => {
      const priorTurn = metaLine({ message: { content: 'earlier unrelated message' } })
      const command = {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        uuid: 'uuid-command',
        timestamp: '2024-01-01T00:01:00.000Z',
        message: {
          content:
            '<command-message>domain-modeling</command-message>\n<command-name>/domain-modeling</command-name>'
        }
      }
      const marker = {
        type: 'user',
        sessionId: 'sess-1',
        isSidechain: false,
        isMeta: true,
        parentUuid: 'uuid-command',
        message: {
          content: [
            { type: 'text', text: 'Base directory for this skill: /Users/x/.claude/skills/foo' }
          ]
        }
      }
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [priorTurn, command, marker])

      expect(parseTranscript(filePath).invocations[0].preceding_user_text).toBeNull()
    })

    it('is null when there is no preceding user message at all', () => {
      const trigger = metaLine({
        message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'not string' }] }
      })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillInvocationLine()])

      expect(parseTranscript(filePath).invocations[0].preceding_user_text).toBeNull()
    })

    it('truncates to 2000 chars rather than storing the full message', () => {
      const longMessage = 'x'.repeat(2500)
      const trigger = metaLine({ message: { content: longMessage } })
      const filePath = writeTranscriptFile(tmpDir, 'sess-1', [trigger, skillInvocationLine()])

      const captured = parseTranscript(filePath).invocations[0].preceding_user_text
      expect(captured).toHaveLength(2000)
      expect(captured).toBe(longMessage.slice(0, 2000))
    })
  })
})

describe('parseSubagentInvocations', () => {
  it('extracts a Skill tool_use from an isSidechain:true record, tagged subagent with agent_id from the filename', () => {
    const filePath = writeSubagentTranscriptFile(tmpDir, 'sess-1', 'agent-abc123', [
      skillInvocationLine({ sessionId: 'sess-1', isSidechain: true })
    ])

    const invocations = parseSubagentInvocations(filePath)

    expect(invocations).toEqual([
      expect.objectContaining({
        session_id: 'sess-1',
        skill_name: 'my-skill',
        trigger_type: 'subagent',
        agent_id: 'agent-abc123'
      })
    ])
  })

  it('tags a slash-command invocation inside a subagent file as subagent, not user_invoked', () => {
    const command = {
      type: 'user',
      sessionId: 'sess-1',
      isSidechain: true,
      uuid: 'uuid-command',
      timestamp: '2024-01-01T00:01:00.000Z',
      message: {
        content:
          '<command-message>domain-modeling</command-message>\n<command-name>/domain-modeling</command-name>'
      }
    }
    const marker = {
      type: 'user',
      sessionId: 'sess-1',
      isSidechain: true,
      isMeta: true,
      parentUuid: 'uuid-command',
      message: {
        content: [
          { type: 'text', text: 'Base directory for this skill: /Users/x/.claude/skills/foo' }
        ]
      }
    }
    const filePath = writeSubagentTranscriptFile(tmpDir, 'sess-1', 'agent-abc123', [
      command,
      marker
    ])

    const invocations = parseSubagentInvocations(filePath)

    expect(invocations).toEqual([
      expect.objectContaining({
        skill_name: 'domain-modeling',
        trigger_type: 'subagent',
        agent_id: 'agent-abc123'
      })
    ])
  })
})

describe('scanTranscripts', () => {
  let db: Database.Database
  let projectsDir: string

  interface SessionRow {
    session_id: string
    cwd: string
    git_branch: string | null
    started_at: string
    message_count: number
    source_mtime_ms: number
  }

  function getSession(sessionId: string): SessionRow | undefined {
    return db.prepare('SELECT * FROM sessions_meta WHERE session_id = ?').get(sessionId) as
      SessionRow | undefined
  }

  function allSessions(): SessionRow[] {
    return db.prepare('SELECT * FROM sessions_meta').all() as SessionRow[]
  }

  function allInvocations(): unknown[] {
    return db.prepare('SELECT * FROM skill_invocations').all()
  }

  beforeEach(() => {
    db = new Database(':memory:')
    applySchema(db)
    projectsDir = join(tmpDir, 'projects')
    mkdirSync(projectsDir, { recursive: true })
  })

  it('scans a transcript nested one level under a project directory', () => {
    writeTranscriptFile(join(projectsDir, 'project-a'), 'sess-1', [
      metaLine(),
      skillInvocationLine()
    ])

    scanTranscripts(db, projectsDir)

    expect(getSession('sess-1')).toBeTruthy()
    expect(allInvocations()).toHaveLength(1)
  })

  it('ignores a .jsonl file sitting flat directly under projectsDir', () => {
    writeFileSync(join(projectsDir, 'sess-1.jsonl'), linesToJsonl([metaLine()]))

    scanTranscripts(db, projectsDir)

    expect(allSessions()).toHaveLength(0)
  })

  it('ignores non-.jsonl files inside a project directory', () => {
    const projectDir = join(projectsDir, 'project-a')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'notes.txt'), 'not a transcript')

    expect(() => scanTranscripts(db, projectsDir)).not.toThrow()
    expect(allSessions()).toHaveLength(0)
  })

  it('does not throw when projectsDir is missing', () => {
    expect(() => scanTranscripts(db, join(tmpDir, 'does-not-exist'))).not.toThrow()
    expect(allSessions()).toHaveLength(0)
  })

  it('produces no row for a transcript with no cwd-bearing line, without affecting other files', () => {
    const line = metaLine()
    delete line.cwd
    writeTranscriptFile(join(projectsDir, 'project-a'), 'sess-broken', [line])
    writeTranscriptFile(join(projectsDir, 'project-a'), 'sess-good', [
      metaLine({ sessionId: 'sess-good' })
    ])

    scanTranscripts(db, projectsDir)

    expect(getSession('sess-broken')).toBeUndefined()
    expect(getSession('sess-good')).toBeTruthy()
  })

  it('does not re-read the file when mtime is unchanged (pinned via utimesSync)', () => {
    const projectDir = join(projectsDir, 'project-a')
    const filePath = writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    scanTranscripts(db, projectsDir)
    expect(getSession('sess-1')?.message_count).toBe(1)

    const originalStat = statSync(filePath)
    writeFileSync(
      filePath,
      linesToJsonl([metaLine(), { type: 'user', sessionId: 'sess-1', isSidechain: false }])
    )
    utimesSync(filePath, originalStat.atime, originalStat.mtime)

    scanTranscripts(db, projectsDir)

    expect(getSession('sess-1')?.message_count).toBe(1)
  })

  it('re-reads the file and updates values when mtime has changed', () => {
    const projectDir = join(projectsDir, 'project-a')
    const filePath = writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    scanTranscripts(db, projectsDir)
    expect(getSession('sess-1')?.message_count).toBe(1)

    writeFileSync(
      filePath,
      linesToJsonl([metaLine(), { type: 'user', sessionId: 'sess-1', isSidechain: false }])
    )
    const future = new Date(Date.now() + 60000)
    utimesSync(filePath, future, future)

    scanTranscripts(db, projectsDir)

    expect(getSession('sess-1')?.message_count).toBe(2)
  })

  it('removes sessions_meta and skill_invocations rows when a transcript is deleted', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine(), skillInvocationLine()])
    scanTranscripts(db, projectsDir)
    expect(getSession('sess-1')).toBeTruthy()
    expect(allInvocations()).toHaveLength(1)

    rmSync(projectDir, { recursive: true, force: true })
    scanTranscripts(db, projectsDir)

    expect(getSession('sess-1')).toBeUndefined()
    expect(allInvocations()).toHaveLength(0)
  })

  it('performs a full cleanup with no SQL error when all transcripts are removed', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    scanTranscripts(db, projectsDir)
    expect(allSessions()).toHaveLength(1)

    rmSync(projectsDir, { recursive: true, force: true })
    mkdirSync(projectsDir, { recursive: true })

    expect(() => scanTranscripts(db, projectsDir)).not.toThrow()
    expect(allSessions()).toHaveLength(0)
    expect(allInvocations()).toHaveLength(0)
  })

  it('still inserts one invocation row after rescanning an unchanged fixture twice', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine(), skillInvocationLine()])

    const future = new Date(Date.now() + 60000)
    const filePath = join(projectDir, 'sess-1.jsonl')
    utimesSync(filePath, future, future)

    scanTranscripts(db, projectsDir)
    scanTranscripts(db, projectsDir)

    expect(allInvocations()).toHaveLength(1)
  })

  it('inserts a subagent invocation under the parent session_id, tagged trigger_type subagent', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    writeSubagentTranscriptFile(projectDir, 'sess-1', 'agent-abc123', [
      skillInvocationLine({ sessionId: 'sess-1', isSidechain: true })
    ])

    scanTranscripts(db, projectsDir)

    const invocations = allInvocations() as Array<{
      session_id: string
      trigger_type: string
      agent_id: string | null
    }>
    expect(invocations).toEqual([
      expect.objectContaining({
        session_id: 'sess-1',
        trigger_type: 'subagent',
        agent_id: 'agent-abc123'
      })
    ])
  })

  it('picks up a subagent invocation added after the parent transcript was already scanned, with the parent file untouched', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    scanTranscripts(db, projectsDir)
    expect(allInvocations()).toHaveLength(0)

    const subagentFilePath = writeSubagentTranscriptFile(projectDir, 'sess-1', 'agent-abc123', [
      skillInvocationLine({ sessionId: 'sess-1', isSidechain: true })
    ])
    const future = new Date(Date.now() + 60000)
    utimesSync(subagentFilePath, future, future)

    scanTranscripts(db, projectsDir)

    expect(allInvocations()).toHaveLength(1)
  })

  it('removes subagent invocation rows when the parent transcript is deleted', () => {
    const projectDir = join(projectsDir, 'project-a')
    writeTranscriptFile(projectDir, 'sess-1', [metaLine()])
    writeSubagentTranscriptFile(projectDir, 'sess-1', 'agent-abc123', [
      skillInvocationLine({ sessionId: 'sess-1', isSidechain: true })
    ])
    scanTranscripts(db, projectsDir)
    expect(allInvocations()).toHaveLength(1)

    rmSync(projectDir, { recursive: true, force: true })
    scanTranscripts(db, projectsDir)

    expect(getSession('sess-1')).toBeUndefined()
    expect(allInvocations()).toHaveLength(0)
  })
})

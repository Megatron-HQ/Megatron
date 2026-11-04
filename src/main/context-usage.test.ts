import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runClaude } from './claude-process'
import { measureContextBaseline, parseContextMarkdown } from './context-usage'

vi.mock('./claude-process', () => ({ runClaude: vi.fn() }))

const mockedRunClaude = vi.mocked(runClaude)

// Shape copied from a real `claude -p /context --output-format json` result (Claude Code
// 2.1.31x), trimmed; "Plugin hooks" stands in for a category Megatron has never seen.
const CONTEXT_MARKDOWN = [
  '## Context Usage',
  '',
  '**Model:** claude-opus-5-5  ',
  '**Tokens:** 21.8k / 1m (2%)',
  '',
  '### Estimated usage by category',
  '',
  '| Category | Tokens | Percentage |',
  '|----------|--------|------------|',
  '| System prompt | 1.8k | 0.2% |',
  '| MCP tools (deferred) | 945.2k | 94.5% |',
  '| Plugin hooks | 312 | 0.0% |',
  '| Skills | 10k | 1.0% |',
  '| Free space | 911.7k | 91.2% |',
  '| Autocompact buffer | 33k | 3.3% |',
  '',
  '### Memory Files',
  '',
  '| Type | Path | Tokens |',
  '|------|------|--------|',
  '| User | /Users/me/.claude/CLAUDE.md | 1.5k |',
  '',
  '### Skills',
  '',
  '| Skill | Source | Tokens |',
  '|-------|--------|--------|',
  '| banner-design | User | ~170 |',
  '| ponytail:ponytail-review | Plugin (ponytail) | < 20 |',
  ''
].join('\n')

function envelope(fields: Record<string, unknown>): string {
  return JSON.stringify({ is_error: false, duration_api_ms: 0, subtype: 'success', ...fields })
}

describe('parseContextMarkdown', () => {
  it('reads the model and the used / window totals from the header', () => {
    expect(parseContextMarkdown(CONTEXT_MARKDOWN)).toMatchObject({
      model: 'claude-opus-5-5',
      totalDisplay: '21.8k',
      totalTokens: 21_800,
      windowDisplay: '1m',
      windowTokens: 1_000_000,
      percentDisplay: '2%'
    })
  })

  it('keeps every category in order, grouping deferred, free space and the buffer apart', () => {
    expect(parseContextMarkdown(CONTEXT_MARKDOWN)?.categories).toEqual([
      { name: 'System prompt', display: '1.8k', tokens: 1_800, group: 'used' },
      { name: 'MCP tools (deferred)', display: '945.2k', tokens: 945_200, group: 'deferred' },
      { name: 'Plugin hooks', display: '312', tokens: 312, group: 'used' },
      { name: 'Skills', display: '10k', tokens: 10_000, group: 'used' },
      { name: 'Free space', display: '911.7k', tokens: 911_700, group: 'free' },
      { name: 'Autocompact buffer', display: '33k', tokens: 33_000, group: 'buffer' }
    ])
  })

  it('parses each detail section with approximate and bounded token cells', () => {
    expect(parseContextMarkdown(CONTEXT_MARKDOWN)?.sections).toEqual([
      {
        title: 'Memory Files',
        columns: ['Type', 'Path', 'Tokens'],
        rows: [{ cells: ['User', '/Users/me/.claude/CLAUDE.md', '1.5k'], tokens: 1_500 }]
      },
      {
        title: 'Skills',
        columns: ['Skill', 'Source', 'Tokens'],
        rows: [
          { cells: ['banner-design', 'User', '~170'], tokens: 170 },
          { cells: ['ponytail:ponytail-review', 'Plugin (ponytail)', '< 20'], tokens: 20 }
        ]
      }
    ])
  })

  it('rejects output without the token header', () => {
    expect(parseContextMarkdown(CONTEXT_MARKDOWN.replace('**Tokens:**', '**Usage:**'))).toBeNull()
  })

  it('rejects output without the category table', () => {
    const withoutTable = CONTEXT_MARKDOWN.replace('| Category | Tokens | Percentage |', '')
    expect(parseContextMarkdown(withoutTable)).toBeNull()
  })
})

describe('measureContextBaseline', () => {
  let userData: string

  beforeEach(() => {
    mockedRunClaude.mockReset()
    userData = mkdtempSync(join(tmpdir(), 'megatron-context-baseline-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('runs /context headless from an empty baseline folder and returns the parsed usage', async () => {
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: envelope({ result: CONTEXT_MARKDOWN }) })
    const result = await measureContextBaseline(userData)

    const baseline = join(userData, 'context-baseline')
    expect(statSync(baseline).isDirectory()).toBe(true)
    expect(mockedRunClaude).toHaveBeenCalledWith(
      ['-p', '/context', '--output-format', 'json', '--no-session-persistence'],
      expect.objectContaining({ cwd: baseline, timeoutMs: 60_000 })
    )
    expect(result.ok && result.usage.totalTokens).toBe(21_800)
    expect(result.ok && Number.isFinite(Date.parse(result.measuredAt))).toBe(true)
  })

  it('passes a CLI failure through without creating anything else', async () => {
    mockedRunClaude.mockResolvedValue({ ok: false, error: 'Claude Code CLI was not found.' })
    await expect(measureContextBaseline(userData)).resolves.toEqual({
      ok: false,
      error: 'Claude Code CLI was not found.'
    })
  })

  it('reports an error result from Claude Code with its own message', async () => {
    mockedRunClaude.mockResolvedValue({
      ok: true,
      stdout: envelope({
        is_error: true,
        subtype: 'error_during_execution',
        result: 'Not logged in'
      })
    })
    await expect(measureContextBaseline(userData)).resolves.toEqual({
      ok: false,
      error: 'Not logged in'
    })
  })

  it('returns the raw output when /context changes format', async () => {
    mockedRunClaude.mockResolvedValue({
      ok: true,
      stdout: envelope({ result: '# Something new' })
    })
    const result = await measureContextBaseline(userData)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.raw).toBe('# Something new')
  })

  it('returns the raw output when stdout is not JSON', async () => {
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: 'Welcome to Claude Code' })
    const result = await measureContextBaseline(userData)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.raw).toBe('Welcome to Claude Code')
  })

  it('shares one run between overlapping requests, then measures again', async () => {
    let finish: (stdout: string) => void = () => undefined
    mockedRunClaude.mockReturnValue(
      new Promise((resolve) => {
        finish = (stdout) => resolve({ ok: true, stdout })
      })
    )
    const first = measureContextBaseline(userData)
    const second = measureContextBaseline(userData)
    finish(envelope({ result: CONTEXT_MARKDOWN }))
    await Promise.all([first, second])
    expect(mockedRunClaude).toHaveBeenCalledTimes(1)

    mockedRunClaude.mockResolvedValue({ ok: true, stdout: envelope({ result: CONTEXT_MARKDOWN }) })
    await measureContextBaseline(userData)
    expect(mockedRunClaude).toHaveBeenCalledTimes(2)
    expect(existsSync(join(userData, 'context-baseline'))).toBe(true)
  })
})

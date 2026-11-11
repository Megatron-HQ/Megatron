import { describe, expect, it } from 'vitest'
import type { ContextCategory, ContextUsage } from '../../../../shared/ipc'
import { barScale, resolveDrillTarget } from './resident-drill'

function category(name: string, group: ContextCategory['group']): ContextCategory {
  return { name, display: '1k', tokens: 1_000, group }
}

const mcpSection = {
  title: 'MCP Tools',
  columns: ['Tool', 'Server', 'Tokens'],
  rows: [{ cells: ['mcp__docs__search', 'docs', '120'], tokens: 120 }]
}

function usage(categories: ContextCategory[]): ContextUsage {
  return {
    model: 'claude-opus-5-5',
    totalDisplay: '21.8k',
    totalTokens: 21_800,
    windowDisplay: '1m',
    windowTokens: 1_000_000,
    percentDisplay: '2%',
    categories,
    sections: [mcpSection, { title: 'Skills', columns: ['Skill', 'Tokens'], rows: [] }]
  }
}

describe('resolveDrillTarget', () => {
  it("opens /context's own table for a category it itemizes, deferred or not", () => {
    const deferred = category('MCP tools (deferred)', 'deferred')
    expect(resolveDrillTarget(usage([deferred]), deferred)).toEqual({
      kind: 'section',
      category: deferred,
      section: mcpSection,
      shared: false
    })
  })

  it('flags a table that /context shares between loaded and deferred rows', () => {
    const loaded = category('MCP tools', 'used')
    const target = resolveDrillTarget(
      usage([loaded, category('MCP tools (deferred)', 'deferred')]),
      loaded
    )
    expect(target?.kind === 'section' && target.shared).toBe(true)
  })

  it('explains loaded categories /context leaves unitemized from the recorded request', () => {
    const tools = category('System tools', 'used')
    const messages = category('Messages', 'used')
    expect(resolveDrillTarget(usage([tools]), tools)).toMatchObject({ view: 'tools' })
    expect(resolveDrillTarget(usage([messages]), messages)).toMatchObject({ view: 'hooks' })
  })

  it('offers nothing for space, deferred system tools, empty tables, or unknown categories', () => {
    for (const unexplained of [
      category('Free space', 'free'),
      category('Autocompact buffer', 'buffer'),
      category('System tools (deferred)', 'deferred'),
      category('Skills', 'used'),
      category('Plugin hooks', 'used')
    ]) {
      expect(resolveDrillTarget(usage([unexplained]), unexplained)).toBeNull()
    }
  })
})

describe('barScale', () => {
  const sized = (
    name: string,
    group: ContextCategory['group'],
    tokens: number
  ): ContextCategory => ({
    ...category(name, group),
    tokens
  })
  const withWindow = (windowTokens: number, categories: ContextCategory[]): ContextUsage => ({
    ...usage(categories),
    windowTokens
  })

  it('spans 200K on a 1M window, giving free space only the leftover', () => {
    const scale = barScale(
      withWindow(1_000_000, [
        sized('System prompt', 'used', 20_000),
        sized('MCP tools (deferred)', 'deferred', 900_000),
        sized('Free space', 'free', 947_000),
        sized('Autocompact buffer', 'buffer', 33_000)
      ])
    )
    expect(scale).toEqual({ scaleTokens: 200_000, freeTokens: 147_000 })
  })

  it('keeps the real window when it is 200K or smaller', () => {
    const scale = barScale(
      withWindow(128_000, [
        sized('System prompt', 'used', 20_000),
        sized('Free space', 'free', 75_000),
        sized('Autocompact buffer', 'buffer', 33_000)
      ])
    )
    expect(scale).toEqual({ scaleTokens: 128_000, freeTokens: 75_000 })
  })

  it('grows past 200K rather than clipping a resident set that outgrows it', () => {
    const scale = barScale(
      withWindow(1_000_000, [
        sized('MCP tools', 'used', 190_000),
        sized('Free space', 'free', 777_000),
        sized('Autocompact buffer', 'buffer', 33_000)
      ])
    )
    expect(scale).toEqual({ scaleTokens: 223_000, freeTokens: 0 })
  })
})

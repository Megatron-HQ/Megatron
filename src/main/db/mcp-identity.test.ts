import { describe, expect, it } from 'vitest'
import {
  connectorDisplayName,
  pluginServerPrefix,
  resolveQualifiedName,
  sanitizeMcpServerName
} from './mcp-identity'

describe('sanitizeMcpServerName', () => {
  it.each([
    ['github', 'github'],
    ['claude-in-chrome', 'claude-in-chrome'],
    ['claude.ai Google Drive', 'claude_ai_Google_Drive'],
    ['plugin:playwright:playwright', 'plugin_playwright_playwright'],
    ['my server!', 'my_server_'],
    ['naïve', 'na_ve']
  ])('maps %s to %s', (name, prefix) => {
    expect(sanitizeMcpServerName(name)).toBe(prefix)
  })
})

describe('pluginServerPrefix', () => {
  it('follows the documented plugin_<plugin>_<server> form', () => {
    expect(pluginServerPrefix('my-plugin', 'database-tools')).toBe(
      'plugin_my-plugin_database-tools'
    )
    expect(pluginServerPrefix('@scope/p', 'a.b')).toBe('plugin__scope_p_a_b')
  })
})

describe('resolveQualifiedName', () => {
  const known = new Set(['github', 'my__server', 'plugin_playwright_playwright'])

  it.each([
    ['github__list_issues', { prefix: 'github', tool: 'list_issues' }],
    ['my__server__do_thing', { prefix: 'my__server', tool: 'do_thing' }],
    [
      'plugin_playwright_playwright__browser_click',
      { prefix: 'plugin_playwright_playwright', tool: 'browser_click' }
    ],
    // Unknown prefixes split at the first separator: an Observed server.
    ['claude_ai_Gmail__search_threads', { prefix: 'claude_ai_Gmail', tool: 'search_threads' }],
    ['claude-in-chrome__navigate', { prefix: 'claude-in-chrome', tool: 'navigate' }],
    ['github__tool__with__parts', { prefix: 'github', tool: 'tool__with__parts' }]
  ])('splits %s', (qualified, expected) => {
    expect(resolveQualifiedName(qualified, known)).toEqual(expected)
  })

  it('prefers the longest known prefix', () => {
    expect(resolveQualifiedName('a__b__tool', new Set(['a', 'a__b']))).toEqual({
      prefix: 'a__b',
      tool: 'tool'
    })
  })

  it('never lets a known prefix swallow the whole name', () => {
    expect(resolveQualifiedName('a__b', new Set(['a__b']))).toEqual({ prefix: 'a', tool: 'b' })
  })

  it.each(['', 'github', '__tool', 'github__'])('rejects malformed %j', (qualified) => {
    expect(resolveQualifiedName(qualified, known)).toBeNull()
  })
})

describe('connectorDisplayName', () => {
  it('names a claude.ai prefix the way Claude Code does, best effort', () => {
    expect(connectorDisplayName('claude_ai_Google_Drive')).toBe('claude.ai Google Drive')
    expect(connectorDisplayName('claude_ai_Gmail')).toBe('claude.ai Gmail')
  })

  it('returns null for any other prefix', () => {
    expect(connectorDisplayName('claude-in-chrome')).toBeNull()
    expect(connectorDisplayName('claude_ai_')).toBeNull()
  })
})

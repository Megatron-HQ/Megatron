// Stands in for `claude -p /context` so a visual run never spawns the real CLI (which starts MCP
// servers and SessionStart hooks). Numbers follow a real global baseline; the section tables are
// short synthetic stand-ins. The recorded-request drill-in still reads real transcripts.

const categories = [
  ['System prompt', '1.8k', 1_800, 'used'],
  ['System tools', '14.2k', 14_200, 'used'],
  ['MCP server instructions', '2k', 2_000, 'used'],
  ['MCP tools (deferred)', '295.3k', 295_300, 'deferred'],
  ['System tools (deferred)', '14.8k', 14_800, 'deferred'],
  ['Custom agents', '579', 579, 'used'],
  ['Memory files', '1.5k', 1_500, 'used'],
  ['Skills', '10k', 10_000, 'used'],
  ['Messages', '1.9k', 1_900, 'used'],
  ['Free space', '935k', 935_000, 'free'],
  ['Autocompact buffer', '33k', 33_000, 'buffer']
].map(([name, display, tokens, group]) => ({ name, display, tokens, group }))

function table(title, columns, rows) {
  return {
    title,
    columns,
    rows: rows.map((cells) => {
      const tokens = cells.at(-1)
      const match = /^(?:~|<\s*)?(\d+(?:\.\d+)?)(k)?$/.exec(tokens)
      return {
        cells,
        tokens: match ? Math.round(Number(match[1]) * (match[2] ? 1000 : 1)) : null
      }
    })
  }
}

const usage = {
  model: 'claude-opus-5-5',
  totalDisplay: '32k',
  totalTokens: 32_000,
  windowDisplay: '1m',
  windowTokens: 1_000_000,
  percentDisplay: '3%',
  categories,
  sections: [
    table(
      'MCP Tools',
      ['Tool', 'Server', 'Tokens'],
      [
        ['mcp__synthetic_docs__search', 'synthetic_docs', '1.3k'],
        ['mcp__synthetic_docs__read', 'synthetic_docs', '319'],
        ['mcp__synthetic_browser__navigate', 'synthetic_browser', '7.9k']
      ]
    ),
    table(
      'Custom Agents',
      ['Agent Type', 'Source', 'Tokens'],
      [
        ['synthetic:reviewer', 'Plugin', '76'],
        ['synthetic:architect', 'Plugin', '104']
      ]
    ),
    table('Memory Files', ['Type', 'Path', 'Tokens'], [['User', '~/.claude/CLAUDE.md', '1.5k']]),
    table(
      'Skills',
      ['Skill', 'Source', 'Tokens'],
      [
        ['synthetic-design', 'User', '~170'],
        ['synthetic-review', 'Plugin (synthetic)', '~280'],
        ['synthetic-tiny', 'Plugin (synthetic)', '< 20']
      ]
    )
  ]
}

export function contextBaselineFixture(mode) {
  if (mode === 'context-baseline-unreadable') {
    return {
      ok: false,
      error: "Megatron couldn't read Claude Code's /context output.",
      raw: '## Context Usage\n\nA format this version of Megatron has never seen.'
    }
  }
  return { ok: true, usage, measuredAt: new Date().toISOString() }
}

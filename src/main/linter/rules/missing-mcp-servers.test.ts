import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../../permissions'
import { normalizeProjectPath } from '../../../shared/project-path'
import { missingMcpServersRule } from './missing-mcp-servers'
import type { SkillLintTarget, LinterContext } from '../types'

describe('missingMcpServersRule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-rule4-test-'))
    grantPath(tmpDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function skillWith(
    body: string,
    overrides: Partial<SkillLintTarget> = {},
    folder = path.join(tmpDir, 'skill-1')
  ): SkillLintTarget {
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(
      path.join(folder, 'SKILL.md'),
      `---\nname: db-skill\ndescription: test\n---\n${body}`
    )
    return {
      id: 1,
      name: 'db-skill',
      source_type: 'global',
      source_path: folder,
      plugin_name: null,
      description: 'test',
      ...overrides
    }
  }

  function contextKnowing(
    everywhere: string[],
    byProject: Record<string, string[]> = {}
  ): LinterContext {
    return {
      skills: [],
      mcpPrefixes: {
        everywhere: new Set(everywhere),
        byProject: new Map(
          Object.entries(byProject).map(([project, prefixes]) => [
            normalizeProjectPath(project),
            new Set(prefixes)
          ])
        )
      }
    }
  }

  function missing(skill: SkillLintTarget, context: LinterContext): string[] {
    return missingMcpServersRule.run(skill, context).map((finding) => finding.message)
  }

  it('detects an unknown MCP server referenced in the skill body', () => {
    const skill = skillWith('Use `mcp__postgres__execute_query` to query the database.')

    const findings = missingMcpServersRule.run(skill, contextKnowing(['github', 'filesystem']))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'missing-mcp-server',
      severity: 'warning',
      file_path: 'SKILL.md',
      // Four frontmatter lines precede the body.
      line_number: 5
    })
    expect(findings[0].message).toContain('"postgres"')
  })

  it('passes when the referenced server is known everywhere', () => {
    const skill = skillWith('Use `mcp__postgres__execute_query` to query.')

    expect(missing(skill, contextKnowing(['postgres']))).toEqual([])
  })

  it("knows a project's own servers only for that project's skills", () => {
    const projectRoot = path.join(tmpDir, 'my-project')
    const body = 'Use `mcp__local-sqlite__query`.'
    const context = contextKnowing(['github'], { [projectRoot]: ['local-sqlite'] })
    const projectSkill = skillWith(
      body,
      { source_type: 'project' },
      path.join(projectRoot, '.claude', 'skills', 'project-skill')
    )
    const globalSkill = skillWith(body)

    expect(missing(projectSkill, context)).toEqual([])
    expect(missing(globalSkill, context)).toHaveLength(1)
  })

  it('uses the recorded project root over the path layout', () => {
    const root = path.join(tmpDir, 'elsewhere')
    const skill = skillWith('Use `mcp__api__get`.', { source_type: 'project', project_root: root })

    expect(missing(skill, contextKnowing([], { [root]: ['api'] }))).toEqual([])
  })

  // Real false positives before the index: plugin and claude.ai servers were never in the config
  // files this rule read.
  it('knows plugin servers by their plugin prefix', () => {
    const skill = skillWith('Use `mcp__plugin_playwright_playwright__browser_click`.')

    expect(missing(skill, contextKnowing(['plugin_playwright_playwright']))).toEqual([])
  })

  it('never flags a claude.ai connector, which only the account knows', () => {
    const skill = skillWith('Create it with `mcp__claude_ai_Linear__create_issue`.')

    expect(missing(skill, contextKnowing([]))).toEqual([])
  })

  it('matches a known prefix that itself holds a double underscore', () => {
    const skill = skillWith('Run `mcp__my__server__run`.')

    expect(missing(skill, contextKnowing(['my__server']))).toEqual([])
  })

  it('accepts a whole-server reference, with or without a wildcard', () => {
    const skill = skillWith('Allow `mcp__github__*` and `mcp__github`.')

    expect(missing(skill, contextKnowing(['github']))).toEqual([])
  })

  it('names an unknown server once, from a wildcard reference too', () => {
    const skill = skillWith('Allow `mcp__nothere__*`.\nThen `mcp__nothere__list`.')

    const messages = missing(skill, contextKnowing(['github']))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('"nothere"')
  })

  it('skips placeholder MCP server names used in documentation', () => {
    const skill = skillWith(
      [
        'Use `mcp__plugin_name_server__create_item`.',
        'Query data via mcp__plugin_db_server__query'
      ].join('\n'),
      { source_type: 'plugin', plugin_name: 'plugin-dev@official' }
    )

    expect(missing(skill, contextKnowing([]))).toEqual([])
  })

  it('skips MCP tool names inside fenced code examples', () => {
    const skill = skillWith(
      [
        '```markdown',
        'allowed-tools: ["mcp__postgres__query"]',
        '```',
        '',
        '**Full name:** `mcp__plugin_asana_asana__asana_create_task`'
      ].join('\n'),
      { source_type: 'plugin', plugin_name: 'plugin-dev@official' }
    )

    expect(missing(skill, contextKnowing([]))).toEqual([])
  })
})

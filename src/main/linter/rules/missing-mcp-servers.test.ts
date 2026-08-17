import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../../permissions'
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

  it('detects unconfigured MCP server referenced in skill body', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: db-skill\ndescription: test\n---\nUse `mcp__postgres__execute_query` to query the database.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'db-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'test'
    }

    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set(['github', 'filesystem'])
    }

    const findings = missingMcpServersRule.run(skill, context)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'missing-mcp-server',
      severity: 'warning',
      file_path: 'SKILL.md'
    })
    expect(findings[0].message).toContain('postgres')
  })

  it('passes when referenced MCP server exists in global servers', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: db-skill\ndescription: test\n---\nUse `mcp__postgres__execute_query` to query.'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'db-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'test'
    }

    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set(['postgres', 'filesystem'])
    }

    const findings = missingMcpServersRule.run(skill, context)
    expect(findings).toHaveLength(0)
  })

  it('recognizes project-level MCP server from project root .mcp.json', () => {
    const projectRoot = path.join(tmpDir, 'my-project')
    const skillDir = path.join(projectRoot, '.claude', 'skills', 'project-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(projectRoot, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'local-sqlite': {} } })
    )
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: project-skill\ndescription: test\n---\nUse `mcp__local-sqlite__query`.'
    )
    const skill: SkillLintTarget = {
      id: 2,
      name: 'project-skill',
      source_type: 'project',
      source_path: skillDir,
      plugin_name: null,
      description: 'test'
    }

    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set(['github'])
    }

    const findings = missingMcpServersRule.run(skill, context)
    expect(findings).toHaveLength(0)
  })

  it('skips placeholder MCP server names used in documentation', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: mcp-docs',
        'description: test',
        '---',
        'Use `mcp__plugin_name_server__create_item`.',
        'Query data via mcp__plugin_db_server__query'
      ].join('\n')
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'mcp-docs',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'plugin-dev@official',
      description: 'test'
    }
    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set()
    }

    expect(missingMcpServersRule.run(skill, context)).toEqual([])
  })

  it('skips MCP tool names inside fenced code examples', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: mcp-docs',
        'description: test',
        '---',
        '```markdown',
        'allowed-tools: ["mcp__postgres__query"]',
        '```',
        '',
        '**Full name:** `mcp__plugin_asana_asana__asana_create_task`'
      ].join('\n')
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'mcp-docs',
      source_type: 'plugin',
      source_path: skillDir,
      plugin_name: 'plugin-dev@official',
      description: 'test'
    }
    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set()
    }

    expect(missingMcpServersRule.run(skill, context)).toEqual([])
  })
})

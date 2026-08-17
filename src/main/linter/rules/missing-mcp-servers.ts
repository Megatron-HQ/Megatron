import { sep } from 'path'
import type { LintRule, LintFindingInput } from '../types'
import { getProjectMcpServers } from '../mcp-config'
import { accessSkillMd } from '../skill-md'

function findProjectRoot(sourcePath: string): string | undefined {
  const parts = sourcePath.split(/[/\\]/)
  const dotClaudeIdx = parts.lastIndexOf('.claude')
  if (dotClaudeIdx > 0) {
    return parts.slice(0, dotClaudeIdx).join(sep)
  }
  return undefined
}

function isPlaceholderMcpServer(name: string): boolean {
  const n = name.toLowerCase()
  if (n.includes('plugin_name') || n.includes('_name_')) return true
  return /^plugin_(db|api|example|foo|bar|test)_/.test(n)
}

function isDocumentationMcpLine(line: string): boolean {
  return /\b(full name|allowed-tools|example|format)\b/i.test(line)
}

export const missingMcpServersRule: LintRule = {
  id: 'missing-mcp-server',
  name: 'Referenced MCP Server Configuration Check',
  run: (skill, context): LintFindingInput[] => {
    const accessed = accessSkillMd(skill.source_path)
    if (accessed.status !== 'ok') return []
    const content = accessed.content

    const availableServers = new Set<string>(context.globalMcpServers)

    if (skill.source_type === 'project') {
      const projectRoot = skill.project_root ?? findProjectRoot(skill.source_path)
      if (projectRoot) {
        const projectServers = getProjectMcpServers(undefined, projectRoot)
        for (const s of projectServers) {
          availableServers.add(s)
        }
      }
    }

    const lines = content.split('\n')
    const findings: LintFindingInput[] = []
    const seenMissing = new Set<string>()

    const mcpPattern = /\bmcp__([a-zA-Z0-9_-]+)__/g
    let inFence = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence
        continue
      }
      if (inFence || isDocumentationMcpLine(line)) continue

      let match: RegExpExecArray | null
      while ((match = mcpPattern.exec(line)) !== null) {
        const serverName = match[1]
        if (isPlaceholderMcpServer(serverName)) continue
        if (!availableServers.has(serverName) && !seenMissing.has(serverName)) {
          seenMissing.add(serverName)
          findings.push({
            skill_id: skill.id,
            rule_id: 'missing-mcp-server',
            severity: 'warning',
            message: `Referenced MCP server "${serverName}" is not configured in MCP settings`,
            detail: `Found tool reference 'mcp__${serverName}__' but '${serverName}' was not found in global or project MCP configuration`,
            file_path: 'SKILL.md',
            line_number: lineNum
          })
        }
      }
    }

    return findings
  }
}

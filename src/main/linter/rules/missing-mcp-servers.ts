import { sep } from 'path'
import type { LintRule, LintFindingInput } from '../types'
import { accessSkillMd } from '../skill-md'
import { resolveQualifiedName } from '../../db/mcp-identity'
import { normalizeProjectPath } from '../../../shared/project-path'

const NAME_SEPARATOR = '__'
// A claude.ai connector lives in the user's account, not on disk; Megatron learns one only once a
// call or an /mcp switch names it, so a reference to an unseen one can't be judged missing.
const CONNECTOR_PREFIX = 'claude_ai_'

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

// `reference` is everything after `mcp__`: a tool (`server__tool`), a whole server (`server`), or a
// wildcard whose `*` the pattern stopped before (`server__`).
function isKnownReference(reference: string, known: ReadonlySet<string>): boolean {
  for (const prefix of known)
    if (reference === prefix || reference.startsWith(prefix + NAME_SEPARATOR)) return true
  return false
}

function referencedServer(reference: string): string {
  return (
    resolveQualifiedName(reference, new Set<string>())?.prefix ??
    (reference.endsWith(NAME_SEPARATOR) ? reference.slice(0, -NAME_SEPARATOR.length) : reference)
  )
}

export const missingMcpServersRule: LintRule = {
  id: 'missing-mcp-server',
  name: 'Referenced MCP Server Configuration Check',
  run: (skill, context): LintFindingInput[] => {
    const accessed = accessSkillMd(skill.source_path)
    if (accessed.status !== 'ok') return []
    const content = accessed.content

    const known = new Set(context.mcpPrefixes.everywhere)
    if (skill.source_type === 'project') {
      const projectRoot = skill.project_root ?? findProjectRoot(skill.source_path)
      const projectPrefixes =
        projectRoot === undefined
          ? undefined
          : context.mcpPrefixes.byProject.get(normalizeProjectPath(projectRoot))
      for (const prefix of projectPrefixes ?? []) known.add(prefix)
    }

    const lines = content.split('\n')
    const findings: LintFindingInput[] = []
    const seenMissing = new Set<string>()

    const mcpPattern = /\bmcp__([a-zA-Z0-9_-]+)/g
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
        const reference = match[1]
        if (isKnownReference(reference, known)) continue
        const serverName = referencedServer(reference)
        if (
          serverName === '' ||
          serverName.startsWith(CONNECTOR_PREFIX) ||
          isPlaceholderMcpServer(serverName) ||
          seenMissing.has(serverName)
        )
          continue
        seenMissing.add(serverName)
        findings.push({
          skill_id: skill.id,
          rule_id: 'missing-mcp-server',
          severity: 'warning',
          message: `Referenced MCP server "${serverName}" is not configured in MCP settings`,
          detail: `Found tool reference 'mcp__${reference}' but no MCP server Megatron knows of uses the prefix '${serverName}': not in user, plugin, or this project's configuration, and never seen in a transcript`,
          file_path: 'SKILL.md',
          line_number: lineNum
        })
      }
    }

    return findings
  }
}

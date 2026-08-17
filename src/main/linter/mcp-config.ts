import { allowedReadFileSync } from '../permissions'
import path from 'path'
import os from 'os'

export function getDefaultClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  const buf = allowedReadFileSync(filePath)
  if (buf === null) return null
  try {
    const parsed: unknown = JSON.parse(buf.toString('utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function addMcpServerNames(source: unknown, into: Set<string>): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return
  const mcp = (source as { mcpServers?: unknown }).mcpServers
  if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) return
  for (const serverName of Object.keys(mcp)) {
    into.add(serverName)
  }
}

function mcpProjectKeysMatch(configKey: string, projectRoot: string): boolean {
  const a = path.resolve(configKey)
  const b = path.resolve(projectRoot)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function getGlobalMcpServers(
  claudeJsonPath: string = getDefaultClaudeJsonPath()
): Set<string> {
  const servers = new Set<string>()
  addMcpServerNames(readJsonObject(claudeJsonPath), servers)
  return servers
}

export function getProjectMcpServers(
  claudeJsonPath: string | undefined = getDefaultClaudeJsonPath(),
  projectRoot?: string
): Set<string> {
  const servers = new Set<string>()

  if (!projectRoot) {
    return servers
  }

  const configPath = claudeJsonPath ?? getDefaultClaudeJsonPath()

  addMcpServerNames(readJsonObject(path.join(projectRoot, '.mcp.json')), servers)
  addMcpServerNames(readJsonObject(path.join(projectRoot, '.claude', 'mcp.json')), servers)

  const parsed = readJsonObject(configPath)
  const projects = parsed?.projects
  if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
    for (const [key, projData] of Object.entries(projects)) {
      if (mcpProjectKeysMatch(key, projectRoot)) {
        addMcpServerNames(projData, servers)
      }
    }
  }

  return servers
}

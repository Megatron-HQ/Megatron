import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../permissions'
import { getGlobalMcpServers, getProjectMcpServers } from './mcp-config'

describe('mcp-config', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-mcp-test-'))
    grantPath(tmpDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('getGlobalMcpServers', () => {
    it('returns empty set if file does not exist', () => {
      const servers = getGlobalMcpServers(path.join(tmpDir, 'nonexistent.json'))
      expect(servers.size).toBe(0)
    })

    it('returns empty set if file is invalid JSON', () => {
      const filePath = path.join(tmpDir, '.claude.json')
      fs.writeFileSync(filePath, '{ not json }')
      const servers = getGlobalMcpServers(filePath)
      expect(servers.size).toBe(0)
    })

    it('extracts top-level mcpServers keys', () => {
      const filePath = path.join(tmpDir, '.claude.json')
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: {
            filesystem: { command: 'npx' },
            memory: { command: 'node' }
          }
        })
      )
      const servers = getGlobalMcpServers(filePath)
      expect(Array.from(servers)).toEqual(['filesystem', 'memory'])
    })
  })

  describe('getProjectMcpServers', () => {
    it('extracts servers from project root .mcp.json', () => {
      const projectRoot = path.join(tmpDir, 'project-a')
      fs.mkdirSync(projectRoot)
      fs.writeFileSync(
        path.join(projectRoot, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'custom-db': { command: 'python' }
          }
        })
      )

      const servers = getProjectMcpServers(path.join(tmpDir, 'nonexistent.json'), projectRoot)
      expect(Array.from(servers)).toEqual(['custom-db'])
    })

    it('extracts servers from .claude.json projects section', () => {
      const projectRoot = path.join(tmpDir, 'project-b')
      fs.mkdirSync(projectRoot)
      const claudeJsonPath = path.join(tmpDir, '.claude.json')
      fs.writeFileSync(
        claudeJsonPath,
        JSON.stringify({
          projects: {
            [projectRoot]: {
              mcpServers: {
                'project-tool': { command: 'npx' }
              }
            }
          }
        })
      )

      const servers = getProjectMcpServers(claudeJsonPath, projectRoot)
      expect(Array.from(servers)).toEqual(['project-tool'])
    })

    it('matches a ~/.claude.json project key regardless of path case on win32', () => {
      const projectRoot = path.join(tmpDir, 'MyProject')
      fs.mkdirSync(projectRoot)
      const claudeJsonPath = path.join(tmpDir, '.claude.json')
      const altKey =
        process.platform === 'win32'
          ? projectRoot.replace(/^[A-Za-z]/, (ch) =>
              ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
            )
          : projectRoot
      fs.writeFileSync(
        claudeJsonPath,
        JSON.stringify({
          projects: {
            [altKey]: {
              mcpServers: {
                'case-tool': { command: 'npx' }
              }
            }
          }
        })
      )

      const servers = getProjectMcpServers(claudeJsonPath, projectRoot)
      if (process.platform === 'win32') {
        expect(Array.from(servers)).toEqual(['case-tool'])
      } else {
        expect(Array.from(servers)).toEqual(altKey === projectRoot ? ['case-tool'] : [])
      }
    })
  })
})

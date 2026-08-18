import { describe, expect, it } from 'vitest'
import {
  getFolderBasename,
  getPluginBareName,
  getProjectNameFromPath,
  getSourceDisplayName,
  getSourceSortKey
} from './source-name'

describe('source-name helpers', () => {
  describe('getFolderBasename', () => {
    it('extracts basename from Windows paths', () => {
      expect(getFolderBasename('C:\\Users\\alice\\projects\\Megatron')).toBe('Megatron')
      expect(getFolderBasename('C:\\Megatron\\')).toBe('Megatron')
    })

    it('extracts basename from POSIX paths', () => {
      expect(getFolderBasename('/Users/alice/projects/Megatron')).toBe('Megatron')
      expect(getFolderBasename('/Users/alice/projects/Megatron/')).toBe('Megatron')
    })

    it('returns empty string if null or undefined', () => {
      expect(getFolderBasename(null)).toBe('')
      expect(getFolderBasename(undefined)).toBe('')
    })
  })
  describe('getPluginBareName', () => {
    it('extracts name before @', () => {
      expect(getPluginBareName('frontend-design@claude-plugins-official')).toBe('frontend-design')
      expect(getPluginBareName('superpowers@obra')).toBe('superpowers')
    })

    it('returns original string if no @ is present', () => {
      expect(getPluginBareName('my-plugin')).toBe('my-plugin')
    })

    it('returns fallback if null or empty', () => {
      expect(getPluginBareName(null)).toBe('plugin')
      expect(getPluginBareName('')).toBe('plugin')
    })
  })

  describe('getProjectNameFromPath', () => {
    it('extracts folder name before .claude from POSIX path', () => {
      expect(
        getProjectNameFromPath('/Users/alice/projects/Megatron/.claude/skills/visual-verify')
      ).toBe('Megatron')
    })

    it('extracts folder name before .claude from Windows path', () => {
      expect(
        getProjectNameFromPath('C:\\Users\\alice\\projects\\AwesomeApp\\.claude\\skills\\test')
      ).toBe('AwesomeApp')
    })

    it('handles trailing slashes or nested paths under skills', () => {
      expect(getProjectNameFromPath('/home/dev/repo-name/.claude/skills/sub/deep/SKILL.md')).toBe(
        'repo-name'
      )
    })

    it('falls back to project when path has no .claude or is undefined', () => {
      expect(getProjectNameFromPath(undefined)).toBe('project')
      expect(getProjectNameFromPath('/tmp/skills/skill-a')).toBe('project')
    })
  })

  describe('getSourceDisplayName', () => {
    it('returns global for global skills', () => {
      expect(getSourceDisplayName('global', '/Users/alice/.claude/skills/test')).toBe('global')
    })

    it('returns project folder name for project skills', () => {
      expect(
        getSourceDisplayName('project', 'C:\\Projects\\MyCoolRepo\\.claude\\skills\\lint-check')
      ).toBe('MyCoolRepo')
    })

    it('returns bare plugin name for plugin skills', () => {
      expect(
        getSourceDisplayName('plugin', undefined, 'frontend-design@claude-plugins-official')
      ).toBe('frontend-design')
    })
  })

  describe('getSourceSortKey', () => {
    it('orders global before project before plugin, and sub-sorts by name', () => {
      const globalKey = getSourceSortKey('global', '/path')
      const projAKey = getSourceSortKey('project', '/repo-a/.claude/skills/a')
      const projBKey = getSourceSortKey('project', '/repo-b/.claude/skills/b')
      const pluginAKey = getSourceSortKey('plugin', undefined, 'alpha@marketplace')
      const pluginZKey = getSourceSortKey('plugin', undefined, 'zeta@marketplace')

      expect(globalKey < projAKey).toBe(true)
      expect(projAKey < projBKey).toBe(true)
      expect(projBKey < pluginAKey).toBe(true)
      expect(pluginAKey < pluginZKey).toBe(true)
    })
  })
})

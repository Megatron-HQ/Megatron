import { describe, expect, it } from 'vitest'
import * as security from './ipc-security'
import { IPC_CHANNELS, type PluginActionInput, type PluginRow } from '../shared/ipc'

const ABS = process.platform === 'win32' ? 'C:\\repo' : '/repo'

describe('renderer trust boundary', () => {
  it('accepts project linking by IDs and rejects renderer-supplied paths or incomplete requests', () => {
    expect(() =>
      security.validateIpcArguments(IPC_CHANNELS.usageLinkProjects, [
        { sourceId: 'old', targetId: 'current' }
      ])
    ).not.toThrow()
    expect(() =>
      security.validateIpcArguments(IPC_CHANNELS.usageUnlinkProject, ['old'])
    ).not.toThrow()
    for (const args of [
      [],
      [{ sourceId: 'old' }],
      [{ sourceId: '', targetId: 'current' }],
      [{ sourceId: 'old', targetId: 'old' }],
      [{ sourceId: 'old', targetId: 'current', path: 'C:\\arbitrary' }]
    ]) {
      expect(() => security.validateIpcArguments(IPC_CHANNELS.usageLinkProjects, args)).toThrow()
    }
    expect(() => security.validateIpcArguments(IPC_CHANNELS.usageUnlinkProject, [])).toThrow()
    expect(() =>
      security.validateIpcArguments(IPC_CHANNELS.usageProjects, ['C:\\arbitrary'])
    ).toThrow()
  })
  it('requires a matching indexed installation with known enablement', () => {
    const input = { name: 'demo', marketplace: 'market', scope: 'user', projectPath: null }
    const plugin = {
      name: 'demo',
      marketplace: 'market',
      installs: [{ scope: 'user', project_path: null, enablement_known: true }]
    } as PluginRow
    expect(security.canManagePluginInstall(input, plugin)).toBe(true)
    expect(security.canManagePluginInstall({ ...input, scope: 'local' }, plugin)).toBe(false)
    expect(security.canManagePluginInstall(input, null)).toBe(false)
    expect(
      security.canManagePluginInstall(input, {
        ...plugin,
        installs: [{ ...plugin.installs[0], enablement_known: false }]
      })
    ).toBe(false)
  })

  it('explains a denied action when the registered project folder is gone', () => {
    const projectPath = 'C:\\repos\\moved'
    const input: PluginActionInput = {
      name: 'demo',
      marketplace: 'market',
      scope: 'project',
      projectPath
    }
    const plugin = {
      name: 'demo',
      marketplace: 'market',
      installs: [
        {
          scope: 'project',
          project_path: projectPath,
          enablement_known: false,
          project_missing: true
        }
      ]
    } as PluginRow

    expect(security.deniedPluginActionMessage(input, plugin)).toBe(
      `This install is registered to ${projectPath}, and that folder is missing. Megatron can't update, enable, disable, or uninstall it. ` +
        'Put the project back at that path to keep this install, or install the plugin again from its new location in Claude Code. ' +
        'The next scan shows the new install. This record stays until Claude Code removes it.'
    )
  })

  it.each([
    [IPC_CHANNELS.usageCalendar, [2026]],
    [IPC_CHANNELS.usageDay, ['2024-02-29']]
  ])('accepts valid calendar requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    [IPC_CHANNELS.setAutoUpdateCheck, [true]],
    [IPC_CHANNELS.setAutoUpdateCheck, [false]],
    [IPC_CHANNELS.getUpdateState, []],
    [IPC_CHANNELS.checkForUpdates, []],
    [IPC_CHANNELS.installUpdate, []]
  ])('accepts valid update requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    [IPC_CHANNELS.listMcpServers, []],
    [IPC_CHANNELS.getMcpServerDetail, ['configured:github']],
    [IPC_CHANNELS.getMcpServerDetail, ['plugin:p:s'.padEnd(1024, 'x')]],
    [IPC_CHANNELS.revealMcpSource, ['configured:api', '/repo/.mcp.json']],
    [IPC_CHANNELS.setLastSection, ['mcp']],
    [IPC_CHANNELS.checkMcpConnections, []],
    [IPC_CHANNELS.checkMcpConnections, ['/repo']],
    [IPC_CHANNELS.confirmMcpCheck, []],
    [IPC_CHANNELS.getInitialMcpCheckConfirmed, []],
    [IPC_CHANNELS.usageMcp, []],
    [
      IPC_CHANNELS.removeMcpServer,
      [{ serverId: 'configured:a b', scope: 'user', projectPath: null }]
    ],
    [
      IPC_CHANNELS.logoutMcpServer,
      [{ serverId: 'configured:api', scope: 'local', projectPath: ABS }]
    ],
    [IPC_CHANNELS.resetMcpProjectChoices, [ABS]]
  ])('accepts MCP requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    [IPC_CHANNELS.listMcpServers, ['configured:github']],
    [IPC_CHANNELS.getMcpServerDetail, []],
    [IPC_CHANNELS.getMcpServerDetail, ['']],
    [IPC_CHANNELS.getMcpServerDetail, [42]],
    [IPC_CHANNELS.getMcpServerDetail, ['configured:a', 'configured:b']],
    [IPC_CHANNELS.getMcpServerDetail, ['plugin:p:s'.padEnd(1025, 'x')]],
    [IPC_CHANNELS.getMcpServerDetail, ['configured:a\0b']],
    [IPC_CHANNELS.revealMcpSource, ['configured:api']],
    [IPC_CHANNELS.revealMcpSource, ['configured:api', '']],
    [IPC_CHANNELS.revealMcpSource, ['configured:api', 7]],
    [IPC_CHANNELS.revealMcpSource, ['x'.repeat(1025), '/repo/.mcp.json']],
    [IPC_CHANNELS.revealMcpSource, ['configured:api', '/repo/.mcp.json', 'extra']],
    [IPC_CHANNELS.checkMcpConnections, ['']],
    [IPC_CHANNELS.checkMcpConnections, [42]],
    [IPC_CHANNELS.checkMcpConnections, ['/repo', '/other']],
    [IPC_CHANNELS.confirmMcpCheck, [true]],
    [IPC_CHANNELS.usageMcp, ['24h']],
    [IPC_CHANNELS.removeMcpServer, []],
    [IPC_CHANNELS.removeMcpServer, ['configured:a']],
    [IPC_CHANNELS.removeMcpServer, [{ serverId: 'configured:a', scope: 'user', projectPath: ABS }]],
    [
      IPC_CHANNELS.removeMcpServer,
      [{ serverId: 'plugin:p:s', scope: 'plugin', projectPath: null }]
    ],
    [
      IPC_CHANNELS.removeMcpServer,
      [{ serverId: 'configured:a', scope: 'user', projectPath: null }, 'extra']
    ],
    [
      IPC_CHANNELS.logoutMcpServer,
      [{ serverId: 'configured:a', scope: 'local', projectPath: 'rel' }]
    ],
    [IPC_CHANNELS.resetMcpProjectChoices, []],
    [IPC_CHANNELS.resetMcpProjectChoices, ['relative/repo']],
    [IPC_CHANNELS.resetMcpProjectChoices, [`${ABS}\0`]],
    [IPC_CHANNELS.resetMcpProjectChoices, [ABS, ABS]]
  ])('rejects malformed MCP requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).toThrow()
  })
  it.each([
    [IPC_CHANNELS.getInitialOnboarding, []],
    [IPC_CHANNELS.setOnboardingDone, []]
  ])('accepts onboarding requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    [IPC_CHANNELS.getInitialWhatsNew, []],
    [IPC_CHANNELS.markWhatsNewSeen, []],
    [IPC_CHANNELS.clearWhatsNewDot, ['usage-skill-cost']]
  ])("accepts What's new requests for %s", (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    // Main computes the seen version from its own app version; the renderer never names one.
    [IPC_CHANNELS.markWhatsNewSeen, ['9.9.9']],
    [IPC_CHANNELS.clearWhatsNewDot, []],
    [IPC_CHANNELS.clearWhatsNewDot, ['retired-anchor']],
    [IPC_CHANNELS.clearWhatsNewDot, ['usage-skill-cost', 'usage-skill-cost']],
    [IPC_CHANNELS.clearWhatsNewDot, [42]]
  ])("rejects malformed What's new requests for %s", (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).toThrow()
  })
  it.each([
    [IPC_CHANNELS.narrowAllowedPath, ['/Users/me/Desktop']],
    [IPC_CHANNELS.getHomePath, []],
    [IPC_CHANNELS.pickAndAddFolders, []],
    // A folder main listed, to aim the picker at; main matches it against its own records.
    [IPC_CHANNELS.pickAndAddFolders, [ABS]],
    [IPC_CHANNELS.listHiddenProjects, []],
    [IPC_CHANNELS.hideProject, [ABS]],
    [IPC_CHANNELS.showProject, [ABS]]
  ])('accepts valid folder requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    [IPC_CHANNELS.narrowAllowedPath, []],
    [IPC_CHANNELS.narrowAllowedPath, ['']],
    [IPC_CHANNELS.narrowAllowedPath, [42]],
    [IPC_CHANNELS.narrowAllowedPath, ['/Users/me/Desktop\0']],
    // Narrowing replaces the grant with dialog picks; the renderer never names folders to add.
    [IPC_CHANNELS.narrowAllowedPath, ['/Users/me/Desktop', ['/Users/me/Desktop/api']]],
    [IPC_CHANNELS.pickAndAddFolders, ['relative/code']],
    [IPC_CHANNELS.pickAndAddFolders, [`${ABS}\0`]],
    [IPC_CHANNELS.pickAndAddFolders, [ABS, ABS]],
    [IPC_CHANNELS.listHiddenProjects, [ABS]],
    [IPC_CHANNELS.hideProject, []],
    [IPC_CHANNELS.hideProject, ['relative/code']],
    [IPC_CHANNELS.hideProject, [42]],
    [IPC_CHANNELS.hideProject, [ABS, ABS]],
    [IPC_CHANNELS.showProject, ['']],
    [IPC_CHANNELS.showProject, [`${ABS}\0`]],
    [IPC_CHANNELS.setOnboardingDone, [true]],
    [IPC_CHANNELS.getHomePath, ['/Users/me']]
  ])('rejects malformed folder requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).toThrow()
  })
  it.each([
    [IPC_CHANNELS.getClaudeFolder, []],
    [IPC_CHANNELS.pickClaudeFolder, []],
    [IPC_CHANNELS.chooseClaudeFolder, ['default']],
    [IPC_CHANNELS.chooseClaudeFolder, ['home:.claude-work']],
    [IPC_CHANNELS.chooseClaudeFolder, ['home:' + 'a'.repeat(295)]]
  ])('accepts Claude Code folder requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).not.toThrow()
  })
  it.each([
    // The renderer chooses by the id main listed; the picker's folder comes from the native dialog.
    [IPC_CHANNELS.pickClaudeFolder, ['/Users/me/.claude-work']],
    [IPC_CHANNELS.getClaudeFolder, ['saved']],
    [IPC_CHANNELS.chooseClaudeFolder, []],
    [IPC_CHANNELS.chooseClaudeFolder, ['']],
    [IPC_CHANNELS.chooseClaudeFolder, [42]],
    [IPC_CHANNELS.chooseClaudeFolder, ['home:.claude\0']],
    [IPC_CHANNELS.chooseClaudeFolder, ['home:' + 'a'.repeat(296)]],
    [IPC_CHANNELS.chooseClaudeFolder, ['default', 'saved']]
  ])('rejects malformed Claude Code folder requests for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).toThrow()
  })
  it.each([
    [IPC_CHANNELS.usageCalendar, ['2026']],
    [IPC_CHANNELS.usageCalendar, [10000]],
    [IPC_CHANNELS.usageCalendar, [2026, 'extra']],
    [IPC_CHANNELS.usageDay, ['2026-02-30']],
    [IPC_CHANNELS.usageDay, ['2026-2-3']],
    [IPC_CHANNELS.usageDay, ['../../preferences.json']],
    [IPC_CHANNELS.openSkill, [-1]],
    [IPC_CHANNELS.openSkill, ['1']],
    [IPC_CHANNELS.setTheme, ['purple']],
    [IPC_CHANNELS.setLastSection, ['other']],
    [
      IPC_CHANNELS.enablePlugin,
      [{ name: 'demo', marketplace: 'market', scope: 'bad', projectPath: null }]
    ],
    [IPC_CHANNELS.usageSkillInvocations, [{ startAt: 'bad', endAt: 'bad' }]],
    [IPC_CHANNELS.listSkills, ['unexpected']],
    // These two spawn the CLI and read transcripts; their cwd and paths are fixed in main.
    [IPC_CHANNELS.usageContextBaseline, ['/tmp']],
    [IPC_CHANNELS.usageRecordedRequest, ['/etc']],
    [IPC_CHANNELS.setAutoUpdateCheck, []],
    [IPC_CHANNELS.setAutoUpdateCheck, ['true']],
    [IPC_CHANNELS.setAutoUpdateCheck, [1]],
    [IPC_CHANNELS.setAutoUpdateCheck, [true, false]],
    // Install paths and the swap target are fixed in main; the renderer never supplies them.
    [IPC_CHANNELS.installUpdate, ['/tmp/Megatron.app']]
  ])('rejects malformed arguments for %s', (channel, args) => {
    expect(() => security.validateIpcArguments(channel, args)).toThrow()
  })
  it.each([
    ['file:///C:/app/index.html#skills', 'file:///C:/app/index.html', true],
    ['file:///C:/other/index.html', 'file:///C:/app/index.html', false],
    ['http://localhost:5173/', 'http://localhost:5173/', true],
    ['http://localhost:5173/evil', 'http://localhost:5173/', false],
    ['http://localhost:5173/?evil', 'http://localhost:5173/', false],
    ['http://127.0.0.1:5173/', 'http://localhost:5173/', false],
    ['https://example.com', 'file:///C:/app/index.html', false]
  ])('checks %s against %s', (url, trusted, expected) => {
    expect(security.isTrustedRendererUrl(url, trusted)).toBe(expected)
  })

  it('rejects subframes and other windows even when their URLs match', () => {
    const mainFrame = { url: 'file:///app/index.html' }
    const contents = { mainFrame }
    expect(
      security.isTrustedIpcSender(
        { sender: contents, senderFrame: mainFrame },
        contents,
        mainFrame.url
      )
    ).toBe(true)
    expect(
      security.isTrustedIpcSender(
        { sender: contents, senderFrame: { ...mainFrame } },
        contents,
        mainFrame.url
      )
    ).toBe(false)
    expect(
      security.isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, contents, mainFrame.url)
    ).toBe(false)
  })
})

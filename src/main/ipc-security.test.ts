import { describe, expect, it } from 'vitest'
import * as security from './ipc-security'
import { IPC_CHANNELS, type PluginRow } from '../shared/ipc'

describe('renderer trust boundary', () => {
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
  it.each([
    [IPC_CHANNELS.openSkill, [-1]],
    [IPC_CHANNELS.openSkill, ['1']],
    [IPC_CHANNELS.setTheme, ['purple']],
    [IPC_CHANNELS.setLastSection, ['other']],
    [
      IPC_CHANNELS.enablePlugin,
      [{ name: 'demo', marketplace: 'market', scope: 'bad', projectPath: null }]
    ],
    [IPC_CHANNELS.usageSkillInvocations, [{ startAt: 'bad', endAt: 'bad' }]],
    [IPC_CHANNELS.listSkills, ['unexpected']]
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

// Test-only entry point. Production continues to launch out/main/index.js directly.
import { app, ipcMain } from 'electron'
import { projectTreeFixture } from './project-tree-fixture.mjs'
import { usageHistoryFixture } from './usage-history-fixture.mjs'
import { contextBaselineFixture } from './context-baseline-fixture.mjs'

const registeredHandlers = new Map()
const overriddenChannels = new Set()
const SCAN_NOTIFICATION_CHANNELS = new Set(['scan:started', 'scan:progress', 'scan:complete'])
const MIN_FIXTURE_SCAN_ID = 9000
const PROJECT_SCAN_MODES = ['scan-permission', 'scan-missing', 'scan-mixed', 'scan-manual-partial']
let projectScanCompletedAt
const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => {
  registeredHandlers.set(channel, handler)
  registerHandler(channel, handler)
}

app.on('web-contents-created', (_event, contents) => {
  const send = contents.send.bind(contents)
  contents.send = (channel, ...args) => {
    const fixtureEvent = typeof args[0]?.id === 'number' && args[0].id >= MIN_FIXTURE_SCAN_ID
    // Simulated screens own their event timeline; real scans may still update the private index.
    if (overriddenChannels.size > 0 && SCAN_NOTIFICATION_CHANNELS.has(channel) && !fixtureEvent)
      return
    send(channel, ...args)
  }
})

globalThis.megatronVisualFixtures = {
  reset() {
    for (const channel of overriddenChannels) {
      ipcMain.removeHandler(channel)
      registerHandler(channel, registeredHandlers.get(channel))
    }
    overriddenChannels.clear()
    projectScanCompletedAt = undefined
  },
  set(channel, mode) {
    if (channel !== 'usage:projects' && mode.startsWith('usage-history'))
      globalThis.megatronVisualFixtures.set('usage:projects', mode)
    const original = registeredHandlers.get(channel)
    if (!original) throw new Error(`Unknown fixture channel: ${channel}`)
    ipcMain.removeHandler(channel)
    overriddenChannels.add(channel)
    if (PROJECT_SCAN_MODES.includes(mode)) projectScanCompletedAt ??= new Date().toISOString()
    registerHandler(channel, async (event, ...args) => {
      if (mode === 'error') throw new Error('Visual fixture: unavailable source')
      if (mode === 'pending') return new Promise(() => {})
      if (channel === 'plugins:update' && mode.startsWith('update-phase-')) {
        event.sender.send('plugins:updateProgress', {
          input: args[0],
          phase: mode.slice('update-phase-'.length)
        })
        return new Promise(() => {})
      }
      if (mode === 'empty-folders') return []
      // Dev builds are always 'unsupported'; this is the only way to render the update states.
      if (channel === 'updates:getState' && mode.startsWith('update-'))
        return { status: mode.slice('update-'.length), version: '0.1.1', autoCheck: true }
      // Before `original`: the real handler would spawn the Claude Code CLI.
      if (mode.startsWith('context-baseline')) return contextBaselineFixture(mode)
      // Before `original`: the real handler would open the native folder picker.
      if (channel === 'folders:pickAndAdd' && mode.startsWith('project-tree'))
        return projectTreeFixture(channel, args, undefined, mode)
      const fixtureProjectRescan = channel === 'app:rescan' && PROJECT_SCAN_MODES.includes(mode)
      const result = fixtureProjectRescan ? undefined : await original(event, ...args)
      if (mode.startsWith('usage-history')) return usageHistoryFixture(channel, args, result, mode)
      if (mode === 'plugin-disabled' || mode === 'plugin-enabled') {
        const disabled = mode === 'plugin-disabled' ? 'plugin' : null
        const transform = (plugin) => ({
          ...plugin,
          disabled_reason: disabled,
          installs: plugin.installs.map((install) => ({ ...install, disabled_reason: disabled }))
        })
        if (channel === 'plugins:detail' && result)
          return { ...result, plugin: transform(result.plugin) }
        if (channel === 'plugins:list') return result.map(transform)
      }
      if (mode.startsWith('project-tree')) return projectTreeFixture(channel, args, result, mode)
      if (
        channel === 'skills:list' &&
        ['scan-updating', 'scan-background', 'scan-manual', 'scan-retrying'].includes(mode)
      ) {
        return {
          ...result,
          scanComplete: true,
          scanSummary: {
            outcome: mode === 'scan-retrying' ? 'failed' : 'complete',
            completedAt: new Date().toISOString(),
            isStartup: mode === 'scan-retrying',
            sources: mode === 'scan-retrying' ? [{ name: 'scanSkills', status: 'failed' }] : []
          },
          scanActivity: {
            id: 9001,
            startedAt: Date.now() - 60_000,
            isStartup: mode === 'scan-updating' || mode === 'scan-retrying',
            revealMs: mode === 'scan-background' ? 8_000 : 500
          }
        }
      }
      if (
        (channel === 'skills:list' || channel === 'app:rescan') &&
        PROJECT_SCAN_MODES.includes(mode)
      ) {
        const missingProject = mode === 'scan-missing' || mode === 'scan-mixed'
        const summary = {
          outcome: 'partial',
          isStartup: mode !== 'scan-manual-partial',
          completedAt: projectScanCompletedAt,
          sources: [
            {
              name: 'scanPluginRegistry',
              status: 'partial',
              issues: [
                {
                  code: missingProject ? 'project_missing' : 'permission_required',
                  path: missingProject
                    ? 'C:\\Old Projects\\Megatron'
                    : 'C:\\Projects\\Megatron HQ\\Megatron'
                }
              ]
            }
          ]
        }
        if (mode === 'scan-mixed')
          summary.sources.push({
            name: 'scanSkills',
            status: 'partial',
            issues: [{ code: 'source_unavailable', path: 'C:\\Projects\\Private\\.claude\\skills' }]
          })
        return channel === 'skills:list'
          ? { ...result, scanComplete: true, scanActivity: null, scanSummary: summary }
          : summary
      }
      if ((channel === 'skills:list' || channel === 'app:rescan') && mode === 'scan-timeout') {
        const summary = {
          outcome: 'partial',
          isStartup: false,
          completedAt: new Date().toISOString(),
          sources: [
            { name: 'scanTranscripts', status: 'complete' },
            { name: 'archiveTokens', status: 'complete' },
            { name: 'scanSkills', status: 'failed', failureReason: 'timeout' }
          ]
        }
        return channel === 'skills:list'
          ? { ...result, scanComplete: true, scanActivity: null, scanSummary: summary }
          : summary
      }
      if (mode === 'history-pages') {
        const offset = channel === 'skills:openHistory' ? (args[1] ?? 0) : (args[0]?.offset ?? 0)
        return Array.from({ length: offset === 0 ? 200 : 3 }, (_, index) => ({
          preceding_user_text: `Synthetic activity ${offset + index + 1}`,
          invoked_at: new Date(
            Date.UTC(2026, 9, 10, 12, 0, 0) - (offset + index) * 1000
          ).toISOString(),
          trigger_type: 'user_invoked',
          cwd: '/synthetic/project',
          git_branch: 'main',
          agent_id: null,
          skillName: 'synthetic',
          skillId: null,
          sourceType: 'global'
        }))
      }
      if (mode === 'preview-limit' && result) {
        return {
          ...result,
          files: [{ relativePath: 'SKILL.md', content: null, status: 'preview_limit' }]
        }
      }
      return result
    })
  }
}

await import('../../../out/main/index.js')

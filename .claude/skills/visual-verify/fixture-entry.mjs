// Test-only entry point. Production continues to launch out/main/index.js directly.
import { app, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { projectTreeFixture } from './project-tree-fixture.mjs'
import { usageHistoryFixture } from './usage-history-fixture.mjs'
import { contextBaselineFixture } from './context-baseline-fixture.mjs'

const registeredHandlers = new Map()
const overriddenChannels = new Set()
const SCAN_NOTIFICATION_CHANNELS = new Set(['scan:started', 'scan:progress', 'scan:complete'])
const MIN_FIXTURE_SCAN_ID = 9000
const PROJECT_SCAN_MODES = ['scan-permission', 'scan-missing', 'scan-mixed', 'scan-manual-partial']

// Every Claude Code folder state is driven from the real status, so paths read as this machine's
// home. `.claude-work` stands in for a named profile that may not exist here.
function claudeFolderFixture(result, mode) {
  const home = dirname(result.options.find((option) => option.id === 'default').path)
  const work = join(home, '.claude-work')
  const defaultPath = join(home, '.claude')
  const options = (active) => [
    { id: 'saved', path: work, tags: ['environment'], active: active === 'work' },
    { id: 'default', path: defaultPath, tags: ['default'], active: active === 'default' },
    { id: 'home:.claude-personal', path: join(home, '.claude-personal'), tags: [], active: false }
  ]
  const named = { path: work, source: 'settings', options: options('work') }
  if (mode.startsWith('claude-folder-many')) {
    const path = join(
      home,
      'profiles',
      'a-long-team-name-with-several-environments',
      'claude-code-production-profile'
    )
    const fallback = mode.endsWith('fallback')
    return {
      path: fallback ? defaultPath : path,
      source: fallback ? 'default' : 'settings',
      state: mode.endsWith('paused') ? 'paused' : 'ok',
      issue:
        mode === 'claude-folder-many'
          ? null
          : {
              value: path,
              reason: fallback ? 'no-marker' : 'missing',
              source: 'settings'
            },
      options: [
        { id: 'saved', path, tags: ['environment'], active: !fallback },
        ...options(fallback ? 'default' : 'none').filter((option) => option.id !== 'saved'),
        ...Array.from({ length: 16 }, (_, index) => ({
          id: `home:long-profile-${index}`,
          path:
            index % 2 === 0
              ? `D:\\Team Profiles\\A very long organization name\\Production environments\\Claude Code profile ${index}`
              : `/Volumes/Team profiles/A very long organization name/Production environments/Claude Code profile ${index}`,
          tags: index === 0 ? ['environment'] : [],
          active: false
        }))
      ]
    }
  }
  switch (mode) {
    case 'claude-folder-options':
      return { ...named, state: 'ok', issue: null }
    case 'claude-folder-missing':
      return {
        ...named,
        state: 'paused',
        issue: { value: work, reason: 'missing', source: 'settings' }
      }
    case 'claude-folder-failing':
      return {
        ...named,
        state: 'paused',
        issue: { value: work, reason: 'no-marker', source: 'settings' }
      }
    case 'claude-folder-switching':
      return { ...named, state: 'switching', issue: null }
    // CLAUDE_CONFIG_DIR names ~/.claude, so it reads .claude.json inside it: a second ~/.claude
    // row beside the Default one, told apart by its tags.
    case 'claude-folder-named':
      return {
        path: defaultPath,
        source: 'environment',
        state: 'ok',
        issue: null,
        options: [
          { id: 'default', path: defaultPath, tags: ['default'], active: false },
          { id: 'environment', path: defaultPath, tags: ['environment', 'named'], active: true },
          {
            id: 'home:.claude-personal',
            path: join(home, '.claude-personal'),
            tags: [],
            active: false
          }
        ]
      }
    case 'claude-folder-fallback':
      return {
        path: defaultPath,
        source: 'default',
        state: 'ok',
        issue: {
          value: join(home, 'Documents', 'claude'),
          reason: 'no-marker',
          source: 'environment'
        },
        options: options('default')
      }
    default:
      throw new Error(`Unknown Claude Code folder fixture: ${mode}`)
  }
}
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
      if (channel === 'updates:getState' && mode.startsWith('update-')) {
        const status = mode.slice('update-'.length)
        const detail =
          status === 'manual' ? "this account can't write to /Applications/Megatron.app." : null
        return { status, version: '0.1.1', detail, autoCheck: true }
      }
      // Before `original`: the real handler would spawn the Claude Code CLI.
      if (mode.startsWith('context-baseline')) return contextBaselineFixture(mode)
      // Before `original`: the real handler would open the native folder picker.
      if (channel === 'folders:pickAndAdd' && mode.startsWith('project-tree'))
        return projectTreeFixture(channel, args, undefined, mode)
      const fixtureProjectRescan = channel === 'app:rescan' && PROJECT_SCAN_MODES.includes(mode)
      const result = fixtureProjectRescan ? undefined : await original(event, ...args)
      if (mode.startsWith('usage-history')) return usageHistoryFixture(channel, args, result, mode)
      if (channel === 'claudeFolder:get' && mode.startsWith('claude-folder-'))
        return claudeFolderFixture(result, mode)
      // Onboarding's no-data step: a machine where Claude Code never ran, after both scans settle.
      if (mode === 'no-data') {
        if (channel === 'skills:list') return { ...result, skills: [], scanComplete: true }
        if (channel === 'plugins:list') return []
        if (channel === 'usage:projects') return { locations: [], projects: [] }
        if (channel === 'usage:overview') return { ...result, scanComplete: true }
      }
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
      // Real staleness depends on this machine's history, so mark one row the rule could flag.
      if (channel === 'skills:list' && mode === 'skills-stale') {
        const target = result.skills.find(
          (skill) => skill.disabled_reason === null && skill.shadowed_by_skill_id === null
        )
        return {
          ...result,
          skills: result.skills.map((skill) => ({ ...skill, stale: skill === target }))
        }
      }
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

// Test-only entry point. Production continues to launch out/main/index.js directly.
import { ipcMain } from 'electron'

const registeredHandlers = new Map()
const overriddenChannels = new Set()
const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => {
  registeredHandlers.set(channel, handler)
  registerHandler(channel, handler)
}

globalThis.megatronVisualFixtures = {
  reset() {
    for (const channel of overriddenChannels) {
      ipcMain.removeHandler(channel)
      registerHandler(channel, registeredHandlers.get(channel))
    }
    overriddenChannels.clear()
  },
  set(channel, mode) {
    const original = registeredHandlers.get(channel)
    if (!original) throw new Error(`Unknown fixture channel: ${channel}`)
    ipcMain.removeHandler(channel)
    overriddenChannels.add(channel)
    registerHandler(channel, async (event, ...args) => {
      if (mode === 'error') throw new Error('Visual fixture: unavailable source')
      if (mode === 'pending') return new Promise(() => {})
      const result = await original(event, ...args)
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

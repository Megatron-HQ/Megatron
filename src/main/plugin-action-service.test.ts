import { describe, expect, it } from 'vitest'
import type {
  PluginActionInput,
  PluginActionResult,
  PluginDetailResult,
  PluginInstall,
  ScanSummary
} from '../shared/ipc'
import { createPluginActionService, type PluginActionVerb } from './plugin-action-service'

const input: PluginActionInput = {
  name: 'demo',
  marketplace: 'market',
  scope: 'user',
  projectPath: null
}
const complete: ScanSummary = {
  outcome: 'complete',
  completedAt: '2026-10-27T12:00:00Z',
  sources: [{ name: 'scanPluginRegistry', status: 'complete' }]
}
function detail(overrides: Partial<PluginInstall> = {}): PluginDetailResult {
  return {
    plugin: {
      name: 'demo',
      marketplace: 'market',
      marketplace_repo: null,
      installed_version: '2.0.0',
      available_version: '2.0.0',
      disabled_reason: 'plugin',
      skill_count: 0,
      installs: [
        {
          scope: 'user',
          project_path: null,
          install_path: '/fixture/plugin',
          installed_version: '2.0.0',
          available_version: '2.0.0',
          installed_at: null,
          last_updated: null,
          git_commit_sha: null,
          disabled_reason: 'plugin',
          enablement_known: true,
          project_missing: false,
          ...overrides
        }
      ]
    },
    skills: [],
    components: [],
    totalInvocations: 0,
    errorCount: 0,
    warningCount: 0
  }
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => (resolve = accept))
  return { promise, resolve }
}
interface ActionFixture {
  service: ReturnType<typeof createPluginActionService>
  dependencies: Parameters<typeof createPluginActionService>[0]
  commands: string[]
  scans: string[]
  reports: unknown[]
  setSnapshot: (value: PluginDetailResult | null) => void
  background: () => number
}
function fixture(): ActionFixture {
  const commands: string[] = []
  const scans: string[] = []
  const reports: unknown[] = []
  let snapshot: PluginDetailResult | null = detail()
  let background = 0
  const command =
    (verb: PluginActionVerb): (() => Promise<PluginActionResult>) =>
    async (): Promise<PluginActionResult> => {
      commands.push(verb)
      return { ok: true }
    }
  const execute = {
    enable: command('enable'),
    disable: command('disable'),
    update: command('update'),
    uninstall: command('uninstall')
  }
  const dependencies = {
    execute,
    refresh: async (scope: 'all' | 'plugins'): Promise<ScanSummary> => {
      scans.push(scope)
      return complete
    },
    readDetail: (): PluginDetailResult | null => snapshot,
    scheduleBackground: (): void => {
      background++
    },
    reportError: (_verb: PluginActionVerb, error: unknown): void => {
      reports.push(error)
    }
  }
  return {
    service: createPluginActionService(dependencies),
    dependencies,
    commands,
    scans,
    reports,
    setSnapshot: (value: PluginDetailResult | null) => {
      snapshot = value
    },
    background: () => background
  }
}

describe('verified plugin action service', () => {
  it.each(['enable', 'disable', 'update', 'uninstall'] as const)(
    'verifies %s with the correct scan scope and returns its snapshot',
    async (verb) => {
      const state = fixture()
      const snapshot =
        verb === 'uninstall'
          ? null
          : detail({ disabled_reason: verb === 'disable' ? 'plugin' : null })
      state.setSnapshot(snapshot)
      const result = await state.service.run(verb, input)
      expect(result).toEqual({ ok: true, detail: snapshot })
      expect(state.commands).toEqual([verb])
      expect(state.scans).toEqual([verb === 'uninstall' ? 'all' : 'plugins'])
      expect(state.background()).toBe(verb === 'uninstall' ? 0 : 1)
    }
  )

  it('retries inventory verification after a transient scan failure without repeating the CLI command', async () => {
    const state = fixture()
    let attempts = 0
    state.dependencies.refresh = async () => {
      if (attempts++ === 0) throw new Error('Temporary inventory lock')
      return complete
    }
    expect(await state.service.run('disable', input)).toEqual({ ok: true, detail: detail() })
    expect(attempts).toBe(2)
    expect(state.commands).toEqual(['disable'])
    expect(state.reports).toEqual([])
  })

  it('retries a partial registry snapshot before reporting success', async () => {
    const state = fixture()
    let attempts = 0
    state.dependencies.refresh = async () =>
      ++attempts === 1
        ? {
            ...complete,
            outcome: 'partial',
            sources: [{ name: 'scanPluginRegistry', status: 'partial' }]
          }
        : complete
    expect(await state.service.run('disable', input)).toMatchObject({
      ok: true,
      detail: { plugin: { installs: [{ disabled_reason: 'plugin' }] } }
    })
    expect(attempts).toBe(2)
    expect(state.commands).toEqual(['disable'])
  })

  it('bounds failed verification and preserves the effective enabled state when an override wins', async () => {
    const state = fixture()
    state.setSnapshot(detail({ disabled_reason: null }))
    const result = await state.service.run('disable', input)
    expect(result).toMatchObject({
      ok: true,
      verificationError: expect.stringMatching(/still enabled.*override/i)
    })
    expect(result.detail).toBeUndefined()
    expect(state.scans).toEqual(['plugins', 'plugins'])
    expect(state.commands).toEqual(['disable'])
    expect(state.reports).toHaveLength(1)
  })

  it('never treats unreadable target settings as a verified disable', async () => {
    const state = fixture()
    state.setSnapshot(detail({ enablement_known: false }))
    expect(await state.service.run('disable', input)).toMatchObject({
      verificationError: expect.stringMatching(/unavailable/)
    })
  })

  it('allows unrelated missing folder grants without trusting an unreadable target', async () => {
    const state = fixture()
    state.dependencies.refresh = async () => ({
      ...complete,
      outcome: 'partial',
      sources: [
        {
          name: 'scanPluginRegistry',
          status: 'partial',
          issues: [{ code: 'permission_required', path: '/another/project' }]
        }
      ]
    })
    expect(await state.service.run('disable', input)).toEqual({ ok: true, detail: detail() })
    state.setSnapshot(detail({ enablement_known: false }))
    expect(await state.service.run('disable', input)).toMatchObject({
      verificationError: expect.any(String)
    })
  })

  it('preserves command failures without scanning or reporting success', async () => {
    const state = fixture()
    state.dependencies.execute.disable = async () => ({
      ok: false,
      stderr: 'Settings are read only'
    })
    expect(await state.service.run('disable', input)).toEqual({
      ok: false,
      stderr: 'Settings are read only'
    })
    expect(state.scans).toEqual([])
    expect(state.background()).toBe(0)
  })

  it.each(['enable', 'update', 'uninstall'] as const)(
    'blocks a conflicting %s until disable verification finishes',
    async (verb) => {
      const state = fixture()
      const scan = deferred<ScanSummary>()
      state.dependencies.refresh = () => scan.promise
      const first = state.service.run('disable', input)
      await Promise.resolve()
      try {
        expect(await state.service.run(verb, input)).toMatchObject({
          ok: false,
          stderr: expect.stringMatching(/already running/)
        })
        expect(state.commands).toEqual(['disable'])
      } finally {
        scan.resolve(complete)
        await first
      }
    }
  )

  it('keeps different installation scopes independent', async () => {
    const state = fixture()
    const scan = deferred<ScanSummary>()
    let calls = 0
    state.dependencies.refresh = () => (++calls === 1 ? scan.promise : Promise.resolve(complete))
    const snapshot = detail()
    snapshot.plugin.installs.push({
      ...snapshot.plugin.installs[0],
      scope: 'project',
      project_path: '/another/project'
    })
    state.setSnapshot(snapshot)
    const user = state.service.run('disable', input)
    await Promise.resolve()
    try {
      expect(
        await state.service.run('disable', {
          ...input,
          scope: 'project',
          projectPath: '/another/project'
        })
      ).toEqual({ ok: true, detail: snapshot })
    } finally {
      scan.resolve(complete)
      await user
    }
  })

  it.runIf(process.platform === 'win32')(
    'uses one lock for Windows aliases of the same project installation',
    async () => {
      const state = fixture()
      const project = { ...input, scope: 'project' as const, projectPath: 'C:\\Projects\\demo' }
      state.setSnapshot(detail({ scope: 'project', project_path: project.projectPath }))
      const scan = deferred<ScanSummary>()
      state.dependencies.refresh = () => scan.promise
      const first = state.service.run('disable', project)
      await Promise.resolve()
      try {
        expect(
          await state.service.run('enable', { ...project, projectPath: 'c:/projects/DEMO/' })
        ).toMatchObject({ ok: false })
      } finally {
        scan.resolve(complete)
        expect(await first).toMatchObject({ ok: true, detail: expect.any(Object) })
      }
    }
  )

  it('releases its lock after failed verification so another attempt can succeed', async () => {
    const state = fixture()
    state.setSnapshot(null)
    expect(await state.service.run('disable', input)).toMatchObject({
      verificationError: expect.any(String)
    })
    state.setSnapshot(detail())
    expect(await state.service.run('disable', input)).toEqual({ ok: true, detail: detail() })
  })

  it('verifies uninstall removal while preserving another installation', async () => {
    const state = fixture()
    const remaining = detail({ scope: 'project', project_path: '/another/project' })
    state.setSnapshot(remaining)
    expect(await state.service.run('uninstall', input)).toEqual({ ok: true, detail: remaining })
  })
})

import type Database from 'better-sqlite3'
import type {
  ScanSourceSummary,
  ScanSummary,
  ScanTaskResult,
  ScanWorkerProgress
} from '../../shared/ipc'
import { Worker } from 'worker_threads'

export interface ScanWorkerTask {
  result: Promise<ScanSummary>
  cancel: () => Promise<void>
}

export class ScanWorkerError extends Error {
  constructor(
    message: string,
    readonly summary: ScanSummary
  ) {
    super(message)
  }
}

export function startScanWorker(
  entry: string | URL,
  input: object,
  timeoutMs = 60_000,
  onProgress: (progress: ScanWorkerProgress) => void = () => undefined
): ScanWorkerTask {
  const worker = new Worker(entry, {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
  })
  let rejectTask!: (error: Error) => void
  let finished = false
  let activeSource: string | null = null
  const sources: ScanSourceSummary[] = []
  let projects: ScanSummary['projects']
  function failure(message: string, reason: ScanSourceSummary['failureReason']): ScanWorkerError {
    return new ScanWorkerError(message, {
      outcome: sources.some((source) => source.status !== 'failed') ? 'partial' : 'failed',
      completedAt: new Date().toISOString(),
      sources: [
        ...sources,
        { name: activeSource ?? 'scanWorker', status: 'failed', failureReason: reason }
      ],
      ...(projects === undefined ? {} : { projects })
    })
  }
  const result = new Promise<ScanSummary>((resolve, reject) => {
    rejectTask = reject
    worker.on('message', (message: ScanSummary | ScanWorkerProgress) => {
      if (finished) return
      if ('type' in message) {
        if (message.type === 'source-started') activeSource = message.name
        else {
          sources.push(message.source)
          activeSource = null
          if (message.projects !== undefined) projects = message.projects
        }
        onProgress(message)
        return
      }
      finished = true
      resolve(message)
    })
    worker.once('error', (error) => {
      finished = true
      reject(failure(error.message, 'worker_crash'))
    })
    worker.once('exit', (code) => {
      if (!finished) {
        finished = true
        reject(failure(`Scan worker exited before completion (${code})`, 'worker_crash'))
      }
    })
  })
  const timer = setTimeout(async () => {
    finished = true
    await worker.terminate()
    rejectTask(failure('Scan time limit reached', 'timeout'))
  }, timeoutMs)
  void result.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  )
  return {
    result,
    async cancel() {
      clearTimeout(timer)
      finished = true
      await worker.terminate()
      rejectTask(new Error('Scan cancelled after folder permissions changed'))
    }
  }
}

export type ScanScope = 'all' | 'inventory' | 'plugins'

export function createScanController(start: (scope: ScanScope) => ScanWorkerTask): {
  request: (options?: { fresh?: boolean; scope?: ScanScope }) => Promise<ScanSummary>
  cancel: () => Promise<void>
} {
  type Completion = {
    result: Promise<ScanSummary>
    resolve: (summary: ScanSummary) => void
    reject: (error: unknown) => void
  }
  type Outcome = { ok: true; summary: ScanSummary } | { ok: false; error: unknown }
  type ActiveScan = {
    task: ScanWorkerTask
    scope: ScanScope
    superseded: boolean
    outcome: Outcome | null
    refreshRequested: boolean
  }
  const completions = new Map<ScanScope, Completion>()
  let current: ActiveScan | null = null
  let cancellation: Promise<void> | null = null
  let permissionEpoch = 0

  function startNext(): void {
    if (current !== null || cancellation !== null) return
    const scope = (['plugins', 'all', 'inventory'] as const).find((candidate) =>
      completions.has(candidate)
    )
    if (scope === undefined) return
    const pending = completions.get(scope)
    if (!pending) return
    try {
      const scan: ActiveScan = {
        task: start(scope),
        scope,
        superseded: false,
        outcome: null,
        refreshRequested: false
      }
      current = scan
      void scan.task.result.then(
        (summary) => complete(scan, { ok: true, summary }),
        (error) => complete(scan, { ok: false, error })
      )
    } catch (error) {
      completions.delete(scope)
      pending.reject(error)
      startNext()
    }
  }

  function complete(scan: ActiveScan, outcome: Outcome): void {
    scan.outcome = outcome
    if (scan.superseded) return
    if (current === scan) current = null
    // A command may finish after this worker read the registry. Its callers need a new snapshot.
    if (!scan.refreshRequested) {
      const pending = completions.get(scan.scope)
      completions.delete(scan.scope)
      if (outcome.ok) pending?.resolve(outcome.summary)
      else pending?.reject(outcome.error)
    }
    startNext()
  }

  function cancelActive(): Promise<void> {
    if (cancellation !== null) return cancellation
    const active = current
    if (active === null) return Promise.resolve()
    active.superseded = true
    cancellation = Promise.resolve()
      .then(() => active.task.cancel())
      .then(
        () => {
          if (current === active) current = null
          cancellation = null
        },
        (error) => {
          cancellation = null
          active.superseded = false
          if (active.outcome !== null) complete(active, active.outcome)
          throw error
        }
      )
    return cancellation
  }

  function prioritizePlugins(): void {
    const epoch = permissionEpoch
    void cancelActive().then(
      () => {
        // A folder picker/revocation must finish changing grants before any worker restarts.
        if (permissionEpoch === epoch) startNext()
      },
      (error) => {
        const pending = completions.get('plugins')
        completions.delete('plugins')
        pending?.reject(error)
      }
    )
  }

  return {
    request(options) {
      const scope = options?.scope ?? 'all'
      let pending = completions.get(scope)
      if (!pending) {
        let resolve!: Completion['resolve']
        let reject!: Completion['reject']
        const result = new Promise<ScanSummary>((accept, fail) => {
          resolve = accept
          reject = fail
        })
        pending = { result, resolve, reject }
        completions.set(scope, pending)
      }
      if (current === null && cancellation === null) {
        startNext()
      } else if (current !== null && !current.superseded) {
        if (current.scope === scope && options?.fresh) current.refreshRequested = true
        if (scope === 'plugins' && current.scope !== 'plugins') prioritizePlugins()
      }
      return pending.result
    },
    cancel() {
      permissionEpoch++
      return cancelActive()
    }
  }
}

export type ScanTask =
  | ((db: Database.Database) => unknown)
  | {
      name: string
      run: (db: Database.Database) => unknown
    }

const INVENTORY_SOURCES = new Set(['scanSkills', 'scanPluginRegistry', 'runLinter'])

export function selectScanTasks(scope: ScanScope, tasks: ScanTask[]): ScanTask[] {
  if (scope === 'all') return tasks
  return tasks.filter((task) =>
    scope === 'plugins' ? task.name === 'scanPluginRegistry' : INVENTORY_SOURCES.has(task.name)
  )
}
export type ScanErrorReporter = (error: unknown) => void

export function runAllScans(
  db: Database.Database,
  scans: ScanTask[],
  reportError: ScanErrorReporter = () => undefined,
  reportProgress: (progress: ScanWorkerProgress) => void = () => undefined
): ScanSummary {
  const sources: ScanSummary['sources'] = []
  let projects: ScanSummary['projects']
  for (const task of scans) {
    const name = task.name || 'scan'
    const scan = typeof task === 'function' ? task : task.run
    reportProgress({ type: 'source-started', name })
    let discoveredProjects: ScanSummary['projects']
    try {
      const result = scan(db) as ScanTaskResult | undefined
      if (result?.projects !== undefined) {
        projects = result.projects
        discoveredProjects = result.projects
      }
      sources.push({
        name,
        status: result?.status === 'partial' ? 'partial' : 'complete',
        ...(result?.issues?.length ? { issues: result.issues } : {})
      })
    } catch (error) {
      reportError(error)
      sources.push({ name, status: 'failed', failureReason: 'scan_error' })
    }
    reportProgress({
      type: 'source-complete',
      source: sources[sources.length - 1],
      ...(discoveredProjects === undefined ? {} : { projects: discoveredProjects })
    })
  }
  return {
    outcome: sources.every((source) => source.status === 'complete')
      ? 'complete'
      : sources.every((source) => source.status === 'failed')
        ? 'failed'
        : 'partial',
    completedAt: new Date().toISOString(),
    sources,
    ...(projects !== undefined ? { projects } : {})
  }
}

import type Database from 'better-sqlite3'
import type {
  ScanResult,
  ScanSourceSummary,
  ScanTaskResult,
  ScanWorkerProgress
} from '../../shared/ipc'
import { Worker } from 'worker_threads'

export interface ScanWorkerTask {
  result: Promise<ScanResult>
  cancel: () => Promise<void>
}

export class ScanWorkerError extends Error {
  constructor(
    message: string,
    readonly summary: ScanResult
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
  // Kept from a finished source, so a crash after scanSkills still records what it found.
  let projects: ScanResult['projects']
  let findings: ScanResult['findings']
  function failure(message: string, reason: ScanSourceSummary['failureReason']): ScanWorkerError {
    return new ScanWorkerError(message, {
      outcome: sources.some((source) => source.status !== 'failed') ? 'partial' : 'failed',
      completedAt: new Date().toISOString(),
      sources: [
        ...sources,
        { name: activeSource ?? 'scanWorker', status: 'failed', failureReason: reason }
      ],
      ...(projects === undefined ? {} : { projects }),
      ...(findings === undefined ? {} : { findings })
    })
  }
  const result = new Promise<ScanResult>((resolve, reject) => {
    rejectTask = reject
    worker.on('message', (message: ScanResult | ScanWorkerProgress) => {
      if (finished) return
      if ('type' in message) {
        if (message.type === 'source-started') activeSource = message.name
        else {
          sources.push(message.source)
          activeSource = null
          if (message.projects !== undefined) projects = message.projects
          if (message.findings !== undefined) findings = message.findings
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
  request: (options?: { fresh?: boolean; scope?: ScanScope }) => Promise<ScanResult>
  cancel: () => Promise<void>
  suspend: () => Promise<void>
  resume: () => void
} {
  type Completion = {
    result: Promise<ScanResult>
    resolve: (summary: ScanResult) => void
    reject: (error: unknown) => void
  }
  type Outcome = { ok: true; summary: ScanResult } | { ok: false; error: unknown }
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
  let suspended = false

  function startNext(): void {
    if (suspended || current !== null || cancellation !== null) return
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
      if (suspended)
        return Promise.reject(new Error('Claude Code folder is unavailable; scans are suspended'))
      const scope = options?.scope ?? 'all'
      let pending = completions.get(scope)
      if (!pending) {
        let resolve!: Completion['resolve']
        let reject!: Completion['reject']
        const result = new Promise<ScanResult>((accept, fail) => {
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
    },
    suspend() {
      suspended = true
      permissionEpoch++
      const error = new Error('Claude Code folder is unavailable; scan interrupted')
      for (const pending of completions.values()) pending.reject(error)
      completions.clear()
      return cancelActive()
    },
    resume() {
      suspended = false
      startNext()
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
): ScanResult {
  const sources: ScanResult['sources'] = []
  let projects: ScanResult['projects']
  let findings: ScanResult['findings']
  for (const task of scans) {
    const name = task.name || 'scan'
    const scan = typeof task === 'function' ? task : task.run
    reportProgress({ type: 'source-started', name })
    let discoveredProjects: ScanResult['projects']
    let discoveredFindings: ScanResult['findings']
    try {
      const result = scan(db) as ScanTaskResult | undefined
      if (result?.projects !== undefined) {
        projects = result.projects
        discoveredProjects = result.projects
      }
      if (result?.findings !== undefined) {
        findings = result.findings
        discoveredFindings = result.findings
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
      ...(discoveredProjects === undefined ? {} : { projects: discoveredProjects }),
      ...(discoveredFindings === undefined ? {} : { findings: discoveredFindings })
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
    ...(projects !== undefined ? { projects } : {}),
    ...(findings !== undefined ? { findings } : {})
  }
}

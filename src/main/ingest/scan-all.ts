import type Database from 'better-sqlite3'
import type { ScanSummary, ScanTaskResult } from '../../shared/ipc'
import { Worker } from 'worker_threads'

export interface ScanWorkerTask {
  result: Promise<ScanSummary>
  cancel: () => Promise<void>
}

export function startScanWorker(
  entry: string | URL,
  input: object,
  timeoutMs = 60_000
): ScanWorkerTask {
  const worker = new Worker(entry, {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 }
  })
  let rejectTask!: (error: Error) => void
  let finished = false
  const result = new Promise<ScanSummary>((resolve, reject) => {
    rejectTask = reject
    worker.once('message', (summary: ScanSummary) => {
      finished = true
      resolve(summary)
    })
    worker.once('error', (error) => {
      finished = true
      reject(error)
    })
    worker.once('exit', (code) => {
      if (!finished) {
        finished = true
        reject(new Error(`Scan worker exited before completion (${code})`))
      }
    })
  })
  const timer = setTimeout(async () => {
    finished = true
    await worker.terminate()
    rejectTask(new Error('Scan time limit reached; previous index entries were retained'))
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

export function createScanController(start: () => ScanWorkerTask): {
  request: () => Promise<ScanSummary>
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
    completion: Completion
    superseded: boolean
    outcome: Outcome | null
  }
  let current: ActiveScan | null = null
  let completion: Completion | null = null
  let cancellation: Promise<void> | null = null

  function complete(scan: ActiveScan, outcome: Outcome): void {
    scan.outcome = outcome
    if (scan.superseded) return
    if (current === scan) current = null
    if (completion === scan.completion) completion = null
    if (outcome.ok) scan.completion.resolve(outcome.summary)
    else scan.completion.reject(outcome.error)
  }

  return {
    request() {
      if (completion === null) {
        let resolve!: Completion['resolve']
        let reject!: Completion['reject']
        const result = new Promise<ScanSummary>((accept, fail) => {
          resolve = accept
          reject = fail
        })
        completion = { result, resolve, reject }
      }
      const pending = completion
      if (current === null && cancellation === null) {
        try {
          const task = start()
          const scan: ActiveScan = {
            task,
            completion: pending,
            superseded: false,
            outcome: null
          }
          current = scan
          void task.result.then(
            (summary) => complete(scan, { ok: true, summary }),
            (error) => complete(scan, { ok: false, error })
          )
        } catch (error) {
          completion = null
          pending.reject(error)
        }
      }
      return pending.result
    },
    cancel() {
      if (cancellation !== null) return cancellation
      const pending = current
      if (pending === null) return Promise.resolve()
      // Permission changes replace the worker, but all callers still need the new result.
      pending.superseded = true
      cancellation = Promise.resolve()
        .then(() => pending.task.cancel())
        .then(
          () => {
            if (current === pending) current = null
            cancellation = null
          },
          (error) => {
            cancellation = null
            pending.superseded = false
            if (pending.outcome !== null) complete(pending, pending.outcome)
            throw error
          }
        )
      return cancellation
    }
  }
}

export type ScanTask = (db: Database.Database) => unknown
export type ScanErrorReporter = (error: unknown) => void

export function runAllScans(
  db: Database.Database,
  scans: ScanTask[],
  reportError: ScanErrorReporter = () => undefined
): ScanSummary {
  const sources: ScanSummary['sources'] = []
  let projects: ScanSummary['projects']
  for (const scan of scans) {
    try {
      const result = scan(db) as ScanTaskResult | undefined
      if (result?.projects !== undefined) projects = result.projects
      sources.push({
        name: scan.name || 'scan',
        status: result?.status === 'partial' ? 'partial' : 'complete',
        ...(result?.issues?.length ? { issues: result.issues } : {})
      })
    } catch (error) {
      reportError(error)
      sources.push({ name: scan.name || 'scan', status: 'failed' })
    }
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

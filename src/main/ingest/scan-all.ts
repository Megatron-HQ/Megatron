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
  let current: { task: ScanWorkerTask; result: Promise<ScanSummary> } | null = null
  let cancelling = false
  return {
    request() {
      if (cancelling) return Promise.reject(new Error('Scan cancellation is in progress'))
      if (current !== null) return current.result
      const task = start()
      const pending = { task, result: task.result }
      current = pending
      void task.result.then(
        () => {
          if (current === pending) current = null
        },
        () => {
          if (current === pending) current = null
        }
      )
      return pending.result
    },
    async cancel() {
      const pending = current
      if (pending === null) return
      cancelling = true
      try {
        await pending.task.cancel()
      } finally {
        if (current === pending) current = null
        cancelling = false
      }
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
  for (const scan of scans) {
    try {
      const result = scan(db) as ScanTaskResult | undefined
      sources.push({
        name: scan.name || 'scan',
        status: result?.status === 'partial' ? 'partial' : 'complete'
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
    sources
  }
}

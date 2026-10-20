import { describe, expect, it } from 'vitest'
import * as scans from './scan-all'
import type { ScanSummary } from '../../shared/ipc'

const summary: ScanSummary = {
  outcome: 'complete',
  completedAt: '2026-10-10T00:00:00.000Z',
  sources: []
}
const workerUrl = (body: string): URL => new URL(`data:text/javascript,${encodeURIComponent(body)}`)
const api = scans as typeof scans & {
  startScanWorker: (
    entry: URL,
    input: object,
    timeoutMs?: number
  ) => { result: Promise<ScanSummary>; cancel: () => Promise<void> }
  createScanController: (
    start: () => { result: Promise<ScanSummary>; cancel: () => Promise<void> }
  ) => {
    request: (options?: { fresh?: boolean }) => Promise<ScanSummary>
    cancel: () => Promise<void>
  }
}

describe('isolated scans', () => {
  it('waits for a scan started after a plugin change instead of returning the older snapshot', async () => {
    let version = '1.0.0'
    const finishes: (() => void)[] = []
    const controller = api.createScanController(() => {
      const snapshot = version
      return {
        result: new Promise((resolve) => {
          finishes.push(() => resolve({ ...summary, completedAt: snapshot }))
        }),
        cancel: async () => undefined
      }
    })
    const background = controller.request()
    version = '2.0.0'
    const afterAction = controller.request({ fresh: true })
    const secondAction = controller.request({ fresh: true })
    finishes[0]()
    await Promise.resolve()
    expect(finishes).toHaveLength(2)
    finishes[1]()
    expect((await afterAction).completedAt).toBe('2.0.0')
    expect(await secondAction).toEqual(await afterAction)
    expect(await background).toEqual(await afterAction)
  })

  it('runs the requested fresh scan even if the older scan fails', async () => {
    let failOld!: (error: Error) => void
    let started = 0
    const controller = api.createScanController(() => ({
      result:
        started++ === 0
          ? new Promise<ScanSummary>((_resolve, reject) => {
              failOld = reject
            })
          : Promise.resolve(summary),
      cancel: async () => undefined
    }))
    const background = controller.request()
    const refreshed = controller.request({ fresh: true })
    failOld(new Error('Old scan failed'))
    expect(await refreshed).toEqual(summary)
    expect(await background).toEqual(summary)
    expect(started).toBe(2)
  })

  it('holds requests made during termination for the replacement scan', async () => {
    let started = 0
    let finish!: (value: ScanSummary) => void
    let releaseCancel!: () => void
    const controller = api.createScanController(() => {
      started++
      return {
        result: new Promise((resolve) => {
          finish = resolve
        }),
        cancel: () =>
          new Promise((resolve) => {
            releaseCancel = resolve
          })
      }
    })
    const first = controller.request()
    const cancelled = controller.cancel()
    const duringCancellation = controller.request()
    expect(duringCancellation).toBe(first)
    expect(started).toBe(1)
    await Promise.resolve()
    finish(summary)
    releaseCancel()
    await cancelled
    expect(started).toBe(1)
    const restarted = controller.request()
    expect(started).toBe(2)
    const replacement = { ...summary, completedAt: '2026-10-20T00:00:00.000Z' }
    finish(replacement)
    expect(await first).toEqual(replacement)
    expect(await duringCancellation).toEqual(replacement)
    expect(await restarted).toEqual(replacement)
  })
  it('returns the worker result without blocking the calling event loop', async () => {
    const task = api.startScanWorker(
      workerUrl(
        "import {parentPort,workerData} from 'node:worker_threads'; parentPort.postMessage(workerData)"
      ),
      summary
    )
    expect(await task.result).toEqual(summary)
  })

  it('delivers the replacement result after terminating a real running worker', async () => {
    let started = 0
    const controller = api.createScanController(() =>
      api.startScanWorker(
        started++ === 0
          ? workerUrl('while(true) {}')
          : workerUrl(
              "import {parentPort,workerData} from 'node:worker_threads'; parentPort.postMessage(workerData)"
            ),
        summary
      )
    )
    const first = controller.request()
    await controller.cancel()
    const replacement = controller.request()
    expect(await first).toEqual(summary)
    expect(await replacement).toEqual(summary)
  })

  it('terminates a worker that exceeds its time budget', async () => {
    const task = api.startScanWorker(workerUrl('while(true) {}'), {}, 100)
    await expect(task.result).rejects.toThrow(/time limit/)
  })

  it('surfaces worker crashes rather than reporting a complete scan', async () => {
    const task = api.startScanWorker(workerUrl("throw new Error('fixture crash')"), {})
    await expect(task.result).rejects.toThrow('fixture crash')
  })

  it('coalesces requests and waits for cancellation before another scan starts', async () => {
    let started = 0
    let finish!: (value: ScanSummary) => void
    let releaseCancel!: () => void
    const controller = api.createScanController(() => {
      started++
      return {
        result: new Promise((resolve) => {
          finish = resolve
        }),
        cancel: () =>
          new Promise((resolve) => {
            releaseCancel = resolve
          })
      }
    })
    const first = controller.request()
    expect(controller.request()).toBe(first)
    expect(started).toBe(1)
    const cancelled = controller.cancel()
    await Promise.resolve()
    releaseCancel()
    finish(summary)
    await cancelled
    const second = controller.request()
    expect(started).toBe(2)
    const replacement = { ...summary, completedAt: '2026-10-20T00:00:00.000Z' }
    finish(replacement)
    expect(await first).toEqual(replacement)
    expect(await second).toEqual(replacement)
  })

  it('ignores a superseded worker rejection that arrives after its replacement starts', async () => {
    let failOld!: (error: Error) => void
    let finishNew!: (value: ScanSummary) => void
    let started = 0
    const controller = api.createScanController(() => ({
      result: new Promise<ScanSummary>((resolve, reject) => {
        if (started++ === 0) failOld = reject
        else finishNew = resolve
      }),
      cancel: async () => undefined
    }))
    const first = controller.request()
    await controller.cancel()
    const second = controller.request()
    failOld(new Error('Scan cancelled after folder permissions changed'))
    finishNew(summary)
    expect(await first).toEqual(summary)
    expect(await second).toEqual(summary)
  })

  it('keeps the running worker and its callers if termination fails', async () => {
    let finish!: (value: ScanSummary) => void
    let started = 0
    const controller = api.createScanController(() => {
      started++
      return {
        result: new Promise<ScanSummary>((resolve) => (finish = resolve)),
        cancel: async () => {
          throw new Error('Worker termination failed')
        }
      }
    })
    const first = controller.request()
    await expect(controller.cancel()).rejects.toThrow('Worker termination failed')
    expect(controller.request()).toBe(first)
    expect(started).toBe(1)
    finish(summary)
    expect(await first).toEqual(summary)
  })

  it('delivers a result that arrived while a failed termination was pending', async () => {
    let finish!: (value: ScanSummary) => void
    let failCancellation!: (error: Error) => void
    const controller = api.createScanController(() => ({
      result: new Promise<ScanSummary>((resolve) => (finish = resolve)),
      cancel: () => new Promise<void>((_resolve, reject) => (failCancellation = reject))
    }))
    const scanning = controller.request()
    const cancelling = controller.cancel()
    await Promise.resolve()
    finish(summary)
    await Promise.resolve()
    failCancellation(new Error('Worker termination failed'))
    await expect(cancelling).rejects.toThrow('Worker termination failed')
    expect(await scanning).toEqual(summary)
  })

  it('reports replacement startup failures to waiting callers and allows a later retry', async () => {
    let interrupt!: (error: Error) => void
    let started = 0
    const controller = api.createScanController(() => {
      started++
      if (started === 2) throw new Error('Replacement could not start')
      return {
        result:
          started === 1
            ? new Promise<ScanSummary>((_resolve, reject) => (interrupt = reject))
            : Promise.resolve(summary),
        cancel: async () => interrupt(new Error('Cancelled'))
      }
    })
    const first = controller.request()
    await controller.cancel()
    const replacement = controller.request()
    await expect(first).rejects.toThrow('Replacement could not start')
    await expect(replacement).rejects.toThrow('Replacement could not start')
    expect(await controller.request()).toEqual(summary)
  })
})

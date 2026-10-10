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
  ) => { request: () => Promise<ScanSummary>; cancel: () => Promise<void> }
}

describe('isolated scans', () => {
  it('rejects new requests while the old worker is being terminated', async () => {
    let finish!: (value: ScanSummary) => void
    let releaseCancel!: () => void
    const controller = api.createScanController(() => ({
      result: new Promise((resolve) => {
        finish = resolve
      }),
      cancel: () =>
        new Promise((resolve) => {
          releaseCancel = resolve
        })
    }))
    const first = controller.request()
    const cancelled = controller.cancel()
    const duringCancellation = controller.request()
    expect(duringCancellation).not.toBe(first)
    await expect(duringCancellation).rejects.toThrow(/cancellation/)
    finish(summary)
    releaseCancel()
    await cancelled
    await first
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
    releaseCancel()
    finish(summary)
    await cancelled
    await first
    const second = controller.request()
    expect(started).toBe(2)
    finish(summary)
    await second
  })
})

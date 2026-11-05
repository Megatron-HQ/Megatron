import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInventoryWatcher, type InventoryWatchRoot } from './inventory-watcher'

afterEach(() => vi.useRealTimers())

function fixture(): {
  service: ReturnType<typeof createInventoryWatcher>
  snapshots: number[]
  closed: string[]
  listeners: Map<string, (event: string, filename: string | null) => void>
  change: (event?: string, filename?: string | null) => void
  setRoots: (value: InventoryWatchRoot[]) => void
  block: () => void
  unblock: () => void
  hold: () => void
  release: () => void
  failNextRefresh: () => void
  errors: unknown[]
} {
  vi.useFakeTimers()
  let roots: InventoryWatchRoot[] = [{ path: '/approved', kind: 'project' }]
  const listeners = new Map<string, (event: string, filename: string | null) => void>()
  const closed: string[] = []
  const snapshots: number[] = []
  let version = 0
  let blocked = false
  let finish: (() => void) | undefined
  let hold = false
  let failNext = false
  const errors: unknown[] = []
  const service = createInventoryWatcher({
    getRoots: () => roots,
    watch: (path, listener) => {
      if (blocked) throw Object.assign(new Error('Unavailable'), { code: 'EACCES' })
      listeners.set(path, listener)
      return {
        close: () => {
          closed.push(path)
          listeners.delete(path)
        }
      }
    },
    refresh: async () => {
      snapshots.push(version)
      if (failNext) {
        failNext = false
        throw new Error('Scan unavailable')
      }
      if (hold)
        await new Promise<void>((resolve) => {
          finish = resolve
        })
    },
    reportError: (error) => errors.push(error)
  })
  return {
    service,
    snapshots,
    closed,
    listeners,
    errors,
    failNextRefresh() {
      failNext = true
    },
    change(event = 'rename', filename: string | null = 'child') {
      version++
      listeners.get('/approved')!(event, filename)
    },
    setRoots(value: InventoryWatchRoot[]) {
      roots = value
      service.update()
    },
    block() {
      blocked = true
    },
    unblock() {
      blocked = false
    },
    hold() {
      hold = true
    },
    release() {
      hold = false
      finish?.()
    }
  }
}

describe('live inventory watching', () => {
  it('retries a failed refresh without waiting for another filesystem notification', async () => {
    const test = fixture()
    test.failNextRefresh()
    test.change()
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.errors).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(test.snapshots).toEqual([1, 1])
    test.service.close()
  })

  it('cancels a queued refresh when shutdown happens before its microtask starts', async () => {
    const test = fixture()
    test.change()
    vi.advanceTimersByTime(1000)
    test.service.close()
    await Promise.resolve()
    expect(test.snapshots).toEqual([])
  })

  it('coalesces a bulk move into one refresh after file operations settle', async () => {
    const test = fixture()
    test.change()
    await vi.advanceTimersByTimeAsync(600)
    test.change()
    await vi.advanceTimersByTimeAsync(999)
    expect(test.snapshots).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(test.snapshots).toEqual([2])
    test.service.close()
  })

  it('refreshes skill edits but ignores source edits and generated-directory events', async () => {
    const test = fixture()
    test.change('change', 'src/app.ts')
    test.change('rename', 'node_modules/new-package')
    test.change('change', '.git/index')
    await vi.advanceTimersByTimeAsync(1100)
    expect(test.snapshots).toEqual([])
    test.change('change', 'repo/.claude/skills/example/SKILL.md')
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.snapshots).toEqual([4])
    test.service.close()
  })

  it('does not postpone refresh forever during a continuous stream of changes', async () => {
    const test = fixture()
    for (let index = 0; index < 10; index++) {
      test.change()
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(test.snapshots).toEqual([10])
    test.service.close()
  })

  it('queues one follow-up snapshot for changes received while a scan is active', async () => {
    const test = fixture()
    test.hold()
    test.change()
    await vi.advanceTimersByTimeAsync(1000)
    test.change()
    test.change()
    await vi.advanceTimersByTimeAsync(2000)
    expect(test.snapshots).toEqual([1])
    test.release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(test.snapshots).toEqual([1, 3])
    test.service.close()
  })

  it('retries unavailable watches and reconciles missed events periodically', async () => {
    const test = fixture()
    test.block()
    test.service.update()
    test.unblock()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(test.listeners.has('/approved')).toBe(true)
    expect(test.snapshots).toEqual([0])
    test.service.close()
  })

  it('closes revoked roots and prevents late events or timers from refreshing after shutdown', async () => {
    const test = fixture()
    const late = test.listeners.get('/approved')!
    test.change()
    test.setRoots([])
    test.service.close()
    late('rename', 'child')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(test.closed).toContain('/approved')
    expect(test.snapshots).toEqual([])
  })
})

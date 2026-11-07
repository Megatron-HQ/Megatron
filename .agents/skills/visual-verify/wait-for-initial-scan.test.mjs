import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { waitForInitialScan } from './wait-for-initial-scan.mjs'

test('keeps waiting after a false asynchronous result until the scan actually completes', async () => {
  let reads = 0
  let finishScan
  let settled = false
  const completed = new Promise((resolve) => {
    finishScan = resolve
  })
  const waiting = waitForInitialScan(async () => (++reads === 1 ? false : completed), {
    timeoutMs: 1000,
    pollMs: 1
  }).then(() => {
    settled = true
  })
  await delay(20)
  assert.equal(settled, false)
  finishScan(true)
  await waiting
  assert.equal(reads, 2)
})

test('times out when the initial scan remains incomplete', async () => {
  await assert.rejects(
    waitForInitialScan(async () => false, { timeoutMs: 20, pollMs: 1 }),
    /initial scan/i
  )
})

test('bounds the wait even when an IPC response never arrives', async () => {
  await assert.rejects(
    waitForInitialScan(() => new Promise(() => {}), { timeoutMs: 20, pollMs: 1 }),
    /initial scan/i
  )
})

test('reports an IPC error instead of turning it into an endless loading wait', async () => {
  await assert.rejects(
    waitForInitialScan(async () => {
      throw new Error('IPC unavailable')
    }),
    /IPC unavailable/
  )
})

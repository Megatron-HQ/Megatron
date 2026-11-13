import { setTimeout as delay } from 'node:timers/promises'

export async function waitForInitialScan(
  readScanComplete,
  { timeoutMs = 75_000, pollMs = 100 } = {}
) {
  let stopped = false
  let timeout
  const scanReady = (async () => {
    while (!stopped) {
      if (await readScanComplete()) return
      await delay(pollMs)
    }
  })()
  try {
    await Promise.race([
      scanReady,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          stopped = true
          reject(new Error('Timed out waiting for the initial scan'))
        }, timeoutMs)
      })
    ])
  } finally {
    stopped = true
    clearTimeout(timeout)
  }
}

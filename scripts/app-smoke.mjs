// The one check that runs the real app: preload, IPC, the scan worker and SQLite, which fixtures
// replace with a fake. Launches the built app (out/) in a throwaway profile, waits for the first
// scan, and opens each section at the minimum window size. Fails on a console error, an uncaught
// page error, or a page wider than its window. It reads this machine's real ~/.claude, so it says
// the app runs here, not how any screen should look.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { visualVerifierLaunchArgs } from './electron/electron-launch.mjs'
import { waitForInitialScan } from './electron/wait-for-initial-scan.mjs'
import { evaluateMainProcess, getWindowSizes } from './electron/window-sizes.mjs'

const SECTIONS = ['Skills', 'Plugins', 'Usage']

const profile = mkdtempSync(join(tmpdir(), 'megatron-app-smoke-'))
let app
try {
  app = await electron.launch({
    args: visualVerifierLaunchArgs(resolve('out/main/index.js'), profile),
    timeout: 60_000
  })
  const window = await app.firstWindow()
  const problems = []
  window.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  window.on('pageerror', (error) => problems.push(`page error: ${error.message}`))

  await window.waitForFunction(() => window.api !== undefined)
  await waitForInitialScan(() =>
    window.evaluate(async () => (await window.api.listSkills()).scanComplete)
  )
  // A new profile opens first-run onboarding over every section.
  await window.evaluate(() => window.api.setOnboardingDone())
  await window.reload()

  const minimum = (await getWindowSizes(app)).find((size) => size.label === 'min')
  await evaluateMainProcess(
    app,
    ({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setSize(width, height),
    [minimum.width, minimum.height]
  )

  for (const section of SECTIONS) {
    const button = window.getByRole('button', { name: section, exact: true })
    await button.click()
    await window.waitForFunction(
      (label) =>
        document.querySelector(`button[aria-label="${label}"][aria-current="page"]`) !== null &&
        document.querySelector('main [data-slot="skeleton"]') === null,
      section,
      { timeout: 60_000 }
    )
    const overflows = await window.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    if (overflows) {
      problems.push(`${section} is wider than the ${minimum.width}px minimum window.`)
    }
  }

  assert.deepEqual(problems, [])
  console.log(
    `App smoke passed: first scan finished, and ${SECTIONS.join(', ')} opened at ` +
      `${minimum.width}x${minimum.height} with no console error and no horizontal overflow.`
  )
} finally {
  if (app) await app.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

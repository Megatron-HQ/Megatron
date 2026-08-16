// Builds Megatron, launches the packaged app in an isolated profile, and
// screenshots every known screen/state (scenarios.mjs) at every window size
// Megatron actually supports — so an agent can Read the results back and
// judge them against what was asked for, catch regressions elsewhere in the
// app, and catch layout breaking at the app's real size range. This script
// only produces evidence; judging and fixing is the invoking agent's job —
// see SKILL.md for the full process.
//
// Isolation: `--user-data-dir` points Electron at a throwaway profile so this
// can never collide with a `npm run dev` session the user has open (fixed db
// path, no single-instance lock — see src/main/db/index.ts). The scanners
// still read real ~/.claude data regardless of userData, so screenshots stay
// realistic despite the empty profile.

import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import { scenarios } from './scenarios.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const OUT_DIR = join(REPO_ROOT, '.visual-verify')
const SETTLE_TIMEOUT_MS = 15_000

/** Waits past the loading skeleton into whichever real state comes next. */
async function waitForSettle(window) {
  await window.waitForFunction(
    () => {
      if (document.querySelector('[data-slot="skeleton"]')) return false
      const hasRow = document.querySelector('tbody tr') !== null
      const hasEmptyState = /no .*skills found/i.test(document.body.textContent ?? '')
      return hasRow || hasEmptyState
    },
    { timeout: SETTLE_TIMEOUT_MS }
  )
}

// This automated/backgrounded window doesn't reliably pump compositor frames,
// so authored CSS transitions (e.g. TableRow's transition-colors) can stall
// mid-animation indefinitely instead of completing in ~150ms like they would
// for a real, focused user session — a screenshot taken then shows stale
// colors that a real user would never see. Snap every transition to its end
// state before each capture so screenshots reflect settled UI, not a stuck
// animation frame.
async function finishTransitions(window) {
  await window.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish()
      } catch {
        // Infinite-duration animations (e.g. a lingering loading pulse) can't
        // finish — nothing to do, they're not what we're guarding against.
      }
    }
  })
}

/** A page wider than its own viewport is a real bug on a desktop app — never intentional. */
async function hasHorizontalOverflow(window) {
  return window.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
}

// Electron windows aren't a Playwright "viewport" — there's no
// page.setViewportSize() for _electron, resizing goes through the real
// BrowserWindow. Reading its real minimum back (rather than hardcoding it)
// keeps this in sync with src/main/index.ts's window config for free.
async function getWindowSizes(app) {
  const [minWidth, minHeight] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  const { width, height } = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  return [
    { label: 'default', width, height },
    { label: 'min', width: minWidth, height: minHeight }
  ]
}

async function resizeWindow(app, width, height) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
    [width, height]
  )
}

function registerDefectListeners(window, defects) {
  window.on('console', (msg) => {
    if (msg.type() === 'error') defects.consoleErrors.push(msg.text())
  })
  window.on('pageerror', (err) => {
    defects.pageErrors.push(err.message)
  })
}

async function captureAll(app, window, outDir) {
  const written = []
  const defects = { consoleErrors: [], pageErrors: [], overflow: [] }
  registerDefectListeners(window, defects)

  const sizes = await getWindowSizes(app)

  for (const scenario of scenarios) {
    for (const size of sizes) {
      // Reload back to the default baseline before every (scenario, size) pair
      // — scenarios describe "how to get from default to the state I want",
      // not a chain that depends on execution order. See scenarios.mjs.
      await window.reload()
      await waitForSettle(window)
      await resizeWindow(app, size.width, size.height)

      await scenario.run(window)
      await finishTransitions(window)

      const name = `${scenario.name}--${size.label}.png`
      console.log(`[visual-verify]   capturing ${name}...`)
      const path = join(outDir, name)
      await window.screenshot({ path })
      written.push(path)

      if (await hasHorizontalOverflow(window)) {
        defects.overflow.push(name)
      }
    }
  }

  return { written, defects }
}

function printSummary(written, defects) {
  console.log('[visual-verify] wrote:')
  for (const path of written) console.log(`  ${path}`)

  if (defects.overflow.length > 0) {
    console.log('[visual-verify] HORIZONTAL OVERFLOW at:')
    for (const name of defects.overflow) console.log(`  ${name}`)
  }
  if (defects.consoleErrors.length > 0) {
    console.log('[visual-verify] console errors:')
    for (const text of defects.consoleErrors) console.log(`  ${text}`)
  }
  if (defects.pageErrors.length > 0) {
    console.log('[visual-verify] uncaught page errors:')
    for (const message of defects.pageErrors) console.log(`  ${message}`)
  }
  if (
    defects.overflow.length === 0 &&
    defects.consoleErrors.length === 0 &&
    defects.pageErrors.length === 0
  ) {
    console.log('[visual-verify] no overflow or console/page errors detected.')
  }
}

async function main() {
  console.log('[visual-verify] building...')
  execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })

  const userDataDir = await mkdtemp(join(tmpdir(), 'megatron-visual-verify-'))
  // Clear stale output from a previous run first — otherwise a renamed or
  // removed scenario's old PNG lingers forever instead of going away with it.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  let app
  try {
    console.log('[visual-verify] launching...')
    app = await electron.launch({
      cwd: REPO_ROOT,
      args: [join(REPO_ROOT, 'out/main/index.js'), `--user-data-dir=${userDataDir}`]
    })

    const window = await app.firstWindow()
    await window.waitForLoadState('load')

    const { written, defects } = await captureAll(app, window, OUT_DIR)
    printSummary(written, defects)
  } finally {
    await app?.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[visual-verify] failed:', err)
  process.exit(1)
})

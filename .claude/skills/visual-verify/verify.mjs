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
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { _electron as electron } from 'playwright-core'
import { visualVerifierLaunchArgs } from './electron-launch.mjs'
import { scenarios } from './scenarios.mjs'
import { parseOnly, selectScenarios } from './select-scenarios.mjs'
import { evaluateMainProcess, getWindowSizes } from './window-sizes.mjs'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const OUT_DIR = join(REPO_ROOT, '.visual-verify')
const SETTLE_TIMEOUT_MS = 15_000

// A sibling of OUT_DIR, never nested inside it — OUT_DIR gets rm -rf'd at the
// start of every run (see main()), so a baseline stored inside it would be
// destroyed before it could ever be diffed against. Never wiped; persists
// across runs so "unchanged since last accepted" has something to mean.
const BASELINE_DIR = join(REPO_ROOT, '.visual-verify-baselines')

// Decided upfront and hardcoded rather than re-tuned per run — see SKILL.md's
// "Reading a diff result" section for why. The floor was measured, not
// guessed: with reduced-motion emulation on (below) and an otherwise
// identical baseline, repeated back-to-back runs still showed up to ~650
// differing pixels from ordinary subpixel font-rendering jitter (confirmed
// via a manual diff — it's confined to a couple of characters of sidebar
// text, not a layout change). 2000 clears that band with comfortable margin
// while staying far below what any real, visible layout/content regression
// would produce.
const DIFF_THRESHOLD = 0.1
const DIFF_PIXEL_FLOOR = 2000

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

/**
 * Diffs a freshly captured screenshot against its stored baseline (if any).
 * Returns 'new' (no baseline yet), 'changed' (meaningful pixel diff, or a
 * dimension mismatch that makes a pixel comparison impossible — e.g. a DPI
 * change — which pixelmatch can't compare and would otherwise throw on), or
 * 'unchanged' (matches the last accepted baseline).
 */
async function diffAgainstBaseline(screenshotPath, name) {
  let baselineBuffer
  try {
    baselineBuffer = await readFile(join(BASELINE_DIR, name))
  } catch {
    return 'new'
  }

  const baseline = PNG.sync.read(baselineBuffer)
  const candidate = PNG.sync.read(await readFile(screenshotPath))

  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    return 'changed'
  }

  const diffPixels = pixelmatch(
    baseline.data,
    candidate.data,
    null,
    baseline.width,
    baseline.height,
    {
      threshold: DIFF_THRESHOLD,
      includeAA: false
    }
  )

  return diffPixels > DIFF_PIXEL_FLOOR ? 'changed' : 'unchanged'
}

// Read-only visibility, not cleanup — an automated sweep here would need to
// tell "scenario renamed" apart from "scenario deleted" to avoid silently
// discarding a still-relevant baseline, which isn't cheaply guaranteable.
// Report and let a human decide.
async function findOrphanBaselines(producedNames) {
  let existing
  try {
    existing = await readdir(BASELINE_DIR)
  } catch {
    return []
  }
  return existing.filter((file) => !producedNames.has(file))
}

async function resizeWindow(app, width, height) {
  await evaluateMainProcess(
    app,
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

async function captureAll(app, window, outDir, activeScenarios, scoped) {
  const written = []
  const skipped = []
  const defects = { consoleErrors: [], pageErrors: [], overflow: [] }
  const diff = { new: [], changed: [], unchanged: [] }
  registerDefectListeners(window, defects)

  const sizes = await getWindowSizes(app)
  const producedNames = new Set()

  for (const scenario of activeScenarios) {
    for (const size of sizes) {
      // Reload back to the default baseline before every (scenario, size) pair
      // — scenarios describe "how to get from default to the state I want",
      // not a chain that depends on execution order. See scenarios.mjs.
      // Section and theme are persisted (electron-store) and survive the reload,
      // so a scenario that ends on the Plugins section or flips the theme would
      // otherwise poison every scenario after it — reset both before reloading.
      await window.evaluate(async () => {
        await window.api.setLastSection('skills')
        await window.api.setTheme('system')
      })
      await window.reload()
      await waitForSettle(window)
      await resizeWindow(app, size.width, size.height)
      const name = `${scenario.name}--${size.label}.png`
      const skipReason = await scenario.shouldSkip?.(window)
      if (skipReason) {
        console.log(`[visual-verify]   skipping ${name}: ${skipReason}`)
        skipped.push({ name, reason: skipReason })
        producedNames.add(name)
        continue
      }
      // _electron opens a real OS window, so CSS :hover responds to the real
      // system cursor's actual screen position — not a virtual one Playwright
      // controls — and that position is whatever it happened to be left at,
      // landing on a different row every run since the window isn't pinned to
      // a fixed screen position (src/main/index.ts doesn't set x/y). Move it
      // off-content before every capture so "nothing hovered" is the actual
      // deterministic baseline; a scenario that wants a hover calls it after.
      await window.mouse.move(0, 0)

      await scenario.run(window)
      await finishTransitions(window)

      console.log(`[visual-verify]   capturing ${name}...`)
      const path = join(outDir, name)
      await window.screenshot({ path })
      written.push(path)
      producedNames.add(name)

      diff[await diffAgainstBaseline(path, name)].push(name)

      if (await hasHorizontalOverflow(window)) {
        defects.overflow.push(name)
      }
    }
  }

  // A scoped run only produces a subset of names, so every unrun scenario's
  // baseline would look "orphaned" — noise at best, a nudge to delete a valid
  // baseline at worst. Orphan detection only means something on a full run.
  const orphanBaselines = scoped ? [] : await findOrphanBaselines(producedNames)

  return { written, skipped, defects, diff, orphanBaselines }
}

/**
 * Bookends the summary on a `--only` run so neither the top nor the tail of the
 * log (where "no overflow or console/page errors detected" lands) can be misread
 * as a clean full audit. `scope` is null on a full run — nothing printed.
 */
function printScopeBanner(scope, { closing } = {}) {
  if (!scope) return
  const { only, activeCount, totalCount, baselineCount } = scope

  if (baselineCount === 0) {
    // Nothing to diff against yet, so the no-baseline rule pulled in everything
    // regardless of --only — say so instead of a misleading "N of N scenarios".
    if (!closing) {
      console.log(
        `[visual-verify] --only ${only.join(',')} given, but no baselines exist yet — captured all ${activeCount} scenarios.`
      )
    }
    return
  }

  if (closing) {
    console.log(
      '[visual-verify] SCOPED RUN — not a full audit. Run `npm run verify:visual` with no --only before the feature is done.'
    )
    return
  }
  console.log(
    `[visual-verify] SCOPED RUN — ${activeCount} of ${totalCount} scenarios · --only ${only.join(',')}`
  )
  console.log(`[visual-verify]   ${totalCount - activeCount} scenarios NOT captured this run`)
}

function printSummary(written, skipped, defects, diff, orphanBaselines, scope) {
  printScopeBanner(scope)
  console.log('[visual-verify] wrote:')
  for (const path of written) console.log(`  ${path}`)

  console.log(
    `[visual-verify] diff vs baseline: ${diff.new.length} new, ${diff.changed.length} changed, ${diff.unchanged.length} unchanged (skip reading these)`
  )
  if (diff.new.length > 0) {
    console.log('[visual-verify] NEW (no baseline yet — review and promote):')
    for (const name of diff.new) console.log(`  ${name}`)
  }
  if (diff.changed.length > 0) {
    console.log('[visual-verify] CHANGED (differs from accepted baseline — review):')
    for (const name of diff.changed) console.log(`  ${name}`)
  }
  if (skipped.length > 0) {
    console.log('[visual-verify] SKIPPED (local data did not provide this state):')
    for (const { name, reason } of skipped) console.log(`  ${name}: ${reason}`)
  }
  if (orphanBaselines.length > 0) {
    console.log(
      '[visual-verify] orphaned baselines (no matching scenario this run — not deleted, just flagged):'
    )
    for (const name of orphanBaselines) console.log(`  ${name}`)
  }

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

  printScopeBanner(scope, { closing: true })
}

async function main() {
  const only = parseOnly(process.argv.slice(2))

  // Never wiped, unlike OUT_DIR below — the persistent "last accepted" cache
  // diffing compares against. Read it now: resolving the scenario set BEFORE the
  // build makes a typo in --only fail in well under a second instead of after a
  // full typecheck + electron-vite build.
  await mkdir(BASELINE_DIR, { recursive: true })
  const baselineNames = await readdir(BASELINE_DIR)
  const active = selectScenarios(scenarios, only, baselineNames)
  const scoped = only !== null && active.length < scenarios.length
  const scope =
    only === null
      ? null
      : {
          only,
          activeCount: active.length,
          totalCount: scenarios.length,
          baselineCount: baselineNames.length
        }

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
      args: visualVerifierLaunchArgs(join(REPO_ROOT, 'out/main/index.js'), userDataDir)
    })

    const window = await app.firstWindow()
    await window.waitForLoadState('load')
    // The hover-glide pill (useGlideHighlight) and the file tree's motion are
    // JS-driven springs, not CSS transitions — finishTransitions() can't snap
    // them, and this backgrounded automation window doesn't pump compositor
    // frames reliably enough for a fixed wait to reliably catch their settled
    // state (confirmed: produced a ~10%-of-frame diff between two identical
    // consecutive runs). Both components already respect prefers-reduced-motion
    // via useReducedMotion() — emulating it here makes them instant instead of
    // guessing at a wait long enough to outlast an unreliable frame rate.
    await window.emulateMedia({ reducedMotion: 'reduce' })

    const { written, skipped, defects, diff, orphanBaselines } = await captureAll(
      app,
      window,
      OUT_DIR,
      active,
      scoped
    )
    printSummary(written, skipped, defects, diff, orphanBaselines, scope)
  } finally {
    await app?.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[visual-verify] failed:', err)
  process.exit(1)
})

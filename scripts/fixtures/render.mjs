// The side-effecting half of the fixture runner: serves the gallery
// (src/renderer/src/fixtures/gallery.tsx) with Vite, drives it in headless Chrome, and renders the
// base commit from a throwaway git worktree. What the results mean is decided in compare.mjs.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadConfigFromFile } from 'electron-vite'
import { chromium } from 'playwright-core'
import { createServer, mergeConfig, normalizePath } from 'vite'
import { shotPath } from './compare.mjs'

export const REPO = join(import.meta.dirname, '../..')
export const OUT = join(REPO, '.fixtures')
const SOURCE = 'src/renderer/src'
const GALLERY = `${SOURCE}/fixtures/gallery.tsx`
export const SHELL = `${SOURCE}/App.tsx`

const THEMES = ['light', 'dark']
// Midday UTC in the middle of a month, so no fixture sits next to a day or month boundary.
const FIXED_TIME = new Date('2026-06-15T12:00:00Z')
// Rasterize with SwiftShader, Chrome's software GL, not the machine's GPU. On a real GPU two
// renders of the same page differed by a level or two at a couple of anti-aliased icon pixels
// (measured 2026-11-12, Chrome 157, Apple GPU: one fixture split 13/27 over 40 renders, even one
// page at a time). Plain software rendering (--disable-gpu) was worse; SwiftShader gave identical
// bytes over every repeat, which is what lets the comparison use no tolerance.
const BROWSER_ARGS = ['--use-angle=swiftshader']
const STEP_TIMEOUT_MS = 5_000
const MOUNT_TIMEOUT_MS = 30_000
const SETTLE_ATTEMPTS = 6

function git(...args) {
  // stderr is captured, not inherited: a failure still carries it in the thrown error.
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function firstLine(error) {
  return String(error?.message ?? error).split('\n')[0]
}

/**
 * Serves the gallery from `tree`, a checkout of this repository. The renderer's plugins come from
 * that tree's own electron.vite.config.ts so they cannot drift from the app's; only the `@` alias
 * is re-rooted, because the config resolves it against the working directory.
 */
export async function startGallery(tree, { live = false, cache = 'vite' } = {}) {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    join(tree, 'electron.vite.config.ts'),
    tree
  )
  const server = await createServer(
    mergeConfig(loaded.config.renderer, {
      configFile: false,
      root: join(tree, 'src/renderer'),
      // Not node_modules/.vite: `npm run dev` owns that one, and two servers must not share it.
      cacheDir: join(OUT, cache),
      logLevel: 'error',
      resolve: { alias: { '@': join(tree, SOURCE) } },
      server: {
        host: '127.0.0.1',
        fs: { allow: [REPO] },
        // A one-shot run renders a snapshot of the source; only `serve` reloads on edits.
        ...(live ? {} : { hmr: false, watch: null })
      }
    })
  )
  await server.listen()
  const { port } = server.httpServer.address()
  return {
    server,
    url: `http://127.0.0.1:${port}/fixtures.html`,
    close: () => server.close()
  }
}

async function launchBrowser() {
  const wanted = process.env.FIXTURES_BROWSER
  const candidates = wanted
    ? [existsSync(wanted) ? { executablePath: wanted } : { channel: wanted }]
    : [{ channel: 'chrome' }, { channel: 'msedge' }, {}]
  const failures = []
  for (const candidate of candidates) {
    try {
      return await chromium.launch({ headless: true, args: BROWSER_ARGS, ...candidate })
    } catch (error) {
      failures.push(firstLine(error))
    }
  }
  throw new Error(
    'No browser could be started. Install Google Chrome or Microsoft Edge, or set ' +
      'FIXTURES_BROWSER to a Chromium executable path or a Playwright channel name.\n' +
      failures.map((failure) => `  ${failure}`).join('\n')
  )
}

/**
 * Installed Chrome, then Edge, then Playwright's own Chromium; FIXTURES_BROWSER overrides.
 * Four instances with one page each was the fastest of the layouts measured on a 10-core Mac
 * (2026-11-12: 96 shots in 30 s; two browsers 40 s, eight 35 s, four with two pages each 41 s).
 * FIXTURES_BROWSERS changes the count for a machine where that does not hold.
 */
export async function launchBrowsers() {
  const count = Number(process.env.FIXTURES_BROWSERS) || 4
  const first = await launchBrowser()
  return [first, ...(await Promise.all(Array.from({ length: count - 1 }, launchBrowser)))]
}

/** The fixtures the gallery found, the window sizes to render at, and files that failed to load. */
export async function readIndex(browser, url) {
  const page = await browser.newPage()
  try {
    await page.goto(url)
    return await page.evaluate(() => window.fixtures)
  } finally {
    await page.close()
  }
}

export function jobsFor(index, ids) {
  const wanted = new Set(ids)
  const sizes = Object.entries(index.sizes).map(([label, size]) => ({ label, ...size }))
  return index.list
    .filter((entry) => wanted.has(entry.id))
    .flatMap((entry) => sizes.flatMap((size) => THEMES.map((theme) => ({ ...entry, size, theme }))))
}

function locate(page, target) {
  const revive = (value) =>
    value && typeof value === 'object' ? new RegExp(value.source, value.flags) : value
  if (target.role !== undefined) {
    return page.getByRole(target.role, { name: revive(target.name), exact: target.exact }).first()
  }
  if (target.text !== undefined) {
    return page.getByText(revive(target.text), { exact: target.exact }).first()
  }
  return page.locator(target.selector).first()
}

function describeTarget(target) {
  return Object.entries(target)
    .map(([key, value]) =>
      value && typeof value === 'object'
        ? `${key} /${value.source}/${value.flags}`
        : `${key} "${value}"`
    )
    .join(', ')
}

// One step of a fixture's `interact`, performed with real input so hover, focus and pointer
// events behave as they do for a person.
async function perform(page, step) {
  try {
    if (step.action === 'press') return await page.keyboard.press(step.key)
    if (step.action === 'type') return await page.keyboard.type(step.text)
    const locator = locate(page, step.target)
    if (step.action === 'until') {
      return await locator.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
    }
    await locator[step.action]({ timeout: STEP_TIMEOUT_MS })
  } catch (error) {
    if (step.action === 'until') throw new Error(step.message)
    const what = step.target ? describeTarget(step.target) : (step.key ?? step.text)
    throw new Error(`Could not ${step.action} ${what}: ${firstLine(error)}`)
  }
}

// Runs in the page. Resolves once fonts have loaded and three frames in a row passed with no DOM
// change and no finite animation running. Motion's springs write inline styles every frame, so
// they count as DOM changes; infinite animations (a spinner) never finish and are ignored here,
// then reset to their first frame by the screenshot itself.
async function settle() {
  await document.fonts.ready
  let changed = false
  const observer = new MutationObserver(() => {
    changed = true
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  })
  const deadline = performance.now() + 5_000
  for (let quiet = 0; quiet < 3 && performance.now() < deadline;) {
    await new Promise(requestAnimationFrame)
    const moving = document
      .getAnimations()
      .some(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
      )
    quiet = changed || moving ? 0 : quiet + 1
    changed = false
  }
  observer.disconnect()
}

// A screenshot counts once the one after it is identical: finishing an animation can itself
// change the page (a tooltip that unmounts when its exit ends), and a render that keeps changing
// would otherwise show up later as a false "changed".
async function stableShot(page) {
  let previous = null
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    await page.evaluate(settle)
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' })
    if (previous?.equals(shot)) return { shot, stable: true }
    previous = shot
  }
  return { shot: previous, stable: false }
}

function overflows() {
  const page = document.documentElement
  const frame = document.querySelector('[data-fixture-frame]')
  return (
    page.scrollWidth > page.clientWidth || (frame !== null && frame.scrollWidth > frame.clientWidth)
  )
}

async function renderOne(browser, url, job, dir) {
  const errors = new Set()
  let file = null
  // A context per shot: nothing a fixture stores or caches can reach the next one.
  const context = await browser.newContext({
    viewport: { width: job.size.width, height: job.size.height },
    deviceScaleFactor: 1,
    colorScheme: job.theme,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    locale: 'en-US'
  })
  try {
    const page = await context.newPage()
    await page.clock.setFixedTime(FIXED_TIME)
    page.on('console', (message) => {
      if (message.type() === 'error') errors.add(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.add(`page error: ${error.message}`))
    // The console reports a failed request without saying which one.
    page.on('response', (response) => {
      if (response.status() >= 400) errors.add(`${response.status()} ${response.url()}`)
    })
    await page.exposeBinding('fixtureInput', (source, step) => perform(source.page, step))

    const query = new URLSearchParams({ id: job.id, theme: job.theme })
    if (job.platform) query.set('platform', job.platform)
    await page.goto(`${url}?${query}`)
    let timer
    await Promise.race([
      page.evaluate(() => window.mounted),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The fixture did not finish mounting within 30 s.')),
          MOUNT_TIMEOUT_MS
        )
      })
    ]).finally(() => clearTimeout(timer))

    const { shot, stable } = await stableShot(page)
    if (!stable) {
      errors.add('The render never settled: two screenshots in a row kept differing.')
    }
    for (const message of await page.evaluate(() => window.fixtureErrors)) errors.add(message)
    if (await page.evaluate(overflows)) {
      errors.add('Horizontal overflow: the content is wider than the space it is given.')
    }
    file = join(dir, shotPath(job.id, job.size.label, job.theme))
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, shot)
  } catch (error) {
    errors.add(firstLine(error))
  } finally {
    await context.close()
  }
  return { ...job, variant: `${job.size.label}-${job.theme}`, file, errors: [...errors] }
}

/** Renders every job to `dir`, one page at a time per browser. Results come back in job order. */
export async function renderShots(browsers, url, jobs, dir) {
  const results = new Array(jobs.length)
  let next = 0
  await Promise.all(
    browsers.map(async (browser) => {
      while (next < jobs.length) {
        const index = next
        next += 1
        results[index] = await renderOne(browser, url, jobs[index], dir)
      }
    })
  )
  return results
}

function sourceFiles(tree) {
  return readdirSync(join(tree, SOURCE), { recursive: true }).map(
    (file) => `${SOURCE}/${normalizePath(file)}`
  )
}

/**
 * Which files each file imports, from Vite's own module graph, as paths relative to the tree.
 * Walked by transforming every module a fixture can reach, so it does not depend on what a
 * browser happened to request. Type-only imports are already gone at this point.
 *
 * Every fixture also gets an edge to the gallery, which stands for what all fixtures share (the
 * stylesheet, the fake API): an edit there can change any of them.
 */
export async function importGraph(server, tree) {
  const environment = server.environments.client
  const root = `${normalizePath(tree)}/`
  const files = sourceFiles(tree)
  const fixtures = files.filter((file) => file.endsWith('.fixture.tsx'))
  const graph = new Map()

  async function walk(file) {
    if (graph.has(file)) return
    const imports = []
    graph.set(file, imports)
    // A stylesheet's graph entry lists every file Tailwind scanned for class names, not imports.
    if (!/\.tsx?$/.test(file)) return
    await environment.transformRequest(`/@fs/${root}${file}`)
    const node = [...(environment.moduleGraph.getModulesByFile(`${root}${file}`) ?? [])][0]
    for (const imported of node?.importedModules ?? []) {
      const path = imported.file
      if (!path?.startsWith(root) || path.includes('/node_modules/')) continue
      const relative = path.slice(root.length)
      // The gallery reaches every fixture and the whole app; neither is something fixtures share.
      if (file === GALLERY && (relative === SHELL || relative.endsWith('.fixture.tsx'))) continue
      imports.push(relative)
    }
    for (const imported of imports) await walk(imported)
  }

  await walk(GALLERY)
  for (const fixture of fixtures) {
    await walk(fixture)
    graph.get(fixture).push(GALLERY)
  }
  return {
    graph,
    fixtures,
    // What must have a fixture: every component file except the vendored shadcn ones, which are
    // library code, and the gallery's own files.
    components: files.filter(
      (file) =>
        file.endsWith('.tsx') &&
        !file.endsWith('.fixture.tsx') &&
        !file.startsWith(`${SOURCE}/fixtures/`) &&
        !file.startsWith(`${SOURCE}/components/ui/`) &&
        file !== `${SOURCE}/main.tsx`
    )
  }
}

/** The merge-base with main, so uncommitted work on main compares against HEAD. */
export function defaultBase() {
  for (const branch of ['main', 'origin/main']) {
    try {
      return git('merge-base', 'HEAD', branch)
    } catch {
      // No such branch in this clone; try the next.
    }
  }
  return git('rev-parse', 'HEAD')
}

/**
 * Product source files that differ from the base commit, including files git does not track yet.
 * Fixture files are left out by the caller; the gallery's own files are left out here, because an
 * edit to the tooling is not an edit anyone expects to see in a screenshot.
 */
export function editedFiles(sha) {
  const files = [
    ...git('diff', '--name-only', sha, '--', 'src').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard', '--', 'src').split('\n')
  ]
  return [...new Set(files)].filter((file) => file && !file.startsWith(`${SOURCE}/fixtures/`))
}

async function removeWorktree(tree) {
  try {
    git('worktree', 'remove', '--force', tree)
  } catch {
    // Not registered: either never created or already removed.
  }
  await rm(tree, { recursive: true, force: true })
  git('worktree', 'prune')
}

// Keeps the base render just used and the one used before it (enough to move between two
// branches without re-rendering); every older one is deleted, or the cache grows by one full set
// of screenshots per commit ever compared against.
async function pruneBaseCache(current) {
  const now = new Date()
  await utimes(current, now, now)
  const root = dirname(current)
  const byLastUse = readdirSync(root)
    .map((name) => join(root, name))
    .sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs)
  for (const stale of byLastUse.slice(2)) await rm(stale, { recursive: true, force: true })
}

/**
 * Makes sure the base commit's render of every job exists, and returns where. Shots are cached
 * under a key of everything that can change them: the commit, the browser version, this runner,
 * and the installed dependencies. The commit is checked out into a worktree inside the repository
 * so its imports resolve to this checkout's node_modules, and the worktree is removed afterwards.
 */
export async function renderBase(browsers, ref, jobs) {
  const sha = git('rev-parse', `${ref}^{commit}`)
  const fingerprint = createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .update(readFileSync(join(REPO, 'package-lock.json')))
    .digest('hex')
    .slice(0, 8)
  const dir = join(OUT, 'base', `${sha.slice(0, 12)}-${browsers[0].version()}-${fingerprint}`)
  const listPath = join(dir, 'fixtures.json')
  let ids = existsSync(listPath) ? JSON.parse(await readFile(listPath, 'utf8')) : null
  const missing = () =>
    jobs.filter(
      (job) =>
        ids.includes(job.id) && !existsSync(join(dir, shotPath(job.id, job.size.label, job.theme)))
    )

  if (ids === null || missing().length > 0) {
    const tree = join(OUT, 'worktree')
    await removeWorktree(tree)
    git('worktree', 'add', '--detach', tree, sha)
    try {
      // A base from before the gallery existed has nothing to compare against.
      if (!existsSync(join(tree, 'src/renderer/fixtures.html'))) {
        ids = []
      } else {
        const gallery = await startGallery(tree, { cache: 'vite-base' })
        try {
          ids = (await readIndex(browsers[0], gallery.url)).list.map((entry) => entry.id)
          await renderShots(browsers, gallery.url, missing(), dir)
        } finally {
          await gallery.close()
        }
      }
      await mkdir(dir, { recursive: true })
      await writeFile(listPath, JSON.stringify(ids))
    } finally {
      await removeWorktree(tree)
    }
  }
  await pruneBaseCache(dir)
  return { sha, dir, ids: new Set(ids) }
}

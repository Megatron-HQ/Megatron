// npm run fixtures -- <mode>. See .claude/skills/visual-verify/SKILL.md for when to use which.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import {
  compareShots,
  coverageProblems,
  formatErrors,
  formatReport,
  selectFixtures,
  shotPath,
  unseenEdits
} from './compare.mjs'
import {
  OUT,
  REPO,
  SHELL,
  defaultBase,
  editedFiles,
  importGraph,
  jobsFor,
  launchBrowsers,
  readIndex,
  renderBase,
  renderShots,
  startGallery
} from './render.mjs'

const USAGE = `Usage: npm run fixtures -- <mode>

  list [filter]                 Print fixture ids.
  shot [filter]                 Screenshot matching fixtures to .fixtures/shots/.
  check [filter] [--base ref]   Render everything, compare with the base commit, and report
                                errors, uncovered components, changed and new fixtures.
  serve                         Keep the gallery running and print its URL.

A filter is any part of a fixture id, for example "SkillInventory" or "App/LoadError".`

const repoPath = (file) => relative(REPO, file).replaceAll('\\', '/')
const fixtureFile = (id) => `src/renderer/src/${id.slice(0, id.lastIndexOf('/'))}.fixture.tsx`

async function check(browsers, gallery, rendered, errors, full, baseRef) {
  const base = await renderBase(browsers, baseRef ?? defaultBase(), rendered)
  await rm(join(OUT, 'diff'), { recursive: true, force: true })
  const shots = []
  for (const shot of rendered) {
    if (!shot.file) continue
    const name = shotPath(shot.id, shot.size.label, shot.theme)
    const before = join(base.dir, name)
    if (!base.ids.has(shot.id) || !existsSync(before)) {
      shots.push({ ...shot, status: 'new', path: repoPath(shot.file) })
      continue
    }
    const difference = compareShots(await readFile(before), await readFile(shot.file))
    if (!difference) {
      shots.push({ ...shot, status: 'same' })
      continue
    }
    const composite = join(OUT, 'diff', name)
    await mkdir(dirname(composite), { recursive: true })
    await writeFile(composite, difference.composite)
    shots.push({ ...shot, ...difference, status: 'changed', composite: repoPath(composite) })
  }

  // Coverage and unseen edits are statements about every fixture, so a filtered run cannot make them.
  let coverage = { uncovered: [], stale: [] }
  let unseen = []
  if (full) {
    const { graph, fixtures, components } = await importGraph(gallery.server, REPO)
    const pending = JSON.parse(await readFile(join(import.meta.dirname, 'pending.json'), 'utf8'))
    coverage = coverageProblems({ graph, fixtures, components, pending, shell: SHELL })
    const moved = [...shots.filter((shot) => shot.status !== 'same'), ...errors]
    unseen = unseenEdits({
      graph,
      fixtures,
      edited: editedFiles(base.sha),
      changed: moved.map((entry) => fixtureFile(entry.id))
    })
  }
  const report = formatReport({
    fixtures: new Set(rendered.map((shot) => shot.id)).size,
    shots,
    errors,
    ...coverage,
    unseen
  })
  console.log(`Compared with ${base.sha.slice(0, 7)}.`)
  console.log(report.text)
  if (!full) {
    console.log(
      'Filtered run: components without a fixture and edits with no visible change were not ' +
        'checked. Finish with `npm run fixtures -- check`.'
    )
  }
  return report.failed
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { base: { type: 'string' } }
  })
  const [mode, filter] = positionals

  if (mode === 'serve') {
    const gallery = await startGallery(REPO, { live: true })
    console.log(gallery.url)
    return
  }
  if (!['list', 'shot', 'check'].includes(mode)) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  const started = performance.now()
  const browsers = await launchBrowsers()
  const gallery = await startGallery(REPO)
  try {
    const index = await readIndex(browsers[0], gallery.url)
    const errors = index.failed.map(({ file, message }) => ({ id: file, variant: 'load', message }))
    const ids = selectFixtures(
      index.list.map((entry) => entry.id),
      filter
    )
    if (mode === 'list') {
      console.log([...ids, ...formatErrors(errors)].join('\n'))
      process.exitCode = errors.length > 0 ? 1 : 0
      return
    }
    if (ids.length === 0 && errors.length === 0) {
      console.error(filter ? `No fixture id contains "${filter}".` : 'There are no fixtures.')
      process.exitCode = 1
      return
    }

    const shotsDir = join(OUT, 'shots')
    if (!filter) await rm(shotsDir, { recursive: true, force: true })
    const rendered = await renderShots(browsers, gallery.url, jobsFor(index, ids), shotsDir)
    for (const shot of rendered) {
      for (const message of shot.errors)
        errors.push({ id: shot.id, variant: shot.variant, message })
    }

    let failed = errors.length > 0
    if (mode === 'shot') {
      const paths = rendered.filter((shot) => shot.file).map((shot) => repoPath(shot.file))
      console.log([...paths, ...formatErrors(errors)].join('\n'))
    } else {
      failed = await check(browsers, gallery, rendered, errors, !filter, values.base)
    }
    console.log(`${((performance.now() - started) / 1000).toFixed(1)} s`)
    process.exitCode = failed ? 1 : 0
  } finally {
    await gallery.close()
    await Promise.all(browsers.map((browser) => browser.close()))
  }
}

await main()

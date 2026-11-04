import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `npm audit` has no way to accept a single advisory, so a fix-less advisory in dev tooling would
// otherwise force the whole gate down to `high` and hide future moderate issues in runtime deps.
// Every entry here is an advisory with no fixed version reachable from our dependency tree.
export const ACCEPTED = {
  // ponytail: fixed only in minimatch 11.x, which no consumer accepts yet (ESLint 9 and 10,
  // typescript-eslint, eslint-plugin-react, and electron-builder via glob/dir-compare/filelist).
  // Only lint/build tooling matches trusted repo globs, and the bug needs optimizationLevel >= 2.
  // Delete this entry once the script warns that the advisory is no longer reported.
  'GHSA-g3hv-75wg-m249': 'minimatch globparts amplification; no fix reachable from dev tooling'
}

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical']
const advisoryId = (url) => url.slice(url.lastIndexOf('/') + 1)

// String `via` entries name another vulnerable package whose own advisory is already listed.
const advisoriesIn = (report) =>
  Object.values(report.vulnerabilities).flatMap(({ via }) =>
    via.filter((source) => typeof source !== 'string')
  )

export function blockingAdvisories(report, accepted = ACCEPTED) {
  if (!report?.vulnerabilities)
    throw new Error(
      `npm did not return an audit report: ${JSON.stringify(report?.error ?? report)}`
    )
  const blocking = new Map()
  for (const source of advisoriesIn(report)) {
    const id = advisoryId(source.url)
    if (id in accepted) continue
    if (SEVERITIES.indexOf(source.severity) < SEVERITIES.indexOf('moderate')) continue
    blocking.set(id, `${source.name} (${source.severity}) ${id}: ${source.title}`)
  }
  return [...blocking.values()]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // npm's own CLI script, run under this Node, avoids needing a shell for npm.cmd on Windows.
  if (!process.env.npm_execpath) throw new Error('Run this through npm: npm run audit:deps')
  const { stdout } = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  const report = JSON.parse(stdout)
  const blocking = blockingAdvisories(report)

  const reported = new Set(advisoriesIn(report).map((source) => advisoryId(source.url)))
  for (const id of Object.keys(ACCEPTED))
    console.log(
      reported.has(id)
        ? `Accepted: ${id} (${ACCEPTED[id]})`
        : `Warning: ${id} is no longer reported; remove it from ACCEPTED in scripts/audit.mjs`
    )

  for (const line of blocking) console.error(`Blocking: ${line}`)
  console.log(`${blocking.length} blocking advisories at moderate or above`)
  process.exitCode = blocking.length > 0 ? 1 : 0
}

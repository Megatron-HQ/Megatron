import type Database from 'better-sqlite3'
import type { ScanSourceSummary, SkillRow } from '../../shared/ipc'
import { isWithinProjectPath } from '../../shared/project-path'
import { historyCoverage } from './usage-history-queries'

export const STALE_WINDOW_DAYS = 30

// Both the invocations (transcripts) and the opportunity evidence (archived prompts) must come
// from this launch's own completed scan; an index left over from a previous launch is not trusted.
export function usageDataTrusted(
  latest: ReadonlyMap<string, ScanSourceSummary['status']>
): boolean {
  return latest.get('scanTranscripts') === 'complete' && latest.get('archivePrompts') === 'complete'
}

export function recordPluginSkillSightings(
  index: Database.Database,
  archive: Database.Database,
  now: Date = new Date()
): void {
  const skills = index
    .prepare(
      "SELECT plugin_name, name FROM skills WHERE source_type = 'plugin' AND plugin_name IS NOT NULL"
    )
    .all() as { plugin_name: string; name: string }[]
  const insert = archive.prepare('INSERT OR IGNORE INTO history_plugin_skills VALUES (?, ?, ?)')
  archive.transaction(() => {
    for (const skill of skills) insert.run(skill.plugin_name, skill.name, now.toISOString())
  })()
}

const DAY_MS = 24 * 60 * 60 * 1000

export function findStaleSkillIds(
  index: Database.Database,
  archive: Database.Database,
  skills: SkillRow[]
): Set<number> {
  const stale = new Set<number>()
  const ranges = archive
    .prepare('SELECT start_at, end_at FROM history_coverage ORDER BY start_at')
    .all() as { start_at: string; end_at: string }[]
  if (ranges.length === 0) return stale
  // Anchored to the last prompt observation, not the wall clock, so an app left open for days
  // between scans never ages a skill past what the data itself has seen.
  const asOf = new Date(Math.max(...ranges.map((range) => Date.parse(range.end_at))))
  const windowStart = new Date(asOf.getTime() - STALE_WINDOW_DAYS * DAY_MS)
  if (historyCoverage(windowStart, asOf, ranges, asOf) !== 'available') return stale
  // Transcripts are the only invocation source and Claude Code prunes them, so a typed prompt
  // whose session has no transcript means invocations may be missing. Bare slash commands never
  // write a transcript, so they prove nothing either way.
  const windowSessions = archive
    .prepare(
      'SELECT DISTINCT session_id FROM history_prompts WHERE is_slash_command = 0 AND typed_at >= ?'
    )
    .pluck()
    .all(windowStart.toISOString()) as string[]
  const transcript = index.prepare('SELECT 1 FROM sessions_meta WHERE session_id = ?').pluck()
  if (windowSessions.some((session) => transcript.get(session) === undefined)) return stale
  const createdAt = new Map(
    (index.prepare('SELECT id, created_at FROM skills').all() as SkillBirth[]).map((row) => [
      row.id,
      row.created_at
    ])
  )
  const projects = archive
    .prepare(
      `SELECT project, MIN(typed_at) AS first, MAX(typed_at) AS last
      FROM history_prompts WHERE is_slash_command = 0 GROUP BY project`
    )
    .all() as ProjectActivity[]
  const windowStartAt = windowStart.toISOString()
  // A scope only gives a signal when it was in use on both sides of the window start: an idle
  // repo or an idle month had no chance to run the skill, and a brand-new repo has no history.
  const hadOpportunity = (roots: string[] | 'everywhere'): boolean => {
    const active =
      roots === 'everywhere'
        ? projects
        : projects.filter((row) => roots.some((root) => isWithinProjectPath(row.project, root)))
    return (
      active.some((row) => row.first < windowStartAt) &&
      active.some((row) => row.last >= windowStartAt)
    )
  }
  const installs = index
    .prepare(
      `SELECT name || '@' || marketplace AS plugin, scope, project_path, installed_at
      FROM plugin_registry`
    )
    .all() as PluginInstallRow[]
  const firstSeen = new Map(
    (
      archive
        .prepare('SELECT plugin_name, skill_name, first_seen_at FROM history_plugin_skills')
        .all() as PluginSighting[]
    ).map((row) => [`${row.plugin_name}\0${row.skill_name}`, row.first_seen_at])
  )
  const start = windowStart.getTime()
  for (const skill of skills) {
    // Power and the shadow warning already explain why these never run.
    if (skill.disabled_reason !== null || skill.shadowed_by_skill_id !== null) continue
    let existedSince: number | null
    let roots: string[] | 'everywhere'
    if (skill.source_type === 'plugin') {
      const own = installs.filter((install) => install.plugin === skill.plugin_name)
      const seenAt = timeOf(firstSeen.get(`${skill.plugin_name}\0${skill.name}`))
      const installedAt = own
        .map((install) => timeOf(install.installed_at))
        .filter((time): time is number => time !== null)
      // The first sighting catches a skill that an update added (installedAt survives updates);
      // installedAt catches an uninstall and reinstall after that sighting.
      existedSince =
        seenAt === null
          ? null
          : Math.max(seenAt, ...(installedAt.length > 0 ? [Math.min(...installedAt)] : []))
      roots = own.some((install) => install.scope === 'user')
        ? 'everywhere'
        : own.map((install) => install.project_path).filter((path) => path !== '')
    } else {
      existedSince = timeOf(createdAt.get(skill.id))
      roots =
        skill.source_type === 'global'
          ? 'everywhere'
          : skill.project_root === null
            ? []
            : [skill.project_root]
    }
    if (existedSince === null || existedSince >= start) continue
    if (!hadOpportunity(roots)) continue
    if (skill.last_invoked_at === null || Date.parse(skill.last_invoked_at) < start)
      stale.add(skill.id)
  }
  return stale
}

interface PluginInstallRow {
  plugin: string
  scope: 'user' | 'project' | 'local'
  // '' for a user-scope install (see plugin_registry in schema.sql).
  project_path: string
  installed_at: string | null
}

interface PluginSighting {
  plugin_name: string
  skill_name: string
  first_seen_at: string
}

interface ProjectActivity {
  project: string
  first: string
  last: string
}

interface SkillBirth {
  id: number
  created_at: string | null
}

// Node reports a birthtime of 0 when the filesystem records none, so the epoch is as
// unknown as a missing or unparseable value.
function timeOf(value: string | null | undefined): number | null {
  const time = Date.parse(value ?? '')
  return time > 0 ? time : null
}

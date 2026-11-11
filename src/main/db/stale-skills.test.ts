import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScanSourceSummary } from '../../shared/ipc'
import { listSkills } from './queries'
import { applySchema } from './schema'
import { findStaleSkillIds, recordPluginSkillSightings, usageDataTrusted } from './stale-skills'
import { openUsageArchive } from './usage-archive'

// The window is anchored to the archive's last observation, so every literal below is relative
// to AS_OF (the latest history_coverage end), never to the wall clock.
const AS_OF = '2026-11-11T00:00:00.000Z'
const WINDOW_START = '2026-10-12T00:00:00.000Z'
const OLD = '2026-08-01T00:00:00.000Z'
const BEFORE = '2026-09-01T00:00:00.000Z'
const YOUNG = '2026-10-20T00:00:00.000Z'
const DURING = '2026-11-01T00:00:00.000Z'

let index: Database.Database
let archive: Database.Database
let nextId = 0

beforeEach(() => {
  index = new Database(':memory:')
  applySchema(index)
  archive = openUsageArchive(':memory:')
})
afterEach(() => {
  index.close()
  archive.close()
})

function addSkill(skill: {
  name: string
  source_type?: 'global' | 'project' | 'plugin'
  created_at?: string | null
  project_root?: string
  plugin_name?: string
  disabled_reason?: string
}): void {
  index
    .prepare(
      `INSERT INTO skills
        (name, source_type, source_path, plugin_name, project_root, created_at, disabled_reason, last_scanned_at)
      VALUES (@name, @source_type, @source_path, @plugin_name, @project_root, @created_at, @disabled_reason, @last_scanned_at)`
    )
    .run({
      name: skill.name,
      source_type: skill.source_type ?? 'global',
      source_path: `/skills/${nextId++}`,
      plugin_name: skill.plugin_name ?? null,
      project_root: skill.project_root ?? null,
      created_at: skill.created_at === undefined ? OLD : skill.created_at,
      disabled_reason: skill.disabled_reason ?? null,
      last_scanned_at: AS_OF
    })
}

function addPluginSkill(plugin: string, skill: string): void {
  addSkill({
    name: `${plugin.split('@')[0]}:${skill}`,
    source_type: 'plugin',
    plugin_name: plugin,
    created_at: null
  })
}

function addSession(id: string, cwd: string): void {
  index
    .prepare(
      `INSERT OR IGNORE INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms)
      VALUES (?, ?, ?, 1, 0)`
    )
    .run(id, cwd, BEFORE)
}

function invoke(skill: string, at: string, cwd = '/repo'): void {
  const session = `invocation-${nextId++}`
  addSession(session, cwd)
  index
    .prepare(
      `INSERT INTO skill_invocations (source_uuid, session_id, skill_name, invoked_at, trigger_type)
      VALUES (?, ?, ?, ?, 'user_invoked')`
    )
    .run(`uuid-${nextId++}`, session, skill, at)
}

function prompt(
  project: string,
  at: string,
  { slash = false, transcript = true }: { slash?: boolean; transcript?: boolean } = {}
): void {
  const session = `prompt-${nextId++}`
  archive
    .prepare('INSERT INTO history_prompts VALUES (?, ?, ?, ?, 1)')
    .run(session, project, at, +slash)
  if (transcript) addSession(session, project)
}

function cover(start: string, end: string): void {
  archive.prepare('INSERT INTO history_coverage VALUES (?, ?)').run(start, end)
}

function activeHistory(project = '/repo'): void {
  cover('2026-07-01T00:00:00.000Z', AS_OF)
  prompt(project, BEFORE)
  prompt(project, DURING)
}

function install(
  plugin: string,
  {
    scope = 'user',
    installed_at = OLD,
    project_path = ''
  }: { scope?: string; installed_at?: string | null; project_path?: string } = {}
): void {
  const [name, marketplace] = plugin.split('@')
  index
    .prepare(
      `INSERT INTO plugin_registry
        (name, marketplace, installed_version, scope, install_path, last_scanned_at, installed_at, project_path)
      VALUES (?, ?, '1.0.0', ?, ?, ?, ?, ?)`
    )
    .run(name, marketplace, scope, `/cache/${nextId++}`, AS_OF, installed_at, project_path)
}

function seen(plugin: string, skill: string, at: string): void {
  archive
    .prepare('INSERT INTO history_plugin_skills VALUES (?, ?, ?)')
    .run(plugin, `${plugin.split('@')[0]}:${skill}`, at)
}

function staleSkills(): string[] {
  const skills = listSkills(index)
  const ids = findStaleSkillIds(index, archive, skills)
  return skills
    .filter((skill) => ids.has(skill.id))
    .map((skill) => `${skill.source_type}/${skill.name}`)
    .sort()
}

describe('recordPluginSkillSightings', () => {
  function sightings(): unknown[] {
    return archive
      .prepare(
        'SELECT plugin_name, skill_name, first_seen_at FROM history_plugin_skills ORDER BY skill_name'
      )
      .all()
  }

  it('records each plugin skill once under its plugin identity at scan time', () => {
    // Two cached versions of one plugin give the same skill two index rows.
    addPluginSkill('tools@market', 'lint')
    addPluginSkill('tools@market', 'lint')
    addPluginSkill('tools@market', 'format')
    recordPluginSkillSightings(index, archive, new Date(DURING))
    expect(sightings()).toEqual([
      { plugin_name: 'tools@market', skill_name: 'tools:format', first_seen_at: DURING },
      { plugin_name: 'tools@market', skill_name: 'tools:lint', first_seen_at: DURING }
    ])
  })

  it('keeps the earliest sighting when a later scan sees the skill again', () => {
    addPluginSkill('tools@market', 'lint')
    recordPluginSkillSightings(index, archive, new Date(BEFORE))
    recordPluginSkillSightings(index, archive, new Date(DURING))
    expect(sightings()).toEqual([
      { plugin_name: 'tools@market', skill_name: 'tools:lint', first_seen_at: BEFORE }
    ])
  })

  it('ignores global and project skills', () => {
    addSkill({ name: 'lint' })
    addSkill({ name: 'lint', source_type: 'project', project_root: '/repo' })
    recordPluginSkillSightings(index, archive, new Date(DURING))
    expect(sightings()).toEqual([])
  })
})

describe('usageDataTrusted', () => {
  it.each<[string, [string, ScanSourceSummary['status']][], boolean]>([
    ['false before any usage scan reports', [], false],
    ['false when only transcripts have reported', [['scanTranscripts', 'complete']], false],
    [
      'false when the prompt archive is partial',
      [
        ['scanTranscripts', 'complete'],
        ['archivePrompts', 'partial']
      ],
      false
    ],
    [
      'false when the transcript scan failed',
      [
        ['scanTranscripts', 'failed'],
        ['archivePrompts', 'complete']
      ],
      false
    ],
    [
      'true when both sources completed',
      [
        ['scanTranscripts', 'complete'],
        ['archivePrompts', 'complete']
      ],
      true
    ]
  ])('is %s', (_label, statuses, expected) => {
    expect(usageDataTrusted(new Map(statuses))).toBe(expected)
  })
})

describe('findStaleSkillIds', () => {
  it('flags a skill that existed before the window and never ran inside it', () => {
    activeHistory()
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual(['global/old-skill'])
  })

  it('does not flag a skill invoked inside the window', () => {
    activeHistory()
    addSkill({ name: 'old-skill' })
    invoke('old-skill', DURING)
    expect(staleSkills()).toEqual([])
  })

  it('counts an invocation at exactly the window start as inside the window', () => {
    activeHistory()
    addSkill({ name: 'at-start' })
    addSkill({ name: 'just-before' })
    invoke('at-start', WINDOW_START)
    invoke('just-before', '2026-10-11T23:59:59.999Z')
    expect(staleSkills()).toEqual(['global/just-before'])
  })

  it('flags nothing when archived prompt coverage has a gap inside the window', () => {
    cover('2026-07-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z')
    cover('2026-10-25T00:00:00.000Z', AS_OF)
    prompt('/repo', BEFORE)
    prompt('/repo', DURING)
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual([])
  })

  it('flags nothing when no prompt history has been archived', () => {
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual([])
  })

  it('flags nothing when a prompt inside the window belongs to a session without a transcript', () => {
    activeHistory()
    prompt('/repo', '2026-11-02T00:00:00.000Z', { transcript: false })
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual([])
  })

  it('tolerates pruned transcripts for sessions from before the window', () => {
    activeHistory()
    prompt('/repo', '2026-09-15T00:00:00.000Z', { transcript: false })
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual(['global/old-skill'])
  })

  it('ignores a bare slash-command session, which never writes a transcript', () => {
    activeHistory()
    prompt('/repo', '2026-11-02T00:00:00.000Z', { slash: true, transcript: false })
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual(['global/old-skill'])
  })

  it('never flags a disabled or shadowed skill, whose own icon already explains why it is idle', () => {
    activeHistory()
    addSkill({ name: 'old-skill' })
    addSkill({ name: 'switched-off', disabled_reason: 'override' })
    addSkill({ name: 'old-skill', source_type: 'project', project_root: '/repo' })
    expect(staleSkills()).toEqual(['global/old-skill'])
  })

  it('gives no signal for a skill created inside the window or with no usable birthtime', () => {
    activeHistory()
    addSkill({ name: 'old-skill' })
    addSkill({ name: 'young', created_at: YOUNG })
    addSkill({ name: 'unknown', created_at: null })
    // Node reports the epoch when the filesystem records no birthtime.
    addSkill({ name: 'epoch', created_at: '1970-01-01T00:00:00.000Z' })
    addSkill({ name: 'garbled', created_at: 'not a date' })
    expect(staleSkills()).toEqual(['global/old-skill'])
  })

  it("judges a project skill only against its own project's prompts", () => {
    activeHistory('/repo')
    addSkill({ name: 'build', source_type: 'project', project_root: '/repo' })
    addSkill({ name: 'deploy', source_type: 'project', project_root: '/other' })
    expect(staleSkills()).toEqual(['project/build'])
  })

  it('gives no signal for a project idle during the window or new within it', () => {
    activeHistory('/repo')
    prompt('/quiet', BEFORE)
    prompt('/new', DURING)
    addSkill({ name: 'build', source_type: 'project', project_root: '/repo' })
    addSkill({ name: 'quiet-build', source_type: 'project', project_root: '/quiet' })
    addSkill({ name: 'new-build', source_type: 'project', project_root: '/new' })
    expect(staleSkills()).toEqual(['project/build'])
  })

  it('matches Windows project paths regardless of separators and drive-letter case', () => {
    cover('2026-07-01T00:00:00.000Z', AS_OF)
    prompt('c:\\projects\\app\\web', BEFORE)
    prompt('C:/Projects/App', DURING)
    addSkill({ name: 'build', source_type: 'project', project_root: 'C:\\Projects\\App' })
    expect(staleSkills()).toEqual(['project/build'])
  })

  it('gives no signal when the only earlier history is bare slash commands', () => {
    cover('2026-07-01T00:00:00.000Z', AS_OF)
    prompt('/repo', BEFORE, { slash: true })
    prompt('/repo', DURING)
    addSkill({ name: 'old-skill' })
    expect(staleSkills()).toEqual([])
  })

  it('ages a plugin skill from the later of its first sighting and its earliest install', () => {
    activeHistory()
    const cases: [string, string | null, string | null][] = [
      ['settled@m', OLD, OLD],
      // An update that adds a skill keeps the plugin's original installedAt.
      ['added-by-update@m', YOUNG, OLD],
      // A reinstall after the first sighting resets installedAt.
      ['reinstalled@m', OLD, YOUNG],
      ['never-seen@m', null, OLD],
      ['no-install-date@m', OLD, null]
    ]
    for (const [plugin, firstSeen, installedAt] of cases) {
      addPluginSkill(plugin, 'run')
      install(plugin, { installed_at: installedAt })
      if (firstSeen) seen(plugin, 'run', firstSeen)
    }
    addPluginSkill('two-scopes@m', 'run')
    seen('two-scopes@m', 'run', OLD)
    install('two-scopes@m', { installed_at: OLD })
    install('two-scopes@m', { scope: 'project', installed_at: YOUNG, project_path: '/repo' })
    expect(staleSkills()).toEqual([
      'plugin/no-install-date:run',
      'plugin/settled:run',
      'plugin/two-scopes:run'
    ])
  })

  it("judges a repo-scoped plugin only against its install projects' prompts", () => {
    activeHistory('/repo')
    for (const [plugin, scope, project] of [
      ['elsewhere@m', 'project', '/other'],
      ['here@m', 'local', '/repo']
    ]) {
      addPluginSkill(plugin, 'run')
      install(plugin, { scope, project_path: project })
      seen(plugin, 'run', OLD)
    }
    expect(staleSkills()).toEqual(['plugin/here:run'])
  })
})

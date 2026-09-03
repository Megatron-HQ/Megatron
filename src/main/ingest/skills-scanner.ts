import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { dirname, join, relative, resolve, sep } from 'path'
import { writeSkillScan, type SkillScanRow } from '../db/queries'
import {
  allowedExistsSync,
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory
} from '../permissions'
import { readSkillOverrides } from './claude-settings'
import { parseSkillDirectory } from './skill-parser'

// Directory names never worth descending into while hunting for nested `.claude/skills/`
// directories (Claude Code's own monorepo-package feature — docs/skill-scanner.md): the usual
// huge/irrelevant trees, plus `.claude` itself so a skill's own reference/example files (which
// can plausibly contain a fixture SKILL.md) never get mistaken for a real nested package root.
const NESTED_SEARCH_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.claude'
])

// Nested `.claude/skills/` directories below a project's top-level one. The top-level
// `<repoRoot>/.claude/skills` itself is handled separately in defaultSkillRoots() (it must be a
// root even before the repo has ever been scanned, so it can't depend on a real walk finding
// it) — this only looks for further ones nested below repoRoot's own subdirectories.
//
// Unbounded depth (a monorepo's real package nesting isn't predictable), guarded against a
// symlink cycle by tracking visited realpaths — preserves the locked "symlinks are followed"
// decision (docs/skill-scanner.md) while making a cycle a no-op instead of a hang.
export function findNestedSkillsDirs(repoRoot: string): string[] {
  const found: string[] = []
  const visitedRealPaths = new Set<string>()

  function walk(dir: string): void {
    const real = allowedRealpathSync(dir)
    if (real === null || visitedRealPaths.has(real)) return
    visitedRealPaths.add(real)

    const directory = readAllowedDirectory(dir)
    if (directory.status !== 'ok') return

    for (const entryName of directory.entries) {
      if (NESTED_SEARCH_SKIP_DIRS.has(entryName)) continue
      const entryPath = join(dir, entryName)
      if (!allowedStatSync(entryPath)?.isDirectory()) continue

      const skillsDir = join(entryPath, '.claude', 'skills')
      if (allowedExistsSync(skillsDir)) found.push(skillsDir)

      walk(entryPath)
    }
  }

  walk(repoRoot)
  return found
}

export interface SkillRoot {
  dir: string
  sourceType: 'global' | 'project'
  projectRoot?: string
}

export function defaultSkillRoots(): SkillRoot[] {
  const globalRoot: SkillRoot = {
    dir: resolve(homedir(), '.claude', 'skills'),
    sourceType: 'global'
  }
  const projectRoots: SkillRoot[] = getGrantedPaths().flatMap((path) => {
    const topLevel: SkillRoot = {
      dir: join(path, '.claude', 'skills'),
      sourceType: 'project',
      projectRoot: path
    }
    const nested: SkillRoot[] = findNestedSkillsDirs(path).map((dir) => ({
      dir,
      sourceType: 'project',
      projectRoot: path
    }))
    return [topLevel, ...nested]
  })
  return [globalRoot, ...projectRoots]
}

const SYNCED_DIR_NAME = 'synced'

// A skill directory is `<parentDir>/<entryName>`, real iff it has its own SKILL.md.
// Shared by the top-level walk and the one-level-deeper synced/ walk below.
//
// `overrides` is keyed by the skill's own frontmatter name — not the collision-qualified name
// qualifyCollidingNestedSkillNames rewrites afterward.
// ponytail: a nested project skill that both collides (gets qualified) and is individually
// disabled via /skills would be looked up under the wrong key here. Rare double-edge case;
// upgrade by re-keying overrides after qualification if it ever surfaces for real.
function scanSkillEntry(
  parentDir: string,
  entryName: string,
  projectRoot: string | undefined,
  isSynced: boolean,
  overrides: Map<string, string>
): SkillScanRow | null {
  const dirPath = join(parentDir, entryName)
  const skillMdPath = join(dirPath, 'SKILL.md')
  if (!allowedExistsSync(skillMdPath)) return null

  const parsed = parseSkillDirectory(dirPath)
  const stats = allowedStatSync(skillMdPath)
  return {
    name: parsed.name,
    source_path: dirPath,
    plugin_name: null,
    description: parsed.description,
    est_listing_tokens: parsed.est_listing_tokens,
    est_body_tokens: parsed.est_body_tokens,
    project_root: projectRoot ?? null,
    license: parsed.license,
    metadata_json: parsed.metadata_json,
    created_at: stats?.birthtime.toISOString() ?? null,
    modified_at: stats?.mtime.toISOString() ?? null,
    // better-sqlite3 only binds numbers/strings/bigints/buffers/null, not booleans.
    is_synced: isSynced ? 1 : 0,
    disabled_reason: overrides.get(parsed.name) === 'off' ? 'override' : null,
    // ponytail: skillOverrides 'name-only' keeps the name and drops the description — a partial
    // exclusion — but is deliberately still counted toward the budget here (model_invocable = 1).
    // Accounting for it would need a separate name-token estimator; see TODO out-of-scope note.
    model_invocable:
      parsed.disableModelInvocation || overrides.get(parsed.name) === 'user-invocable-only' ? 0 : 1
  }
}

// A nested skill whose bare name collides with another skill in the same repo is invoked
// under Claude Code's own directory-qualified name (e.g. `apps/web:deploy`) — confirmed against
// real transcript data (three headless invocations, see docs/skill-scanner.md), not assumed
// from the docs page: a colliding NESTED skill is recorded under the qualified form, while a
// colliding ROOT-level skill of that name stays bare. Two nested skills at different
// subdirectories colliding with no root-level skill at all follow the same mechanism by
// extrapolation from those three cases, not independently re-verified against a real transcript
// (same category of documented-but-unverified extrapolation as transcript-scanner.ts's
// cascade-attribution note).
//
// `skills.name` has to hold whatever string Claude Code would actually record for that skill,
// since skill_invocations joins on that text with no FK (docs/data-model.md) — this isn't
// cosmetic, it's what keeps a nested skill's usage count from merging into an unrelated
// same-named skill elsewhere in the repo.
function qualifyCollidingNestedSkillNames(rows: SkillScanRow[]): void {
  const rowsByProjectRoot = new Map<string, SkillScanRow[]>()
  for (const row of rows) {
    if (!row.project_root) continue
    const group = rowsByProjectRoot.get(row.project_root) ?? []
    group.push(row)
    rowsByProjectRoot.set(row.project_root, group)
  }

  for (const [projectRoot, group] of rowsByProjectRoot) {
    const countsByName = new Map<string, number>()
    for (const row of group) {
      countsByName.set(row.name, (countsByName.get(row.name) ?? 0) + 1)
    }

    for (const row of group) {
      if ((countsByName.get(row.name) ?? 0) < 2) continue

      // A skill's own `.claude/skills` dir is dirname(source_path); its package dir is one
      // level above that pair. Empty relative path means the top-level `.claude/skills` —
      // that one keeps its bare name even while colliding (confirmed by probe).
      const packageDir = dirname(dirname(dirname(row.source_path)))
      const relFromRoot = relative(projectRoot, packageDir)
      if (relFromRoot === '') continue

      // Always forward-slash, regardless of host OS — this has to match the literal string
      // Claude Code itself records, which is a qualified-name syntax, not a filesystem path.
      row.name = `${relFromRoot.split(sep).join('/')}:${row.name}`
    }
  }
}

// ponytail: a source_type whose root is dropped from `roots` entirely (e.g. a revoked
// project grant) never gets its rows deleted — writeSkillScan is only called for source
// types with at least one root this pass, so an absent root's rows are simply never
// considered. Add eager cleanup-on-revoke if M3's picker needs it.
export function scanSkills(
  db: Database.Database,
  roots: SkillRoot[] = defaultSkillRoots(),
  userSettingsPath?: string
): void {
  const rowsBySourceType = new Map<SkillRoot['sourceType'], SkillScanRow[]>()
  const rootDirsBySourceType = new Map<SkillRoot['sourceType'], string[]>()

  for (const root of roots) {
    const directory = readAllowedDirectory(root.dir)
    if (directory.status === 'unavailable') continue

    // Read once per root, not once per skill. Global roots (no projectRoot) resolve user scope
    // only; a project root gets the full local > project > user merge — see claude-settings.ts.
    const overrides = readSkillOverrides(root.projectRoot, userSettingsPath)

    const rows = rowsBySourceType.get(root.sourceType) ?? []
    rowsBySourceType.set(root.sourceType, rows)
    const rootDirs = rootDirsBySourceType.get(root.sourceType) ?? []
    rootDirs.push(root.dir)
    rootDirsBySourceType.set(root.sourceType, rootDirs)

    for (const entryName of directory.entries) {
      // `synced/` is a reserved folder name (any capitalization) that Claude Code itself
      // never treats as a skill — it's one extra level holding claude.ai-synced skills.
      // See docs/skill-scanner.md.
      if (entryName.toLowerCase() === SYNCED_DIR_NAME) {
        const syncedDir = join(root.dir, entryName)
        const syncedEntries = readAllowedDirectory(syncedDir)
        if (syncedEntries.status === 'unavailable') continue
        // The stale-row reconciliation below matches on a row's immediate parent dir, so
        // synced/ has to be a root in its own right or a deleted synced skill never gets swept.
        rootDirs.push(syncedDir)
        for (const syncedEntryName of syncedEntries.entries) {
          const row = scanSkillEntry(syncedDir, syncedEntryName, root.projectRoot, true, overrides)
          if (row) rows.push(row)
        }
        continue
      }

      const row = scanSkillEntry(root.dir, entryName, root.projectRoot, false, overrides)
      if (row) rows.push(row)
    }
  }

  for (const [sourceType, rootDirs] of rootDirsBySourceType) {
    const rows = rowsBySourceType.get(sourceType) ?? []
    if (sourceType === 'project') qualifyCollidingNestedSkillNames(rows)
    writeSkillScan(db, sourceType, rows, rootDirs)
  }
}

import { basename, dirname, isAbsolute, resolve } from 'path'
import { allowedExistsSync } from '../../permissions'
import type { LintRule, LintFindingInput, SkillLintTarget } from '../types'
import { accessSkillMd } from '../skill-md'

const BUNDLED_DIR_PREFIXES = [
  'scripts/',
  'references/',
  'resources/',
  'examples/',
  'templates/',
  'assets/',
  'bin/',
  'docs/',
  'lib/',
  'tests/',
  'scripts\\',
  'references\\',
  'resources\\',
  'examples\\',
  'templates\\',
  'assets\\',
  'bin\\',
  'docs\\',
  'lib\\',
  'tests\\'
]

const TARGET_REPO_BASENAMES = new Set(['claude.md', 'agents.md', '.claude.md', '.claude.local.md'])

function pluginPackageRoot(sourcePath: string): string | undefined {
  const skillsDir = dirname(sourcePath)
  if (basename(skillsDir) !== 'skills') return undefined
  return dirname(skillsDir)
}

function resolutionRoots(skill: SkillLintTarget): string[] {
  const roots = [skill.source_path]
  if (skill.source_type === 'project' && skill.project_root) {
    roots.push(skill.project_root)
  }
  if (skill.source_type === 'plugin') {
    const pkgRoot = pluginPackageRoot(skill.source_path)
    if (pkgRoot) roots.push(pkgRoot)
  }
  return roots
}

function hasEllipsisSegment(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).some((segment) => segment === '...')
}

function isWellKnownTargetRepoFile(relativePath: string): boolean {
  const base = basename(relativePath)
  return TARGET_REPO_BASENAMES.has(base.toLowerCase())
}

function isInstructionalLine(line: string): boolean {
  return (
    /\bexamples?\b/i.test(line) ||
    /\bwould be helpful\b/i.test(line) ||
    line.includes('→') ||
    line.includes('->') ||
    /^\s*(?:\d+\.|[-*])\s+`[^`]+`\s+for\s+/i.test(line)
  )
}

function parentDirExists(skill: SkillLintTarget, relativePath: string): boolean {
  const parent = dirname(relativePath)
  if (parent === '.' || parent === '') return true
  return resolutionRoots(skill).some((root) => allowedExistsSync(resolve(root, parent)))
}

function isSkillRelativeCandidate(str: string): { isCandidate: boolean; cleanPath: string } {
  let cleaned = str.trim()
  if (!cleaned) return { isCandidate: false, cleanPath: '' }

  // Strip wrapping quotes
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }

  // Handle <skill-dir>/... or <SKILL_DIR>/...
  const skillDirPrefixMatch = cleaned.match(/^<skill[-_]?dir>[/\\](.*)$/i)
  if (skillDirPrefixMatch) {
    cleaned = skillDirPrefixMatch[1].trim()
  }

  // Command invocations wrap a path plus flags in one span (`scripts/foo.py --days N`).
  // The spec's "no spaces" rule is about the path token, not the whole backtick.
  cleaned = cleaned.split(/\s+/)[0] ?? ''
  if (!cleaned) return { isCandidate: false, cleanPath: '' }

  // Trailing slash is a directory mention (often "create this in the target repo"),
  // not a bundled file to resolve inside the skill.
  if (cleaned.endsWith('/') || cleaned.endsWith('\\')) {
    return { isCandidate: false, cleanPath: '' }
  }

  if (hasEllipsisSegment(cleaned) || isWellKnownTargetRepoFile(cleaned)) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Ignore external, absolute, home, or env variable paths
  if (
    cleaned.startsWith('http://') ||
    cleaned.startsWith('https://') ||
    cleaned.startsWith('mailto:') ||
    cleaned.startsWith('#') ||
    cleaned.startsWith('~') ||
    cleaned.startsWith('$') ||
    cleaned.startsWith('/') ||
    cleaned.startsWith('\\') ||
    /^[a-zA-Z]:[/\\]/.test(cleaned)
  ) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Ignore template variables and placeholders (e.g. <YYYY-MM-DD>, {id}, *.ts)
  if (/[<>{}*?$|`'"=]/.test(cleaned)) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Ignore CLI flags (e.g. --out, -run3.md, -p)
  if (cleaned.startsWith('-')) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Ignore standalone file extensions or version strings (e.g. .html, .tsx, 1.0.0, @scope/pkg)
  if (
    cleaned.startsWith('.') &&
    !cleaned.startsWith('./') &&
    !cleaned.startsWith('.\\') &&
    !cleaned.startsWith('../') &&
    !cleaned.startsWith('..\\')
  ) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Ignore MIME types (e.g. application/json, text/plain, image/png)
  if (/^(application|text|image|audio|video|multipart|font|model)\//i.test(cleaned)) {
    return { isCandidate: false, cleanPath: '' }
  }

  // Check if it has an explicit relative indicator (./ or ../)
  if (
    cleaned.startsWith('./') ||
    cleaned.startsWith('.\\') ||
    cleaned.startsWith('../') ||
    cleaned.startsWith('..\\')
  ) {
    return { isCandidate: true, cleanPath: cleaned }
  }

  // Check if it starts with a standard skill bundled asset directory
  for (const prefix of BUNDLED_DIR_PREFIXES) {
    if (cleaned.toLowerCase().startsWith(prefix)) {
      return { isCandidate: true, cleanPath: cleaned }
    }
  }

  return { isCandidate: false, cleanPath: '' }
}

function cleanLinkTarget(rawPath: string): string {
  let cleaned = rawPath.trim()
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  cleaned = cleaned.replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, '').trim()
  if (cleaned.startsWith('<') && cleaned.endsWith('>')) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  const hashIdx = cleaned.indexOf('#')
  if (hashIdx !== -1) {
    cleaned = cleaned.slice(0, hashIdx)
  }
  const queryIdx = cleaned.indexOf('?')
  if (queryIdx !== -1) {
    cleaned = cleaned.slice(0, queryIdx)
  }
  return cleaned.trim()
}

function candidateExists(skill: SkillLintTarget, relativePath: string): boolean {
  return resolutionRoots(skill).some((root) => {
    const resolved = isAbsolute(relativePath) ? relativePath : resolve(root, relativePath)
    return allowedExistsSync(resolved)
  })
}

function shouldSkipMissingPath(
  skill: SkillLintTarget,
  relativePath: string,
  line: string,
  inFence: boolean
): boolean {
  if (inFence || isInstructionalLine(line)) return true
  if (hasEllipsisSegment(relativePath) || isWellKnownTargetRepoFile(relativePath)) return true
  if (!parentDirExists(skill, relativePath)) return true
  return false
}

export const brokenFilePathsRule: LintRule = {
  id: 'broken-file-paths',
  name: 'Broken File Path References',
  run: (skill): LintFindingInput[] => {
    const accessed = accessSkillMd(skill.source_path)
    if (accessed.status !== 'ok') return []
    const content = accessed.content

    const lines = content.split('\n')
    const findings: LintFindingInput[] = []
    const seenPaths = new Set<string>()
    let inFence = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNum = i + 1
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence
        continue
      }

      // 1. Check markdown links [text](path)
      const mdLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g
      let match: RegExpExecArray | null
      while ((match = mdLinkRegex.exec(line)) !== null) {
        const rawTarget = match[1]
        const target = cleanLinkTarget(rawTarget)
        if (
          !target ||
          target.startsWith('http://') ||
          target.startsWith('https://') ||
          target.startsWith('mailto:') ||
          target.startsWith('#') ||
          target.startsWith('~') ||
          target.startsWith('$') ||
          target.startsWith('/') ||
          target.startsWith('\\') ||
          /^[a-zA-Z]:[/\\]/.test(target) ||
          /[<>{}*?$|`'"=]/.test(target)
        ) {
          continue
        }

        if (shouldSkipMissingPath(skill, target, line, inFence)) continue

        const resolved = isAbsolute(target) ? target : resolve(skill.source_path, target)
        if (!candidateExists(skill, target) && !seenPaths.has(target)) {
          seenPaths.add(target)
          findings.push({
            skill_id: skill.id,
            rule_id: 'broken-file-paths',
            severity: 'warning',
            message: `Referenced file "${target}" does not exist on disk`,
            detail: `Link in SKILL.md refers to "${target}" which was not found at ${resolved}`,
            file_path: 'SKILL.md',
            line_number: lineNum
          })
        }
      }

      // 2. Check backtick paths `path/to/file`
      const backtickRegex = /`([^`]+)`/g
      while ((match = backtickRegex.exec(line)) !== null) {
        const candidate = match[1]
        const { isCandidate, cleanPath } = isSkillRelativeCandidate(candidate)
        if (isCandidate && cleanPath && !seenPaths.has(cleanPath)) {
          if (shouldSkipMissingPath(skill, cleanPath, line, inFence)) continue
          const resolved = isAbsolute(cleanPath) ? cleanPath : resolve(skill.source_path, cleanPath)
          if (!candidateExists(skill, cleanPath)) {
            seenPaths.add(cleanPath)
            findings.push({
              skill_id: skill.id,
              rule_id: 'broken-file-paths',
              severity: 'warning',
              message: `Referenced file "${cleanPath}" does not exist on disk`,
              detail: `Backtick reference in SKILL.md refers to "${cleanPath}" which was not found at ${resolved}`,
              file_path: 'SKILL.md',
              line_number: lineNum
            })
          }
        }
      }
    }

    return findings
  }
}

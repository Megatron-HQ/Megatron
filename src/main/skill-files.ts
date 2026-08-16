import { join, relative, sep } from 'path'
import {
  allowedReaddirSync,
  allowedReadFileSync,
  allowedStatSync,
  isPathAllowed
} from './permissions'

const MAX_PREVIEW_BYTES = 256 * 1024

export type FileStatus = 'ok' | 'too_large' | 'unreadable'

export interface SkillFile {
  relativePath: string
  content: string | null
  status: FileStatus
}

export function readSkillFiles(skillDir: string): SkillFile[] {
  if (!isPathAllowed(skillDir)) return []

  const files: SkillFile[] = []
  walk(skillDir, skillDir, files)
  return files.sort(bySkillMdFirstThenAlphabetical)
}

function walk(root: string, dir: string, files: SkillFile[]): void {
  for (const entryName of allowedReaddirSync(dir)) {
    if (entryName.startsWith('.')) continue

    const fullPath = join(dir, entryName)
    const stats = allowedStatSync(fullPath)
    if (stats === null) continue

    if (stats.isDirectory()) {
      walk(root, fullPath, files)
    } else if (stats.isFile()) {
      files.push(readOneFile(root, fullPath, stats.size))
    }
  }
}

function readOneFile(root: string, fullPath: string, size: number): SkillFile {
  const relativePath = relative(root, fullPath).split(sep).join('/')

  if (size > MAX_PREVIEW_BYTES) {
    return { relativePath, content: null, status: 'too_large' }
  }

  const buffer = allowedReadFileSync(fullPath)
  if (buffer === null || buffer.includes(0)) {
    return { relativePath, content: null, status: 'unreadable' }
  }

  return { relativePath, content: buffer.toString('utf8'), status: 'ok' }
}

function bySkillMdFirstThenAlphabetical(a: SkillFile, b: SkillFile): number {
  if (a.relativePath === 'SKILL.md') return -1
  if (b.relativePath === 'SKILL.md') return 1
  return a.relativePath.localeCompare(b.relativePath)
}

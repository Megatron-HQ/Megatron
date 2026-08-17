import { join } from 'path'
import { allowedExistsSync, allowedReadFileSync, isPathAllowed } from '../permissions'

export type SkillMdAccess =
  | { status: 'denied' }
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'ok'; content: string }

export function accessSkillMd(sourcePath: string): SkillMdAccess {
  const skillMdPath = join(sourcePath, 'SKILL.md')
  if (!isPathAllowed(skillMdPath)) return { status: 'denied' }
  if (!allowedExistsSync(skillMdPath)) return { status: 'missing' }
  const buf = allowedReadFileSync(skillMdPath)
  if (buf === null) return { status: 'unreadable' }
  return { status: 'ok', content: buf.toString('utf8') }
}

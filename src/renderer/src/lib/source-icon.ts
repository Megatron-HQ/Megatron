import { Blocks, FolderGit2, Globe } from 'lucide-react'
import type { SourceType } from '../../../shared/ipc'

export const SOURCE_ICON: Record<SourceType, typeof Globe> = {
  global: Globe,
  project: FolderGit2,
  plugin: Blocks
}

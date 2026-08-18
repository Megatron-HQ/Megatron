import { Blocks, Cloud, FolderGit2, Globe } from 'lucide-react'
import type { SourceType } from '../../../shared/ipc'

export const SOURCE_ICON: Record<SourceType, typeof Globe> = {
  global: Globe,
  project: FolderGit2,
  plugin: Blocks
}

// Synced skills stay source_type: 'global' (see docs/skill-scanner.md) so they aren't a
// Record key of their own — SourceBadge picks this over SOURCE_ICON.global when isSynced.
export const SYNCED_ICON = Cloud

import { Bot, GitFork, UserRound } from 'lucide-react'
import type { TriggerType } from '../../../shared/ipc'

// Icon + human label for each invocation trigger type — shared by the Detail page's usage
// legend, the invocation-history rows (InvocationRow), and SkillActivityDialog's trigger filter.
export const TRIGGER_META: Record<TriggerType, { label: string; Icon: typeof UserRound }> = {
  user_invoked: { label: 'Manual', Icon: UserRound },
  autonomous: { label: 'Auto', Icon: Bot },
  subagent: { label: 'Subagent', Icon: GitFork }
}

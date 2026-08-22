import type { SkillRow } from '../../../shared/ipc'

export const HEAVIEST_SKILLS_LIMIT = 5

// Mirrors getContextBudget()'s WHERE source_type IN ('global','plugin') in queries.ts —
// project skills don't count toward the budget, so they're excluded here too.
//
// Sorted unused-first, then heaviest-first within each group — Claude Code strips descriptions
// from its least-used skills before its biggest ones when a listing goes over budget, so a large
// but frequently-used skill is safe while a small, never-used one is the real waste.
//
// A skill with hook_events is excluded outright, even at 0 invocations: its plugin runs via a
// Claude Code hook, not the Skill tool, so "0 uses" doesn't mean dead weight — it means Megatron
// can't see that mechanism. Recommending "disable it, it's unused" would be actively wrong here.
//
// A skill with disabled_reason set is excluded too: it already costs 0 tokens (getContextBudget
// skips it the same way), so "disable this" is advice for something already disabled.
export function heaviestBudgetSkills(
  skills: SkillRow[],
  limit = HEAVIEST_SKILLS_LIMIT
): SkillRow[] {
  return skills
    .filter(
      (skill) =>
        (skill.source_type === 'global' || skill.source_type === 'plugin') &&
        skill.hook_events === null &&
        skill.disabled_reason === null
    )
    .sort((a, b) => {
      const aUnused = a.total_invocations === 0
      const bUnused = b.total_invocations === 0
      if (aUnused !== bUnused) return aUnused ? -1 : 1
      return b.est_listing_tokens - a.est_listing_tokens || a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

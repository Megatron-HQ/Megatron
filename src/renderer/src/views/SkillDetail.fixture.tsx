import { baseSkills, skillMeta } from '@/fixtures/data'
import { fixture, sheet, type Fixture } from '@/fixtures/define'
import { SkillDetail } from './SkillDetail'

const ignore = (): void => {}
const SKILL = baseSkills[0]
const LINK_TARGET = '/Users/fixture/.agents/skills/code-review'

function detail(linkTarget: string | null): Fixture {
  return fixture({
    frame: sheet('skills'),
    api: {
      openSkillMeta: async (id) => {
        const meta = skillMeta(id)
        return meta && { ...meta, linkTarget }
      }
    },
    render: () => (
      <SkillDetail
        skillId={SKILL.id}
        summary={SKILL}
        onBack={ignore}
        onViewFiles={ignore}
        onNavigate={ignore}
      />
    ),
    interact: async (user) => {
      await user.until({ text: SKILL.source_path }, 'The detail page never showed its Path row.')
      if (linkTarget === null) {
        await user.until(
          () => !document.body.textContent?.includes('Links to'),
          'A skill folder that is not a link showed a Links to row.'
        )
      } else {
        await user.until({ text: LINK_TARGET }, 'A linked skill folder showed no Links to row.')
      }
    }
  })
}

export const Plain = detail(null)

// Orca and `npx skills` install skills as links into ~/.agents/skills.
export const Linked = detail(LINK_TARGET)

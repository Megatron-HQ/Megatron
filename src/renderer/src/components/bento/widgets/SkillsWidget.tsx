import { CircleArrow } from '../CircleArrow'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useSkills } from '../../../lib/hooks/useQueries'
import { AVATAR_COLORS, initials } from '../helpers'
import { SkillInventoryList } from './WordmarkWidget'
import { Code2 } from 'lucide-react'

export function SkillsWidget(props: WidgetProps): React.JSX.Element {
  const { data: skills = [] } = useSkills()
  const faces = skills.slice(0, 4)

  return (
    <BentoBlock
      layoutId="skills"
      title="Skill Inventory"
      icon={<Code2 className="size-5 text-navy" />}
      ariaLabel="Open skill inventory"
      cardClassName="bg-teal text-white"
      {...props}
      expandedContent={<SkillInventoryList />}
    >
      <div className="flex h-full flex-col justify-between p-6">
        <div>
          <h3 className="font-display text-[28px] leading-none font-extrabold tracking-tight md:text-[32px]">
            Skill Inventory
          </h3>
          <p className="mt-3 max-w-[42ch] text-sm leading-relaxed font-medium text-white/75">
            Compact, colorful, and scannable — every global, project, and plugin skill Megatron can
            see, without writing anything back to disk.
          </p>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex -space-x-2">
            {faces.map((skill, index) => (
              <span
                key={skill.id}
                title={skill.name}
                className="flex size-9 items-center justify-center rounded-full border-2 border-teal text-[10px] font-bold text-white"
                style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
              >
                {initials(skill.name)}
              </span>
            ))}
            {skills.length === 0 ? (
              <span className="text-xs font-medium text-white/60">No skills indexed yet</span>
            ) : null}
          </div>
          <CircleArrow />
        </div>
      </div>
    </BentoBlock>
  )
}

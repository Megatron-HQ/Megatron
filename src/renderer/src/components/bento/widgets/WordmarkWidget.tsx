import { Code2 } from 'lucide-react'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useSkills } from '../../../lib/hooks/useQueries'
import { AVATAR_COLORS, initials } from '../helpers'
import skillBox from '../../../assets/bento/skill-box.webp'

export function WordmarkWidget(props: WidgetProps): React.JSX.Element {
  return (
    <BentoBlock
      layoutId="wordmark"
      title="Skill Inventory"
      icon={<Code2 className="size-5 text-navy" />}
      ariaLabel="Open skill inventory"
      cardClassName="bg-white text-navy"
      {...props}
      expandedContent={<SkillInventoryList />}
    >
      <div className="flex h-full items-center justify-center gap-1 whitespace-nowrap px-3">
        {['S', 'K', 'I'].map((letter) => (
          <span
            key={letter}
            className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]"
          >
            {letter}
          </span>
        ))}
        <img src={skillBox} alt="" className="mx-0.5 h-10 w-10 object-contain md:h-12 md:w-12" />
        {['L', 'L', 'S'].map((letter, index) => (
          <span
            key={`${letter}-${index}`}
            className="font-display text-[28px] font-extrabold tracking-tight md:text-[34px]"
          >
            {letter}
          </span>
        ))}
      </div>
    </BentoBlock>
  )
}

export function SkillInventoryList(): React.JSX.Element {
  const { data: skills = [] } = useSkills()

  return (
    <div className="mx-auto max-w-4xl space-y-6 text-navy/70">
      <div className="flex items-center justify-between border-b border-navy/10 pb-4">
        <p className="font-display text-lg font-semibold text-navy">All indexed skills</p>
        <span className="rounded-full bg-teal px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase">
          {skills.length} available
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {skills.map((skill, index) => (
          <div
            key={skill.id}
            className="flex h-full flex-col rounded-[20px] border border-navy/10 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                >
                  {initials(skill.name)}
                </span>
                <h4 className="font-bold tracking-tight text-navy">{skill.name}</h4>
              </div>
              <span className="rounded-md border border-navy/10 bg-cream px-2.5 py-1 text-[10px] font-bold tracking-widest text-navy/60 uppercase">
                {skill.source_type}
              </span>
            </div>
            {skill.description ? (
              <p className="flex-1 text-sm leading-relaxed font-medium text-navy/60 line-clamp-2">
                {skill.description}
              </p>
            ) : (
              <p className="flex-1 text-sm text-navy/40 italic">No description</p>
            )}
            <p className="mt-4 truncate border-t border-navy/10 pt-3 font-mono text-[11px] text-navy/40">
              {skill.source_path}
            </p>
          </div>
        ))}
        {skills.length === 0 && (
          <div className="col-span-full p-8 text-center font-medium text-navy/50">
            No skills found.
          </div>
        )}
      </div>
    </div>
  )
}

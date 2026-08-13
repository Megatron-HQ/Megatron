import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useSkills } from '../../../lib/hooks/useQueries'
import sourceBoxes from '../../../assets/bento/source-boxes.webp'
import { Layers } from 'lucide-react'

export function SourceMixWidget(props: WidgetProps): React.JSX.Element {
  const { data: skills = [] } = useSkills()
  const counts = {
    global: skills.filter((skill) => skill.source_type === 'global').length,
    project: skills.filter((skill) => skill.source_type === 'project').length,
    plugin: skills.filter((skill) => skill.source_type === 'plugin').length
  }

  return (
    <BentoBlock
      layoutId="sources"
      title="Skill Sources"
      icon={<Layers className="size-5 text-navy" />}
      ariaLabel="Open skill source breakdown"
      cardClassName="bg-blush"
      {...props}
      expandedContent={
        <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
          {(
            [
              ['Global', counts.global, '~/.claude/skills'],
              ['Project', counts.project, '<repo>/.claude/skills'],
              ['Plugin', counts.plugin, 'installed_plugins.json']
            ] as const
          ).map(([label, count, hint]) => (
            <div
              key={label}
              className="rounded-[22px] border border-navy/10 bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-bold tracking-[0.16em] text-navy/45 uppercase">{label}</p>
              <p className="font-display mt-2 text-4xl font-extrabold text-navy">{count}</p>
              <p className="mt-2 font-mono text-[11px] text-navy/40">{hint}</p>
            </div>
          ))}
        </div>
      }
    >
      <div className="relative flex h-full items-center justify-center overflow-hidden">
        <img
          src={sourceBoxes}
          alt="Stacked skill source trays"
          className="h-[120%] w-auto object-contain"
        />
        <span className="absolute bottom-3 left-3 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-navy uppercase">
          3 sources
        </span>
      </div>
    </BentoBlock>
  )
}

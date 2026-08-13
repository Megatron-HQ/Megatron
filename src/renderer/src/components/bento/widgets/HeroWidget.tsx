import { CircleArrow } from '../CircleArrow'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useInvocations, usePlugins, useSessions, useSkills } from '../../../lib/hooks/useQueries'
import heroKit from '../../../assets/bento/hero-kit.webp'

export function HeroWidget(props: WidgetProps): React.JSX.Element {
  const { data: skills = [], isPending: skillsPending } = useSkills()
  const { data: invocations = [] } = useInvocations()
  const { data: plugins = [] } = usePlugins()
  const { data: sessions = [] } = useSessions()

  return (
    <BentoBlock
      layoutId="hero"
      title="Megatron"
      ariaLabel="Open Megatron overview"
      cardClassName="bg-cream text-navy"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-4xl space-y-8 text-navy">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-navy/50">
              Mission control
            </p>
            <h4 className="font-display mt-2 text-4xl font-extrabold tracking-tight">
              Every Claude Code skill, in one tray.
            </h4>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-navy/70">
              Megatron inventories global, project, and plugin-installed skills, lints their
              metadata, and tracks how they actually get used — without writing anything back.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: 'Skills', value: skills.length },
              { label: 'Invocations', value: invocations.length },
              { label: 'Plugins', value: plugins.length },
              { label: 'Sessions', value: sessions.length }
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-[22px] border border-navy/10 bg-white px-5 py-6 shadow-sm"
              >
                <div className="font-display text-4xl font-extrabold tracking-tight">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-navy/50">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <div className="relative flex h-full flex-col justify-between p-7 md:p-8">
        <div className="relative z-10 max-w-[54%]">
          <p className="text-sm font-medium text-navy/70">Welcome to</p>
          <h2 className="font-display mt-1 text-[42px] leading-[0.95] font-extrabold tracking-tight md:text-5xl">
            Megatron
          </h2>
          <p className="mt-3 max-w-[16ch] text-[15px] leading-snug font-medium text-navy/75">
            Inventory, lint, and track every Claude Code skill.
          </p>
        </div>
        <CircleArrow />
        <img
          src={heroKit}
          alt="Modular skill kit"
          className="pointer-events-none absolute right-[-6%] bottom-[-8%] h-[78%] w-auto max-w-[58%] object-contain"
        />
        {skillsPending ? <span className="sr-only">Loading inventory</span> : null}
      </div>
    </BentoBlock>
  )
}

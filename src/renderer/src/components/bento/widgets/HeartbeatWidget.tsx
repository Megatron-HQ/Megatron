import { Activity, Play } from 'lucide-react'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useInvocations, useSkills } from '../../../lib/hooks/useQueries'
import pulseDisc from '../../../assets/bento/pulse-disc.webp'

export function HeartbeatWidget(props: WidgetProps): React.JSX.Element {
  const { data: invocations = [] } = useInvocations()
  const { data: skills = [] } = useSkills()
  const recent = invocations.slice(0, 10)
  const sourceByName = new Map(skills.map((skill) => [skill.name, skill.source_type]))

  return (
    <BentoBlock
      layoutId="heartbeat"
      title="Autonomous Invocations"
      icon={<Activity className="size-5 text-navy" />}
      ariaLabel="Open invocation log"
      cardClassName="bg-cream text-navy"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-4xl space-y-6 font-mono text-sm text-navy/70">
          <div className="flex items-center justify-between border-b border-navy/10 pb-4">
            <p className="font-sans text-lg font-semibold text-navy">Invocation log</p>
            <span className="rounded-full bg-teal px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase">
              {invocations.length} tracked
            </span>
          </div>
          <div className="flex flex-col divide-y divide-navy/10 rounded-[20px] border border-navy/10 bg-white shadow-sm">
            {recent.map((inv) => (
              <div key={inv.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-sans text-base font-bold tracking-tight text-navy">
                      {inv.skill_name}
                    </span>
                    <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-semibold tracking-wider text-navy/60 uppercase">
                      {sourceByName.get(inv.skill_name) ?? 'built-in'}
                    </span>
                  </div>
                  <span className="text-xs text-navy/40">
                    {new Date(inv.invoked_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="rounded-md border border-navy/10 bg-cream px-2 py-1 font-semibold tracking-wider text-navy/60 uppercase">
                    {inv.trigger_type}
                  </span>
                  {inv.args_text ? (
                    <span className="max-w-lg truncate rounded-md border border-navy/10 bg-white px-2 py-1 text-navy/55">
                      {inv.args_text}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <div className="p-8 text-center font-sans text-navy/50">
                No recent invocations found.
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="relative flex h-full items-center gap-4 overflow-hidden px-6">
        <div className="relative w-[42%] shrink-0">
          <img src={pulseDisc} alt="Invocation pulse" className="w-full object-contain" />
          <div className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-coral shadow-[0_8px_20px_rgba(226,61,40,0.35)]">
            <Play className="ml-0.5 size-6 fill-white text-white" />
          </div>
        </div>
        <div className="relative z-10 min-w-0 flex-1 pr-2">
          <p className="font-serif text-[32px] leading-[1.05] text-navy italic md:text-[38px]">
            How skills fire
          </p>
          <p className="mt-2 text-sm font-medium text-navy/55">
            {invocations.length} recorded actions
          </p>
        </div>
      </div>
    </BentoBlock>
  )
}

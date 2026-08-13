import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useSkills } from '../../../lib/hooks/useQueries'
import { cn } from '@/lib/utils'

export function LinterWidget(props: WidgetProps): React.JSX.Element {
  const { data: skills = [] } = useSkills()
  const lintIssues = skills.filter((skill) => !skill.description)
  const hasIssues = lintIssues.length > 0
  const reduceMotion = useReducedMotion()
  const [slide, setSlide] = useState(0)

  useEffect(() => {
    if (reduceMotion || lintIssues.length < 2) return
    const timer = window.setInterval(() => {
      setSlide((current) => (current + 1) % lintIssues.length)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [lintIssues.length, reduceMotion])

  const activeIssue = lintIssues.length === 0 ? undefined : lintIssues[slide % lintIssues.length]

  return (
    <BentoBlock
      layoutId="linter"
      title="Metadata Linter"
      icon={
        hasIssues ? (
          <AlertTriangle className="size-5 text-orange" />
        ) : (
          <CheckCircle2 className="size-5 text-orange" />
        )
      }
      ariaLabel="Open metadata linter"
      cardClassName="bg-orange text-white"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-4xl space-y-6 text-navy/70">
          <div className="flex items-center justify-between border-b border-navy/10 pb-4">
            <p className="font-display text-lg font-semibold text-navy">Linter rules enforced</p>
            <span
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold tracking-wider uppercase',
                hasIssues ? 'bg-orange/15 text-orange' : 'bg-emerald-50 text-emerald-700'
              )}
            >
              {lintIssues.length} missing
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {lintIssues.map((skill) => (
              <div
                key={skill.id}
                className="relative overflow-hidden rounded-[20px] border border-navy/10 bg-white p-4 shadow-sm"
              >
                <div className="absolute top-0 left-0 h-full w-1.5 bg-orange" />
                <h4 className="ml-3 font-bold tracking-tight text-navy">{skill.name}</h4>
                <p className="ml-3 mt-1 mb-3 truncate font-mono text-xs text-navy/50">
                  {skill.source_path}
                </p>
                <div className="ml-3 rounded-lg border border-orange/20 bg-orange/10 p-2.5">
                  <p className="flex items-center gap-2 text-xs font-medium text-navy">
                    <AlertTriangle className="size-3.5 text-orange" />
                    Missing `description` in YAML frontmatter.
                  </p>
                </div>
              </div>
            ))}
            {lintIssues.length === 0 && (
              <div className="col-span-full rounded-[24px] border border-emerald-100 bg-emerald-50/70 p-10 text-center shadow-sm">
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="size-8 text-emerald-500" />
                </div>
                <p className="font-display text-lg font-bold tracking-tight text-emerald-900">
                  All systems green.
                </p>
                <p className="mt-1 text-sm font-medium text-emerald-700/80">
                  No metadata anomalies detected.
                </p>
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="relative flex h-full flex-col justify-between overflow-hidden p-5">
        <ConfettiDots />
        <div className="relative z-10">
          {hasIssues ? (
            <>
              <p className="text-[11px] font-bold tracking-[0.18em] text-white/80 uppercase">
                Needs a pass
              </p>
              <p className="font-display mt-1 text-[28px] leading-none font-extrabold tracking-tight">
                {lintIssues.length} {lintIssues.length === 1 ? 'Warning' : 'Warnings'}
              </p>
              {activeIssue ? (
                <p className="mt-2 truncate text-sm font-medium text-white/85">
                  {activeIssue.name}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold tracking-[0.18em] text-white/80 uppercase">
                Congratulations
              </p>
              <p className="font-display mt-1 text-[28px] leading-none font-extrabold tracking-tight">
                All clear
              </p>
            </>
          )}
        </div>
        <div className="relative z-10 flex gap-1.5">
          {(hasIssues ? lintIssues : [0, 1, 2]).slice(0, 3).map((_, index) => (
            <span
              key={index}
              className={cn(
                'size-1.5 rounded-full',
                index === (hasIssues ? slide % Math.min(lintIssues.length, 3) : 0)
                  ? 'bg-white'
                  : 'bg-white/40'
              )}
            />
          ))}
        </div>
      </div>
    </BentoBlock>
  )
}

function ConfettiDots(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute top-4 right-6 size-2 rounded-full bg-white/90" />
      <span className="absolute top-10 right-14 size-1.5 rounded-full bg-yellow-200" />
      <span className="absolute top-7 right-24 size-1 rounded-full bg-white/70" />
      <span className="absolute right-8 bottom-10 size-2 rounded-full bg-yellow-100/80" />
      <span className="absolute top-1/2 right-4 size-1.5 rounded-full bg-white/50" />
      <span className="absolute bottom-6 left-8 size-1.5 rounded-full bg-white/60" />
    </div>
  )
}

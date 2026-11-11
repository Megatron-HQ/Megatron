import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import {
  ArrowRight,
  ArrowUpCircle,
  BarChart3,
  Blocks,
  BrainCircuit,
  CircleX,
  HardDrive,
  LoaderCircle,
  Lock,
  RotateCw,
  ScanSearch,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { pluginUpdateDetails } from '@/lib/plugin-update'
import { useUsageProjects } from '@/lib/use-usage-projects'
import { cn } from '@/lib/utils'
import { usageOverviewQuery } from '@/lib/usage-overview-query'
import type { AllowedPathRow, PluginRow, SkillRow, SkippedGrant } from '../../../../shared/ipc'
import { CountUp } from './CountUp'
import { LIME_BUTTON, OnboardingFolderStep } from './OnboardingFolderStep'
import { StepHeading } from './StepHeading'

const STEPS = ['brief', 'overview', 'folders'] as const
const SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const
const CLAUDE_DIR = window.api.platform === 'win32' ? '%USERPROFILE%\\.claude' : '~/.claude'

interface OnboardingDialogProps {
  open: boolean
  onFinish: () => void
  skills: SkillRow[]
  plugins: PluginRow[]
  folders: AllowedPathRow[]
  scanComplete: boolean
  home: string
  onAddFolders: () => Promise<SkippedGrant[]>
}

export function OnboardingDialog({
  open,
  onFinish,
  skills,
  plugins,
  folders,
  scanComplete,
  home,
  onAddFolders
}: OnboardingDialogProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [step, setStep] = useState(0)
  const [visited, setVisited] = useState(0)
  const [direction, setDirection] = useState(1)
  const [wasOpen, setWasOpen] = useState(open)
  // A replay from Settings starts over rather than resuming where the last run was closed.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep(0)
      setVisited(0)
      setDirection(1)
    }
  }

  // The dialog centers itself with a -50% translate, so a layout animation on the content would
  // leave the dialog jumping to its new center. Animating a measured height re-centers smoothly.
  const [height, setHeight] = useState<number | undefined>(undefined)
  const observer = useRef<ResizeObserver | null>(null)
  const measure = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!element) return
    observer.current = new ResizeObserver(([entry]) =>
      setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
    )
    observer.current.observe(element)
  }, [])

  function go(to: number): void {
    if (to < 0 || to >= STEPS.length || to === step) return
    setDirection(to > step ? 1 : -1)
    setStep(to)
    setVisited((current) => Math.max(current, to))
  }

  const variants: Variants = {
    enter: (towards: number) => (reduceMotion ? { opacity: 0 } : { opacity: 0, x: towards * 48 }),
    center: { opacity: 1, x: 0 },
    exit: (towards: number) => (reduceMotion ? { opacity: 0 } : { opacity: 0, x: towards * -48 })
  }
  const granted = folders.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onFinish()}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden p-0 sm:max-w-[560px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            go(step + 1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            go(step - 1)
          } else if (
            // The folder step's primary action opens a native dialog or finishes; neither should
            // fire from a stray Enter, so Enter only advances the two reading steps.
            event.key === 'Enter' &&
            step < STEPS.length - 1 &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault()
            go(step + 1)
          }
        }}
      >
        <DialogTitle className="sr-only">Welcome to Megatron</DialogTitle>
        <motion.div
          initial={false}
          animate={{ height: height ?? 'auto' }}
          transition={reduceMotion ? { duration: 0 } : SPRING}
          className="relative overflow-hidden"
        >
          <div ref={measure} className="relative px-6 pt-7 pb-6">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <motion.div
                key={STEPS[step]}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={reduceMotion ? { duration: 0.12 } : SPRING}
              >
                {step === 0 && <BriefStep />}
                {step === 1 && (
                  <OverviewStep skills={skills} plugins={plugins} scanComplete={scanComplete} />
                )}
                {step === 2 && (
                  <OnboardingFolderStep
                    folders={folders}
                    skills={skills}
                    home={home}
                    onAddFolders={onAddFolders}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div role="group" aria-label="Onboarding progress" className="flex items-center">
            {STEPS.map((name, index) => (
              <button
                key={name}
                type="button"
                aria-label={`Step ${index + 1} of ${STEPS.length}`}
                aria-current={index === step ? 'step' : undefined}
                disabled={index > visited}
                onClick={() => go(index)}
                className="group rounded-full p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
              >
                <span
                  className={cn(
                    'block h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none',
                    index === step
                      ? 'w-6 bg-foreground'
                      : 'w-1.5 bg-muted-foreground/30 group-enabled:group-hover:bg-muted-foreground/60'
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => go(step - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" size="sm" className={LIME_BUTTON} onClick={() => go(step + 1)}>
                Next
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant={granted ? 'default' : 'outline'}
                className={cn(granted && LIME_BUTTON)}
                onClick={onFinish}
              >
                {granted ? 'Open Megatron' : 'Skip for now'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useStagger(index: number): {
  initial: false | { opacity: number; y: number }
  animate: { opacity: number; y: number }
  transition: object
} {
  const reduceMotion = useReducedMotion() === true
  return {
    initial: reduceMotion ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...SPRING, delay: reduceMotion ? 0 : 0.08 + index * 0.07 }
  }
}

const FACTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: HardDrive,
    title: 'Reads locally, uploads nothing',
    body: `Megatron reads ${CLAUDE_DIR} on this machine. No telemetry, no AI calls.`
  },
  {
    icon: Lock,
    title: 'Never touches your skills',
    body: "Plugin changes go through Claude Code's own CLI, and only when you click."
  },
  {
    icon: ScanSearch,
    title: 'Catches broken skills before Claude does',
    body: 'Local checks flag bad frontmatter, broken paths and missing MCP servers.'
  }
]

function BriefStep(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Everything Claude Code knows, in one place.">
        A local map of your skills, plugins and usage. Here&apos;s what you&apos;re signing up for.
      </StepHeading>
      <ul className="flex flex-col gap-4">
        {FACTS.map((fact, index) => (
          <Fact key={fact.title} index={index} {...fact} />
        ))}
      </ul>
    </div>
  )
}

function Fact({
  icon: Icon,
  title,
  body,
  index
}: {
  icon: LucideIcon
  title: string
  body: string
  index: number
}): React.JSX.Element {
  const stagger = useStagger(index)
  return (
    <motion.li {...stagger} className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[13px] text-muted-foreground">{body}</span>
      </span>
    </motion.li>
  )
}

function OverviewStep({
  skills,
  plugins,
  scanComplete
}: {
  skills: SkillRow[]
  plugins: PluginRow[]
  scanComplete: boolean
}): React.JSX.Element {
  const { data: usage } = useQuery(usageOverviewQuery)
  const { data: usageProjects } = useUsageProjects()
  const usageComplete = usage?.scanComplete === true

  // Nothing at all, after both scans finished: most likely Claude Code has never run here, or
  // its data lives somewhere Megatron can't read yet (#16, #17). Say so instead of three zeros.
  if (
    scanComplete &&
    usageComplete &&
    usageProjects !== undefined &&
    skills.length === 0 &&
    plugins.length === 0 &&
    usageProjects.locations.length === 0
  )
    return <NoDataStep />

  const attention = skills.filter((skill) => skill.lint_status !== 'clean').length
  // Same icon and tone LintStatusBadge gives the worst status, so the count reads as the signal
  // the Skills table will show.
  const attentionTone: DetailTone = skills.some((skill) => skill.lint_status === 'error')
    ? { icon: CircleX, className: 'text-destructive' }
    : { icon: TriangleAlert, className: 'text-warning' }
  const updates = plugins.filter((plugin) => pluginUpdateDetails(plugin).hasUpdate).length
  const prompts = usage?.activity.last30d.prompts

  return (
    <div className="flex flex-col gap-6">
      <StepHeading title={scanComplete ? 'Here’s what Megatron found' : 'Scanning your setup…'}>
        Three places to look once you&apos;re in.
      </StepHeading>
      <ul className="grid grid-cols-3 gap-3">
        <OverviewCard
          index={0}
          icon={BrainCircuit}
          label="Skills"
          value={skills.length}
          settled={scanComplete}
          detail={attention > 0 ? `${attention} need attention` : null}
          detailTone={attentionTone}
          line="Every global, project and plugin skill, linted."
        />
        <OverviewCard
          index={1}
          icon={Blocks}
          label="Plugins"
          value={plugins.length}
          settled={scanComplete}
          detail={updates > 0 ? `${updates} ${updates === 1 ? 'update' : 'updates'}` : null}
          detailTone={{ icon: ArrowUpCircle, className: 'text-info' }}
          line="Enable, disable, update or remove, scoped per project."
        />
        <OverviewCard
          index={2}
          icon={BarChart3}
          label="Usage"
          value={prompts}
          settled={usageComplete}
          detail={prompts ? 'prompts in 30 days' : null}
          line="Tokens, estimated cost, models, and which skills actually fire."
        />
      </ul>
    </div>
  )
}

type DetailTone = { icon: LucideIcon; className: string }

function OverviewCard({
  index,
  icon: Icon,
  label,
  value,
  settled,
  detail,
  detailTone,
  line
}: {
  index: number
  icon: LucideIcon
  label: string
  value: number | undefined
  settled: boolean
  detail: string | null
  // A status detail pairs its tone with an icon (Tones-Aren't-The-Stamp); the text stays muted.
  detailTone?: DetailTone
  line: string
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const stagger = useStagger(index)
  const hasValue = value !== undefined && value > 0
  return (
    <motion.li
      {...stagger}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {/* Space stays reserved while a count may still arrive, so the cards don't jump; a count
          that settles at zero gives the space back and only the line remains. */}
      {(hasValue || !settled) && (
        <div className="flex min-h-[52px] flex-col gap-0.5">
          {hasValue && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING}
              className="flex flex-col gap-0.5"
            >
              <span className="font-mono text-3xl leading-none font-medium tracking-tight">
                <CountUp value={value} />
              </span>
              {detail && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {detailTone && (
                    <detailTone.icon
                      className={cn('size-3 shrink-0', detailTone.className)}
                      aria-hidden
                    />
                  )}
                  {detail}
                </span>
              )}
            </motion.div>
          )}
        </div>
      )}
      <span className="text-xs leading-relaxed text-muted-foreground">{line}</span>
    </motion.li>
  )
}

function NoDataStep(): React.JSX.Element {
  const [rescanning, setRescanning] = useState(false)
  const causes = [
    'Haven’t used Claude Code on this computer yet? Run it once, then rescan.',
    'Moved its data with CLAUDE_CONFIG_DIR? Megatron can’t read custom locations yet.',
    ...(window.api.platform === 'win32'
      ? ['Running Claude Code inside WSL? Megatron can’t see WSL yet.']
      : [])
  ]

  async function rescan(): Promise<void> {
    setRescanning(true)
    try {
      await window.api.rescan()
    } finally {
      setRescanning(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="No Claude Code data found">
        Megatron looked in {CLAUDE_DIR} and found no skills, plugins or sessions.
      </StepHeading>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] text-muted-foreground">
        {causes.map((cause) => (
          <li key={cause}>{cause}</li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={rescanning}
        aria-busy={rescanning}
        onClick={() => void rescan()}
      >
        {rescanning ? (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <RotateCw className="size-4" />
        )}
        Rescan
      </Button>
    </div>
  )
}

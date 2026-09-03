import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ThemeToggleProps {
  isDark: boolean
  onToggle: () => void
}

// Sun/moon morph adapted from Skiper UI's skiper4 `ThemeToggleButton2`
// (https://skiper-ui.com/v1/skiper4, MIT) — the SVG paths and motion targets are lifted
// verbatim; the wiring is not. skiper4's version holds its own `useState` and can't drive
// external theme, hardcodes a bg-black/bg-white pill and a colliding clipPath id, imports
// framer-motion, and has no reduced-motion guard. Here it takes `isDark`/`onToggle`, renders
// bare in currentColor at the rail's standard icon size, and honors `useReducedMotion()`.
export function ThemeToggle({ isDark, onToggle }: ThemeToggleProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const clipId = useId()
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : ({ ease: 'easeInOut', duration: 0.35 } as const)
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onToggle}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <svg
            className="size-4"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            fill="currentColor"
            strokeLinecap="round"
            viewBox="0 0 32 32"
          >
            <clipPath id={clipId}>
              <motion.path
                initial={{ y: isDark ? 10 : 0, x: isDark ? -12 : 0 }}
                animate={{ y: isDark ? 10 : 0, x: isDark ? -12 : 0 }}
                transition={transition}
                d="M0-5h30a1 1 0 0 0 9 13v24H0Z"
              />
            </clipPath>
            <g clipPath={`url(#${clipId})`}>
              {/* `initial` is required, not cosmetic: motion strips `r` from the forwarded
                  DOM props and, without an initial value, renders `r="undefined"` for the
                  first frame — which SVG rejects with a console error. */}
              <motion.circle
                cx="16"
                cy="16"
                initial={{ r: isDark ? 10 : 8 }}
                animate={{ r: isDark ? 10 : 8 }}
                transition={transition}
              />
              <motion.g
                initial={{
                  rotate: isDark ? -100 : 0,
                  scale: isDark ? 0.5 : 1,
                  opacity: isDark ? 0 : 1
                }}
                animate={{
                  rotate: isDark ? -100 : 0,
                  scale: isDark ? 0.5 : 1,
                  opacity: isDark ? 0 : 1
                }}
                transition={transition}
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M16 5.5v-4" />
                <path d="M16 30.5v-4" />
                <path d="M1.5 16h4" />
                <path d="M26.5 16h4" />
                <path d="m23.4 8.6 2.8-2.8" />
                <path d="m5.7 26.3 2.9-2.9" />
                <path d="m5.8 5.8 2.8 2.8" />
                <path d="m23.4 23.4 2.9 2.9" />
              </motion.g>
            </g>
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

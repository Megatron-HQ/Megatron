import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ENTER, screenEnter, type ScreenEnterKind } from '@/lib/transitions'
import type { AppSection } from '../../../shared/ipc'

interface ScreenTransitionProps {
  screenKey: string
  section: AppSection
  depth: number
  className?: string
  children: React.ReactNode
}

// Enter-only: the old screen leaves in the same commit the new one mounts, so no leaving tree
// stays around to double Escape listeners, screen-reader content, or row locators.
export function ScreenTransition({
  screenKey,
  section,
  depth,
  className,
  children
}: ScreenTransitionProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [previous, setPrevious] = useState({ screenKey, section, depth })
  // Null until the first change, so the first paint never animates.
  const [kind, setKind] = useState<ScreenEnterKind | null>(null)
  if (previous.screenKey !== screenKey) {
    setPrevious({ screenKey, section, depth })
    // depth >= covers detail → detail ("View global skill"), which goes deeper, not back.
    setKind(section !== previous.section ? 'section' : depth >= previous.depth ? 'deeper' : 'back')
  }

  return (
    <motion.div
      key={screenKey}
      data-screen
      className={className}
      initial={kind ? screenEnter(kind, reduceMotion) : false}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={ENTER}
    >
      {children}
    </motion.div>
  )
}

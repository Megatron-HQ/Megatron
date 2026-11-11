import { useEffect } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { formatCount } from '@/components/usage/chart-utils'

// Counts toward each new value from wherever it currently is, so a number that grows while the
// scan reports keeps climbing instead of restarting from zero.
export function CountUp({ value }: { value: number }): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const count = useMotionValue(reduceMotion ? value : 0)
  const text = useTransform(count, (latest) => formatCount(Math.round(latest)))

  useEffect(() => {
    if (reduceMotion) {
      count.set(value)
      return
    }
    const controls = animate(count, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [count, value, reduceMotion])

  return <motion.span className="tabular-nums">{text}</motion.span>
}

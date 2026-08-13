import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

export function StoriesBar({ className }: { className?: string }): React.JSX.Element {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={cn('flex h-full items-center rounded-[22px] bg-orange px-5 text-white', className)}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.4, delay: reduceMotion ? 0 : 0.04 }}
    >
      <h2 className="font-display text-sm font-bold tracking-[0.14em] uppercase md:text-base">
        Skill Stories
      </h2>
    </motion.div>
  )
}

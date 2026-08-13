import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface BentoBlockProps {
  layoutId: string
  isExpanded: boolean
  onClick: () => void
  onClose: () => void
  className?: string
  cardClassName?: string
  title: string
  icon?: ReactNode
  children: ReactNode
  expandedContent: ReactNode
  enterDelay?: number
  skipEnterAnimation?: boolean
  ariaLabel?: string
}

export function BentoBlock({
  layoutId,
  isExpanded,
  onClick,
  onClose,
  className,
  cardClassName,
  title,
  icon,
  children,
  expandedContent,
  enterDelay = 0,
  skipEnterAnimation = false,
  ariaLabel
}: BentoBlockProps): React.JSX.Element {
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!isExpanded) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isExpanded, onClose])

  return (
    <motion.div
      className={cn('min-h-0 min-w-0', className)}
      initial={reduceMotion || skipEnterAnimation ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.4,
        delay: reduceMotion ? 0 : enterDelay,
        ease: [0.22, 1, 0.36, 1]
      }}
    >
      <motion.div
        layoutId={layoutId}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel ?? title}
        onClick={!isExpanded ? onClick : undefined}
        onKeyDown={(event) => {
          if (isExpanded) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
        className={cn('bento-card', cardClassName, isExpanded && 'invisible')}
      >
        {children}
      </motion.div>

      {createPortal(
        <AnimatePresence>
          {isExpanded && (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="fixed inset-0 z-40 cursor-pointer bg-black/55 backdrop-blur-sm"
                onClick={onClose}
              />
              <motion.div
                key="sheet"
                layoutId={layoutId}
                className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-[2.5rem] bg-cream shadow-[0_24px_80px_-20px_rgba(0,0,0,0.45)] md:inset-10 lg:inset-16"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${layoutId}-title`}
              >
                <div className="flex items-center justify-between gap-4 border-b border-navy/10 px-6 py-5 md:px-8">
                  <div className="flex min-w-0 items-center gap-3 text-navy">
                    {icon ? (
                      <div className="flex size-11 items-center justify-center rounded-2xl bg-white shadow-sm">
                        {icon}
                      </div>
                    ) : null}
                    <h3
                      id={`${layoutId}-title`}
                      className="font-display truncate text-2xl font-bold tracking-tight"
                    >
                      {title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-white text-navy shadow-sm transition-colors duration-200 hover:bg-navy hover:text-white"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <div className="custom-scrollbar flex-1 overflow-auto px-6 py-6 md:px-8 md:py-8">
                  {expandedContent}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </motion.div>
  )
}

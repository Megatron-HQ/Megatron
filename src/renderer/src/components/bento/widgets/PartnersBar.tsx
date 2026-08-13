import { motion, useReducedMotion } from 'framer-motion'
import { CircleArrow } from '../CircleArrow'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { usePlugins, useSkills } from '../../../lib/hooks/useQueries'
import { AVATAR_COLORS, initials } from '../helpers'
import { cn } from '@/lib/utils'
import { Blocks } from 'lucide-react'

export function PartnersBar(props: WidgetProps): React.JSX.Element {
  const { data: skills = [] } = useSkills()
  const { data: plugins = [] } = usePlugins()
  const reduceMotion = useReducedMotion()

  const sourceTiles = [
    { label: 'Global', count: skills.filter((skill) => skill.source_type === 'global').length },
    { label: 'Project', count: skills.filter((skill) => skill.source_type === 'project').length },
    { label: 'Plugin', count: skills.filter((skill) => skill.source_type === 'plugin').length }
  ]
  const pluginTiles = plugins.slice(0, 3).map((plugin) => ({
    label: plugin.name.split('@')[0] ?? plugin.name,
    count: null as number | null
  }))
  const tiles = [...sourceTiles, ...pluginTiles]

  return (
    <motion.div
      className={cn('flex min-h-0 gap-3', props.className)}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduceMotion ? 0 : 0.4,
        delay: reduceMotion ? 0 : (props.enterDelay ?? 0.18)
      }}
    >
      <div className="w-[230px] shrink-0">
        <BentoBlock
          layoutId="partners"
          title="Skill Sources"
          icon={<Blocks className="size-5 text-navy" />}
          ariaLabel="Open skill sources"
          className="h-full"
          skipEnterAnimation
          cardClassName="bg-orange text-white rounded-[24px]"
          isExpanded={props.isExpanded}
          onClick={props.onClick}
          onClose={props.onClose}
          expandedContent={
            <div className="mx-auto max-w-4xl space-y-6 text-navy/70">
              <div className="flex items-center justify-between border-b border-navy/10 pb-4">
                <p className="font-display text-lg font-semibold text-navy">Authorized sources</p>
                <span className="rounded-full bg-orange px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase">
                  {sourceTiles.length} tiers
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {sourceTiles.map((tile) => (
                  <div
                    key={tile.label}
                    className="rounded-[20px] border border-navy/10 bg-white p-5 shadow-sm"
                  >
                    <p className="text-xs font-bold tracking-[0.16em] text-navy/45 uppercase">
                      {tile.label}
                    </p>
                    <p className="font-display mt-2 text-4xl font-extrabold text-navy">
                      {tile.count}
                    </p>
                    <p className="mt-1 text-sm font-medium text-navy/55">indexed skills</p>
                  </div>
                ))}
              </div>
            </div>
          }
        >
          <div className="flex h-full items-center justify-between gap-3 px-5">
            <span className="font-display text-[15px] leading-tight font-bold">
              Skill
              <br />
              Sources
            </span>
            <CircleArrow className="size-10" />
          </div>
        </BentoBlock>
      </div>
      <div
        className="grid min-w-0 flex-1 gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(tiles.length, 1)}, minmax(0, 1fr))` }}
      >
        {tiles.map((tile, index) => (
          <div
            key={`${tile.label}-${index}`}
            className="flex h-full min-w-0 flex-col items-center justify-center rounded-[22px] bg-white px-2 text-navy"
          >
            <span
              className="mb-1.5 flex size-9 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
            >
              {initials(tile.label)}
            </span>
            <span className="w-full truncate text-center text-[11px] font-bold tracking-wide">
              {tile.label}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

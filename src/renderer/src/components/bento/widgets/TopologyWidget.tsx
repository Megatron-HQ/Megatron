import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { usePlugins, useSessions, useSkills } from '../../../lib/hooks/useQueries'
import { Network } from 'lucide-react'

export function TopologyWidget(props: WidgetProps): React.JSX.Element {
  const { data: skills = [] } = useSkills()
  const { data: plugins = [] } = usePlugins()
  const { data: sessions = [] } = useSessions()

  return (
    <BentoBlock
      layoutId="topology"
      title="System Map"
      icon={<Network className="size-5 text-navy" />}
      ariaLabel="Open system map"
      cardClassName="bg-charcoal text-white"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-3xl space-y-6 text-navy">
          <p className="text-sm leading-relaxed text-navy/70">
            Megatron joins three skill sources with live sessions. Invocations are counted only when
            they are not sidechain transcripts.
          </p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Skills', value: skills.length, color: 'bg-teal' },
              { label: 'Plugins', value: plugins.length, color: 'bg-orange' },
              { label: 'Sessions', value: sessions.length, color: 'bg-navy' }
            ].map((node) => (
              <div key={node.label} className="rounded-[20px] bg-white p-5 text-center shadow-sm">
                <div className={`mx-auto mb-3 size-3 rounded-full ${node.color}`} />
                <div className="font-display text-3xl font-extrabold">{node.value}</div>
                <div className="mt-1 text-[11px] font-bold tracking-[0.14em] text-navy/45 uppercase">
                  {node.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex h-full items-center justify-center p-3">
        <svg viewBox="0 0 220 120" className="h-full w-full" aria-hidden="true">
          <line x1="40" y1="60" x2="110" y2="28" stroke="#3a3a3a" strokeWidth="2" />
          <line x1="40" y1="60" x2="110" y2="92" stroke="#3a3a3a" strokeWidth="2" />
          <line x1="110" y1="28" x2="180" y2="60" stroke="#3a3a3a" strokeWidth="2" />
          <line x1="110" y1="92" x2="180" y2="60" stroke="#3a3a3a" strokeWidth="2" />
          <circle cx="40" cy="60" r="14" fill="#f7a034" />
          <circle cx="110" cy="28" r="12" fill="#0b4f6c" />
          <circle cx="110" cy="92" r="12" fill="#e23d28" />
          <circle cx="180" cy="60" r="16" fill="#f4efe6" />
          <text x="40" y="64" textAnchor="middle" fontSize="9" fontWeight="700" fill="#113247">
            G
          </text>
          <text x="110" y="32" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
            P
          </text>
          <text x="110" y="96" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
            Pl
          </text>
          <text x="180" y="64" textAnchor="middle" fontSize="8" fontWeight="700" fill="#0c3854">
            MCP
          </text>
        </svg>
      </div>
    </BentoBlock>
  )
}

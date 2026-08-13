import { Bot } from 'lucide-react'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { useSessions } from '../../../lib/hooks/useQueries'
import agentPortrait from '../../../assets/bento/agent-portrait.webp'

export function RolesWidget(props: WidgetProps): React.JSX.Element {
  const { data: sessions = [] } = useSessions()

  return (
    <BentoBlock
      layoutId="roles"
      title="Active Agents"
      icon={<Bot className="size-5 text-navy" />}
      ariaLabel="Open active agent sessions"
      cardClassName="bg-charcoal text-white"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-4xl space-y-6 text-navy/70">
          <div className="flex items-center justify-between border-b border-navy/10 pb-4">
            <p className="font-display text-lg font-semibold text-navy">Active agent roles</p>
            <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase">
              {sessions.length} tracked
            </span>
          </div>
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.session_id}
                className="rounded-[20px] border border-navy/10 bg-white p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-[12px] border border-navy/10 bg-cream">
                      <Bot className="size-5 text-navy" />
                    </div>
                    <h4 className="font-mono text-sm font-bold tracking-tight text-navy">
                      {session.session_id}
                    </h4>
                  </div>
                  <span className="rounded-[8px] border border-navy/10 bg-cream px-3 py-1.5 text-xs font-medium text-navy/60">
                    {new Date(session.started_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-4">
                  <p className="flex-1 truncate rounded-[12px] border border-navy/10 bg-cream p-3 text-xs text-navy/60">
                    <span className="mr-2 font-bold tracking-widest text-navy/40 uppercase">
                      CWD
                    </span>
                    {session.cwd}
                  </p>
                  <div className="flex w-28 shrink-0 items-center justify-center rounded-[12px] border border-navy/10 bg-cream text-sm font-bold text-navy">
                    {session.message_count}
                    <span className="ml-1.5 font-medium text-navy/50">msgs</span>
                  </div>
                </div>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="p-8 text-center font-medium text-navy/50">No sessions found.</div>
            )}
          </div>
        </div>
      }
    >
      <div className="relative flex h-full flex-col overflow-hidden">
        <div className="relative z-10 p-5">
          <p className="font-display text-[22px] leading-[0.95] font-extrabold tracking-tight md:text-[26px]">
            Active
            <br />
            Agents
          </p>
          <p className="mt-2 text-[11px] font-semibold tracking-[0.16em] text-white/55 uppercase">
            {sessions.length} sessions
          </p>
        </div>
        <img
          src={agentPortrait}
          alt="Stylized agent operator"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] w-full object-cover object-[center_20%]"
        />
        <div className="pointer-events-none absolute inset-x-0 top-[32%] h-16 bg-gradient-to-b from-charcoal to-transparent" />
      </div>
    </BentoBlock>
  )
}

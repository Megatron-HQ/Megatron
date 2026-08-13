import { Database } from 'lucide-react'
import { BentoBlock } from '../BentoBlock'
import { WidgetProps } from './WidgetProps'
import { usePlugins } from '../../../lib/hooks/useQueries'

export function MCPWidget(props: WidgetProps): React.JSX.Element {
  const { data: plugins = [] } = usePlugins()

  return (
    <BentoBlock
      layoutId="mcp"
      title="MCP Servers"
      icon={<Database className="size-5 text-navy" />}
      ariaLabel="Open MCP servers"
      cardClassName="bg-white text-navy"
      {...props}
      expandedContent={
        <div className="mx-auto max-w-4xl space-y-6 text-navy/70">
          <div className="flex items-center justify-between border-b border-navy/10 pb-4">
            <p className="font-display text-lg font-semibold text-navy">Installed MCP servers</p>
            <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold tracking-wider text-white uppercase">
              {plugins.length} active
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {plugins.map((plugin, index) => (
              <div
                key={`${plugin.name}-${index}`}
                className="flex flex-col gap-3 rounded-[20px] border border-navy/10 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="size-3 rounded-full bg-coral shadow-sm" />
                  <h4 className="font-bold tracking-tight text-navy">{plugin.name}</h4>
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <span className="rounded-md border border-navy/10 bg-cream px-2.5 py-1 font-mono font-semibold text-navy/70">
                    v{plugin.installed_version}
                  </span>
                  <span className="rounded-md border border-navy/10 bg-navy/5 px-2.5 py-1 font-bold tracking-widest text-navy uppercase">
                    {plugin.scope}
                  </span>
                </div>
                <p className="mt-2 truncate border-t border-navy/10 pt-3 font-mono text-[11px] text-navy/40">
                  {plugin.install_path}
                </p>
              </div>
            ))}
            {plugins.length === 0 && (
              <div className="col-span-full p-8 text-center font-medium text-navy/50">
                No plugins or MCP servers registered.
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <h3 className="font-display text-[26px] leading-[0.9] font-extrabold tracking-tight md:text-[30px]">
            MCP
            <br />
            Servers
          </h3>
          <p className="mt-3 text-xs leading-relaxed font-medium text-navy/55">
            Plugin-installed MCP endpoints Megatron can see from the Claude Code registry.
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full bg-coral px-3 py-1.5 text-[11px] font-bold tracking-[0.14em] text-white uppercase">
          {plugins.length} live
        </span>
      </div>
    </BentoBlock>
  )
}

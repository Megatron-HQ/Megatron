import type { TokenCounts } from '../../../../shared/ipc'
import { TokenValue } from './TokenValue'

const CATEGORIES = [
  { key: 'input', label: 'Input', hint: 'New input, excluding cache reads and writes' },
  { key: 'output', label: 'Output', hint: 'Generated output, including thinking tokens' },
  { key: 'cacheRead', label: 'Cache reads', hint: 'Previously cached context processed again' },
  { key: 'cacheWrite', label: 'Cache writes', hint: 'Input written to the context cache' }
] as const

export function TokenReadout({ tokens }: { tokens: TokenCounts | null }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {CATEGORIES.map(({ key, label, hint }) => (
        <div key={key} className="min-w-0" title={tokens ? undefined : hint}>
          <dt className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-mono text-[20px] tabular-nums text-foreground">
            {tokens ? <TokenValue value={tokens[key]} hint={hint} /> : '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

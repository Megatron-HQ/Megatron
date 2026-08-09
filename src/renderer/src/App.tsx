import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

function App(): React.JSX.Element {
  const {
    data: sqliteVersion,
    isFetching,
    refetch
  } = useQuery({
    queryKey: ['sqlite-version'],
    queryFn: () => window.api.getSqliteVersion()
  })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-lg font-semibold">Megatron</h1>
      <p className="text-muted-foreground text-sm">
        better-sqlite3 &rarr; ipcMain &rarr; preload &rarr; TanStack Query
      </p>
      <p className="font-mono text-2xl">{isFetching ? '...' : sqliteVersion}</p>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
        Refetch
      </Button>
    </div>
  )
}

export default App

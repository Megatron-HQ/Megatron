import { CircleCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PluginActionToast {
  id: number
  message: string
}

interface PluginActionToastsProps {
  toasts: PluginActionToast[]
  onDismiss: (id: number) => void
}

export function PluginActionToasts({
  toasts,
  onDismiss
}: PluginActionToastsProps): React.JSX.Element | null {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-lg"
        >
          <CircleCheck className="size-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{toast.message}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onDismiss(toast.id)}
            aria-label={`Dismiss ${toast.message}`}
            className="shrink-0 text-muted-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}

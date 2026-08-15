import { useEffect } from 'react'
import { X } from 'lucide-react'
import { SourceBadge } from '@/components/SourceBadge'
import { cn } from '@/lib/utils'
import type { SkillRow } from '../../../shared/ipc'

interface SkillDetailProps {
  skill: SkillRow | null
  onClose: () => void
}

export function SkillDetail({ skill, onClose }: SkillDetailProps): React.JSX.Element {
  useEffect(() => {
    if (!skill) return
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [skill, onClose])

  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden border-l border-border transition-[width] duration-200 ease-out',
        skill ? 'w-[360px]' : 'w-0'
      )}
      aria-hidden={!skill}
    >
      {skill && (
        <div className="flex h-full w-[360px] flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{skill.name}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail panel"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-col gap-4 overflow-auto px-4 py-4 text-sm">
            <Field label="Source">
              <SourceBadge type={skill.source_type} />
            </Field>

            {skill.plugin_name && (
              <Field label="Plugin">
                <span className="font-mono text-xs">{skill.plugin_name}</span>
              </Field>
            )}

            <Field label="Description">
              <span className="text-muted-foreground">{skill.description ?? '—'}</span>
            </Field>

            <Field label="Path">
              <span className="font-mono text-xs break-all text-muted-foreground">
                {skill.source_path}
              </span>
            </Field>

            <Field label="Last scanned">
              <span className="text-muted-foreground">
                {new Date(skill.last_scanned_at).toLocaleString()}
              </span>
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}

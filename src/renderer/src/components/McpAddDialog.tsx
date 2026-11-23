import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  emptyMcpAddDraft,
  hasLiteralValues,
  mcpAddDraftErrors,
  mcpAddInput,
  mcpToolPrefix,
  parsePastedMcpJson,
  type McpAddDraft,
  type McpAddValue
} from '@/lib/mcp-add-form'
import { useProjectLabel } from '@/lib/use-project-label'
import type { McpAddInput, McpAddResult } from '../../../shared/ipc'

const FIELD_CLASS =
  'w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive'
const PRIMARY_CLASS =
  'bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime hover:opacity-90'

interface McpAddDialogProps {
  projectPath: string | null
  projects: string[]
  onOpenChange: (open: boolean) => void
  onAdd: (input: McpAddInput) => Promise<McpAddResult>
  onAdded: (result: { serverId: string; message: string }, projectPath: string | null) => void
}

export function McpAddDialog(props: McpAddDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pendingRef = useRef(false)

  function setDialogOpen(next: boolean): void {
    if (pendingRef.current) return
    setOpen(next)
    props.onOpenChange(next)
  }

  async function add(input: McpAddInput): Promise<McpAddResult> {
    if (pendingRef.current) return { ok: false, error: 'An MCP server is already being added.' }
    pendingRef.current = true
    try {
      return await props.onAdd(input)
    } finally {
      pendingRef.current = false
    }
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          aria-label="Add server"
          title="Add server"
          className={`${PRIMARY_CLASS} max-[1000px]:w-8 max-[1000px]:!px-0`}
        >
          <Plus aria-hidden="true" />
          <span className="max-[1000px]:hidden">Add server</span>
        </Button>
      </DialogTrigger>
      {open && <McpAddForm {...props} onAdd={add} onClose={() => setDialogOpen(false)} />}
    </Dialog>
  )
}

function McpAddForm({
  projectPath,
  projects,
  onAdd,
  onAdded,
  onClose
}: Omit<McpAddDialogProps, 'onOpenChange'> & {
  onClose: () => void
}): React.JSX.Element {
  const id = useId()
  const resolveProjectLabel = useProjectLabel()
  const [draft, setDraft] = useState(() => emptyMcpAddDraft(projectPath))
  const [paste, setPaste] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const errors = submitted ? mcpAddDraftErrors(draft) : {}
  const stdio = draft.transport === 'stdio'
  const literal = hasLiteralValues(draft)
  const projectFile = draft.projectPath
    ? `${draft.projectPath.replace(/[\\/]+$/, '')}${draft.projectPath.includes('\\') ? '\\' : '/'}.mcp.json`
    : '.mcp.json'

  function update(fields: Partial<McpAddDraft>): void {
    setDraft((current) => ({ ...current, ...fields }))
    setProblem(null)
  }

  function applyPaste(): void {
    const result = parsePastedMcpJson(paste)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    update({ ...result.fields, name: result.name ?? draft.name })
    setPaste('')
    setPasteOpen(false)
    setPasteError(null)
    requestAnimationFrame(() => document.getElementById(`${id}-name`)?.focus())
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (saving || unconfirmed) return
    setSubmitted(true)
    const input = mcpAddInput(draft)
    if (
      Object.keys(mcpAddDraftErrors(draft)).length > 0 ||
      (input.projectPath !== null && !projects.includes(input.projectPath))
    ) {
      setConfirming(false)
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus()
      )
      return
    }
    if (!confirming && (draft.scope === 'project' || literal)) {
      setConfirming(true)
      return
    }

    setSaving(true)
    setProblem(null)
    let result: McpAddResult
    try {
      result = await onAdd(input)
    } catch {
      // IPC errors can contain arbitrary messages. The service returns safe, user-facing errors.
      result = { ok: false, error: 'Megatron could not reach Claude Code. Try again.' }
    } finally {
      setSaving(false)
    }
    if (!result.ok) {
      setConfirming(false)
      setProblem(result.error)
      return
    }
    if ('verificationError' in result) {
      setDraft(emptyMcpAddDraft(projectPath))
      setPaste('')
      setUnconfirmed(true)
      setProblem(result.verificationError)
      return
    }
    onClose()
    onAdded(result, input.projectPath)
  }

  const projectError =
    errors.project ??
    (draft.projectPath && !projects.includes(draft.projectPath)
      ? 'This folder is unavailable. Choose another granted folder.'
      : undefined)

  return (
    <DialogContent
      className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-xl"
      showCloseButton={!saving}
    >
      <DialogHeader className="shrink-0 pr-5">
        <DialogTitle>
          {confirming && !unconfirmed ? 'Confirm server addition' : 'Add MCP server'}
        </DialogTitle>
        <DialogDescription>Claude Code saves the server in the scope you choose.</DialogDescription>
      </DialogHeader>
      <form
        ref={form}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex min-h-0 flex-col gap-3"
      >
        <div className="min-h-0 space-y-4 overflow-y-auto p-1" inert={saving}>
          {problem && (
            <p
              role="alert"
              className="rounded-md border border-border bg-muted p-2 text-sm break-words"
            >
              {problem}
            </p>
          )}
          {unconfirmed ? null : confirming ? (
            <div className="space-y-2 text-sm">
              {draft.scope === 'project' && (
                <p>
                  Claude Code will add <strong>{draft.name.trim()}</strong> to{' '}
                  <span className="font-mono text-xs break-all">{projectFile}</span>. Everyone who
                  uses this repository gets the configuration after you commit it.
                </p>
              )}
              {literal && <LiteralNotice project={draft.scope === 'project'} />}
            </div>
          ) : (
            <>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={pasteOpen}
                  onClick={() => {
                    setPasteOpen(!pasteOpen)
                    setPaste('')
                    setPasteError(null)
                  }}
                >
                  Paste JSON
                </Button>
                {pasteOpen && (
                  <div className="mt-2 space-y-2 rounded-md border border-border p-2">
                    <Label htmlFor={`${id}-paste`}>Server JSON</Label>
                    <textarea
                      id={`${id}-paste`}
                      rows={3}
                      className={`${FIELD_CLASS} resize-y font-mono`}
                      value={paste}
                      onChange={(event) => setPaste(event.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {pasteError && (
                      <p role="alert" className="text-xs text-destructive">
                        {pasteError}
                      </p>
                    )}
                    <Button type="button" size="sm" variant="secondary" onClick={applyPaste}>
                      Fill form
                    </Button>
                  </div>
                )}
              </div>
              <AddField id={`${id}-name`} label="Server name" error={errors.name}>
                <Input
                  id={`${id}-name`}
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={`${id}-name-note`}
                />
                {draft.name.trim() && (
                  <p
                    id={`${id}-name-note`}
                    className="font-mono text-xs break-all text-muted-foreground"
                  >
                    {mcpToolPrefix(draft.name)}&lt;tool&gt;
                  </p>
                )}
              </AddField>
              <div className="grid grid-cols-2 gap-3">
                <AddField id={`${id}-scope`} label="Scope">
                  <select
                    id={`${id}-scope`}
                    className={`${FIELD_CLASS} h-9`}
                    value={draft.scope}
                    onChange={(event) =>
                      update({ scope: event.target.value as McpAddDraft['scope'] })
                    }
                  >
                    <option value="user">User</option>
                    <option value="local">Local to a project</option>
                    <option value="project">Shared project</option>
                  </select>
                </AddField>
                <AddField id={`${id}-transport`} label="Transport">
                  <select
                    id={`${id}-transport`}
                    className={`${FIELD_CLASS} h-9`}
                    value={draft.transport}
                    onChange={(event) =>
                      update({ transport: event.target.value as McpAddDraft['transport'] })
                    }
                  >
                    <option value="stdio">Stdio</option>
                    <option value="http">HTTP</option>
                    <option value="sse">SSE</option>
                    {draft.transport === 'ws' && <option value="ws">WebSocket</option>}
                  </select>
                </AddField>
              </div>
              {draft.scope !== 'user' && (
                <AddField id={`${id}-project`} label="Granted project folder" error={projectError}>
                  <select
                    id={`${id}-project`}
                    className={`${FIELD_CLASS} h-9`}
                    value={draft.projectPath ?? ''}
                    aria-invalid={Boolean(projectError)}
                    onChange={(event) => update({ projectPath: event.target.value || null })}
                  >
                    <option value="">Choose a folder</option>
                    {projects.map((path) => (
                      <option key={path} value={path}>
                        {resolveProjectLabel(path)} · {path}
                      </option>
                    ))}
                  </select>
                  {projects.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Add a folder in Settings › Project folders to use this scope.
                    </p>
                  )}
                </AddField>
              )}
              {stdio ? (
                <>
                  <AddField id={`${id}-command`} label="Command" error={errors.command}>
                    <Input
                      id={`${id}-command`}
                      value={draft.command}
                      onChange={(event) => update({ command: event.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={Boolean(errors.command)}
                    />
                  </AddField>
                  <AddField id={`${id}-args`} label="Arguments">
                    <textarea
                      id={`${id}-args`}
                      rows={2}
                      className={`${FIELD_CLASS} resize-y font-mono`}
                      placeholder="One argument per line"
                      value={draft.argsText}
                      onChange={(event) => update({ argsText: event.target.value })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </AddField>
                </>
              ) : (
                <AddField id={`${id}-url`} label="Server URL" error={errors.url}>
                  <Input
                    id={`${id}-url`}
                    value={draft.url}
                    onChange={(event) => update({ url: event.target.value })}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(errors.url)}
                  />
                </AddField>
              )}
              <ValueFields
                key={stdio ? 'env' : 'headers'}
                kind={stdio ? 'env' : 'headers'}
                values={stdio ? draft.env : draft.headers}
                errors={errors}
                onChange={(values) => update(stdio ? { env: values } : { headers: values })}
              />
              {literal && <LiteralNotice project={draft.scope === 'project'} />}
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          {unconfirmed ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => (confirming ? setConfirming(false) : onClose())}
              >
                {confirming ? 'Back' : 'Cancel'}
              </Button>
              <Button type="submit" className={PRIMARY_CLASS} disabled={saving}>
                {saving && <Loader2 aria-hidden="true" className="animate-spin" />}
                {saving ? 'Adding…' : confirming ? 'Confirm and add' : 'Add server'}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function AddField({
  id,
  label,
  error,
  children
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function LiteralNotice({ project }: { project: boolean }): React.JSX.Element {
  return (
    <p className="rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-foreground">
      {project
        ? 'Project values are stored in the shared .mcp.json. Claude Code configurations in this scope cannot include literal credentials.'
        : 'Claude Code stores literal values in plain text in its configuration. Use an environment variable reference for credentials when possible.'}
    </p>
  )
}

function ValueFields({
  kind,
  values,
  errors,
  onChange
}: {
  kind: 'env' | 'headers'
  values: McpAddValue[]
  errors: Record<string, string>
  onChange: (values: McpAddValue[]) => void
}): React.JSX.Element {
  const id = useId()
  const singular = kind === 'env' ? 'environment variable' : 'header'
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">
        {kind === 'env' ? 'Environment variables' : 'Headers'}
      </legend>
      {values.map((entry, index) => {
        const nameId = `${id}-${index}-name`
        const valueId = `${id}-${index}-value`
        const error = errors[`${kind}.${index}`]
        const change = (fields: Partial<McpAddValue>): void =>
          onChange(
            values.map((value, position) => (position === index ? { ...value, ...fields } : value))
          )
        return (
          <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-end gap-2">
              <AddField id={nameId} label="Name">
                <Input
                  id={nameId}
                  value={entry.name}
                  onChange={(event) => change({ name: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(error)}
                />
              </AddField>
              <AddField id={valueId} label={entry.literal ? 'Literal value' : 'Variable reference'}>
                <Input
                  id={valueId}
                  type={entry.literal ? 'password' : 'text'}
                  placeholder={entry.literal ? undefined : '${TOKEN}'}
                  value={entry.value}
                  onChange={(event) => change({ value: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={Boolean(error)}
                />
              </AddField>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${singular} ${index + 1}`}
                onClick={() => onChange(values.filter((_value, position) => position !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.literal}
                onChange={(event) => change({ literal: event.target.checked })}
              />
              Use a literal value
            </label>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...values, { name: '', value: '', literal: false }])}
      >
        <Plus aria-hidden="true" />
        Add {singular}
      </Button>
    </fieldset>
  )
}

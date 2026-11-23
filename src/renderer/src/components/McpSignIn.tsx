import { useState } from 'react'
import { Loader2, LogIn, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpActionResult, McpLoginRef } from '../../../shared/ipc'

// Signing in to an MCP server (#50, docs/mcp-servers.md, Signing in to a server). Claude Code's
// login needs an interactive terminal, so Log in opens one and Check sign-in reads the outcome
// back; Megatron never sees the sign-in itself.

type Phase = 'idle' | 'opening' | 'waiting' | 'checking'
type Note = { text: string; tone: 'info' | 'warning' | 'error' }

const UNREACHABLE_MESSAGE = "Megatron couldn't reach Claude Code. Try again."

function noteFor(result: McpActionResult): Note {
  if (!result.ok) return { text: result.error, tone: 'error' }
  if ('verificationError' in result) return { text: result.verificationError, tone: 'warning' }
  return { text: result.message, tone: 'info' }
}

// Rendered with display: contents, so its buttons sit in the actions row they're placed in and its
// note wraps onto a line of its own (basis-full).
export function McpSignIn({
  loginRef,
  disabled = false,
  onSignedIn
}: {
  loginRef: McpLoginRef
  disabled?: boolean
  onSignedIn: (message: string) => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote] = useState<Note | null>(null)
  const busy = phase === 'opening' || phase === 'checking'

  async function open(): Promise<void> {
    setPhase('opening')
    setNote(null)
    let result: McpActionResult
    try {
      result = await window.api.loginMcpServer(loginRef)
    } catch {
      result = { ok: false, error: UNREACHABLE_MESSAGE }
    }
    setPhase(result.ok ? 'waiting' : 'idle')
    setNote(noteFor(result))
  }

  async function check(): Promise<void> {
    setPhase('checking')
    let result: McpActionResult
    try {
      result = await window.api.checkMcpSignIn(loginRef)
    } catch {
      result = { ok: false, error: UNREACHABLE_MESSAGE }
    }
    if (result.ok && 'message' in result) {
      setPhase('idle')
      setNote(null)
      onSignedIn(result.message)
      return
    }
    setPhase('waiting')
    setNote(noteFor(result))
  }

  const waiting = phase === 'waiting' || phase === 'checking'
  return (
    <div className="contents">
      {waiting ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || busy}
            onClick={() => void check()}
          >
            {phase === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {phase === 'checking' ? 'Checking…' : 'Check sign-in'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled || busy}
            onClick={() => void open()}
          >
            Open the terminal again
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled || busy}
          title="Opens a terminal running Claude Code's sign-in"
          onClick={() => void open()}
        >
          {phase === 'opening' ? <Loader2 className="animate-spin" /> : <LogIn />}
          {phase === 'opening' ? 'Opening…' : 'Log in'}
        </Button>
      )}
      {note && (
        <p
          role={note.tone === 'info' ? 'status' : 'alert'}
          className={cn(
            'basis-full text-[11px] break-words',
            note.tone === 'info' && 'text-muted-foreground',
            note.tone === 'warning' && 'text-warning',
            note.tone === 'error' && 'text-destructive'
          )}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}

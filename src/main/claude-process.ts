import { execFile } from 'child_process'
import { resolveClaudeCommand } from './claude-cli'

export const CLAUDE_NOT_FOUND_MESSAGE =
  'Claude Code CLI was not found. Install Claude Code and ensure `claude` is on your PATH.'

export interface RunClaudeOptions {
  cwd?: string
  timeoutMs: number
  timeoutMessage: string
  maxBuffer?: number
  // Written to the CLI's stdin, then closed: how a value too sensitive for the command line (an
  // MCP server's config) reaches it, since other processes can read a command line.
  stdin?: string
}

export type RunClaudeResult = { ok: true; stdout: string } | { ok: false; error: string }

function runError(
  error: Error & { code?: string | number | null; killed?: boolean },
  output: string,
  timeoutMessage: string
): string {
  if (
    error.code === 'ENOENT' ||
    /not recognized as an internal command|command not found/i.test(output)
  ) {
    return CLAUDE_NOT_FOUND_MESSAGE
  }
  if (error.killed) return timeoutMessage
  return output || error.message
}

let gate: () => string | null = () => null

// Every spawned `claude` (plugin actions, /context) comes through runClaude, so this one gate keeps
// the CLI off a missing Claude Code folder and out of the way of a relaunch. It is asked on every
// run, so a folder that vanished since the last poll is caught before the CLI writes into its path.
export function gateClaude(check: () => string | null): void {
  gate = check
}

// Separate from claude-cli.ts so callers' tests can mock CLI discovery while still exercising
// this error mapping: a call inside one ES module can't be intercepted by mocking its export.
export function runClaude(args: string[], options: RunClaudeOptions): Promise<RunClaudeResult> {
  const refusal = gate()
  if (refusal !== null) return Promise.resolve({ ok: false, error: refusal })
  const command = resolveClaudeCommand(options.cwd)
  if (command === null) return Promise.resolve({ ok: false, error: CLAUDE_NOT_FOUND_MESSAGE })
  return new Promise((resolve) => {
    const child = execFile(
      command.executable,
      [...command.prefixArguments, ...args],
      {
        shell: false,
        windowsHide: true,
        timeout: options.timeoutMs,
        ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
        env: command.environment,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd })
      },
      (error, stdout, stderr) => {
        resolve(
          error
            ? {
                ok: false,
                error: runError(error, stderr.trim() || stdout.trim(), options.timeoutMessage)
              }
            : { ok: true, stdout }
        )
      }
    )
    if (options.stdin !== undefined) {
      // A CLI that exits before reading its input makes stdin emit EPIPE; unhandled, that error
      // would crash main. The run's own exit code and output already report the failure.
      child?.stdin?.on('error', () => {})
      child?.stdin?.end(options.stdin)
    }
  })
}

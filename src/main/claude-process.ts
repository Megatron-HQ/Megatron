import { execFile } from 'child_process'
import { resolveClaudeCommand } from './claude-cli'

export const CLAUDE_NOT_FOUND_MESSAGE =
  'Claude Code CLI was not found. Install Claude Code and ensure `claude` is on your PATH.'

export interface RunClaudeOptions {
  cwd?: string
  timeoutMs: number
  timeoutMessage: string
  maxBuffer?: number
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

// Separate from claude-cli.ts so callers' tests can mock CLI discovery while still exercising
// this error mapping: a call inside one ES module can't be intercepted by mocking its export.
export function runClaude(args: string[], options: RunClaudeOptions): Promise<RunClaudeResult> {
  const command = resolveClaudeCommand(options.cwd)
  if (command === null) return Promise.resolve({ ok: false, error: CLAUDE_NOT_FOUND_MESSAGE })
  return new Promise((resolve) => {
    execFile(
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
  })
}

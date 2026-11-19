# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A desktop app for macOS and Windows built on Electron, but the UI itself is React, Tailwind, and
shadcn/ui, so it follows web design conventions, not native iOS/Android ones.)

## Users

Claude Code users who want to see what their setup holds and what their usage costs. The core case
is the power user who has accumulated many skills across global (`~/.claude/skills`), project
(`.claude/skills` in various repos), and plugin sources, and has lost track of what they have,
whether any of it is broken, shadowed, or disabled, and whether it earns the context budget it
costs. They open Megatron to answer: what skills and plugins do I have, are any misconfigured, which
ones do I actually use, and where do my tokens and API-equivalent spend go.

## Product Purpose

Inventories, lints, and tracks usage of every Claude Code skill a user has (global, project, and
plugin-installed), manages installed plugins, and analyzes local Claude Code usage: activity,
tokens, API-equivalent cost, models, per-skill cost attribution, and the Resident tax (the context a
user's global setup occupies before any prompt). Deterministic and single-purpose. Success is a user
trusting it enough to open it repeatedly, not just once at install, to catch broken or shadowed
skills before Claude Code hits them and to see which skills and sessions earn their cost.

## Positioning

Session → skill → project → time is a direct join, not an inference: every skill invocation is a
structured record in Claude Code's own transcript, carrying timestamp, cwd, and session ID alongside
it. No other Claude Code tool currently surfaces this. The same rule holds for cost and context:
dollar totals come verbatim from the cost Claude Code itself records (per-skill figures are
a proportional split of it), and the Resident tax from Claude Code's own `/context`, never
from a price table, a proxy, or an LLM call.

## Operating Context

Runs locally on macOS (Apple silicon) and Windows (x64), used alongside, not inside, a user's normal
Claude Code sessions. It reads one Claude Code config folder (`~/.claude` by default, or the folder
chosen in Settings or set by `CLAUDE_CONFIG_DIR`): its skills, plugins, session transcripts, and
prompt history, plus Claude Code's global config. Project repos are read only after the user grants
the folder (Manage Folders in the skill inventory, or Settings). Megatron keeps its own on-device
usage archive, so history outlives Claude Code's default 30-day transcript cleanup. On Windows it
reads Claude Code installed on Windows; Claude Code inside WSL is not supported. Plugin actions
shell out to `claude plugin <verb>`, the same CLI a user would run, and the Resident tax runs Claude
Code's `/context` headless (local, no API call).

## Capabilities and Constraints

- Claude Code only, permanently, not a placeholder for future multi-tool support.
- Skill inventory is read-only: Megatron never edits a skill or runs its scripts or hooks, because a
  bug in a write path would corrupt a file Claude Code executes. Plugin management (enable, disable,
  update, uninstall) is the one write capability, mediated entirely through the `claude` CLI, never
  a direct file write. Installing plugins and managing marketplaces are not in the current UI.
- Deterministic linter only (local rules, no network): no semantic or LLM-based linting, which
  would need an API key and per-scan cost.
- Cost figures are API-equivalent estimates from Claude Code's recorded cost, not subscription
  charges or invoices. Sessions with no recorded cost appear as coverage gaps, never as an estimate.
- macOS installs through Megatron's own Homebrew tap or a one-line install script; Windows through
  a per-user installer. Both update themselves in-app, never forced. Neither is notarized or
  code-signed yet. No Mac App Store (it mandates App Sandbox, which the permission model
  deliberately skips) and no Linux build. Release mechanics live in `docs/releases.md`.
- Pricing/monetization model: undecided.

## Brand Commitments

"Megatron" is the committed product name: the getmegatron.app domain, the Megatron-HQ GitHub org,
and the Homebrew tap all carry it. The shipped magnet-and-sparkle app icon is a binding asset; it
and the rest of the visual system live in `DESIGN.md`. Voice and tone are undecided and must not be
derived from the name.

## Evidence on Hand

Real: public releases on GitHub (Megatron-HQ), the getmegatron.app site, and real users on macOS
and Windows. Absent: no testimonials, quotes, user counts, usage numbers, case studies, or press.
Future work must not fabricate any of these.

## Product Principles

- Deterministic, single-purpose, no LLM calls in the core product. Skill inventory stays read-only;
  plugin management is the sole write capability, scoped to the `claude` CLI's own commands.
- Local-first and private: all data stays on-device; nothing about a user's skills or usage leaves
  their machine.
- Read Claude Code's own records rather than infer: usage from transcript joins, cost from recorded
  cost, context from `/context`. An honest gap beats an estimated number.
- Ship as a real, distributable product (MIT license, installable and self-updating on macOS and
  Windows) for other Claude Code users, not a personal script.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Ships as a native, notarized macOS desktop app via Electron, but the UI itself is built with web technologies — React, Tailwind, shadcn/ui — so it follows web design conventions, not native iOS/Android ones.)

## Users

Claude Code power users who have accumulated many skills across global (`~/.claude/skills`), project (`.claude/skills` in various repos), and plugin sources, and have lost visibility into what they have, whether any of it is broken or shadowed, and whether it's worth the context-window budget it costs. They open Megatron to answer: what skills do I have, are any misconfigured, and which ones do I actually use.

## Product Purpose

Inventories, lints, and tracks usage of every Claude Code skill a user has — global, project, and plugin-installed — deterministic, single-purpose in v1. Skill inventory itself stays strictly read-only; the one exception is plugin management (enable/disable/update/uninstall), a scoped write capability mediated entirely through the `claude` CLI's own commands, never a direct file write. Success is a user trusting the inventory enough to open it repeatedly, not just once at install, to catch broken or shadowed skills before Claude Code hits them and to see which skills earn their context budget.

## Positioning

Session → skill → project → time is a direct join, not an inference: every Skill invocation is a structured `tool_use` block in Claude Code's own transcript, carrying timestamp, cwd, and session ID alongside it. No other Claude Code tool currently surfaces this. Megatron reads that data locally and deterministically — no LLM call, no API key — rather than guessing at usage from indirect signals.

## Operating Context

Runs locally on macOS as a notarized DMG, reading only `~/.claude/{skills,plugins,projects}` (Tier 1, auto-trusted at launch) and explicitly user-granted project repo folders (Tier 2, via the sidebar's "Manage Folders" dialog). No writes to any skill file in v1 — read-only by design. Plugin management is the one write path, and it never touches `~/.claude` directly: every action shells out to `claude plugin <verb>`, the same CLI a user would run themselves. Used alongside, not inside, a user's normal Claude Code sessions.

## Capabilities and Constraints

- Claude Code only, permanently — not a placeholder for future multi-tool support.
- Skill inventory is read-only in v1 — in-app skill editing is deferred on purpose; a bug in a write path would corrupt a file Claude Code executes. Plugin management (enable/disable/update/uninstall) is the one live write capability, and it's mediated entirely through the `claude` CLI's own commands rather than a direct file write.
- macOS only, direct notarized DMG — no Mac App Store (App Sandbox conflicts with reading `~/.claude` outside any user-granted bookmark); no Windows/Linux build yet.
- Deterministic linter only — no semantic/LLM-based linting (would require an API key and per-scan cost).
- Pricing/monetization model: undecided.
- Beta/early-access distribution mechanism: undecided.

## Brand Commitments

"Megatron" is a working name with no intended brand personality or voice attached to it — tone and visual identity are undecided and should not be derived from the name.

## Evidence on Hand

None yet — no real testimonials, case studies, press, or beta-user feedback exist. Future work must not fabricate any of these.

## Product Principles

- Deterministic, single-purpose, no LLM calls in the core product. Skill inventory stays read-only; plugin management is the sole write capability, and it's scoped to the `claude` CLI's own commands rather than a speculative direct-write path.
- Local-first and private — all data stays on-device; nothing about a user's skills or usage leaves their machine.
- Session→skill→project→time is a direct join from Claude Code's own transcripts, not an inference — the mechanism a neighboring tool can't cheaply copy.
- Ship as a real, distributable product (notarized DMG, MIT license), intended for other Claude Code users, not a personal script.

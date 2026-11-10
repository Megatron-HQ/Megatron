# Megatron

Local-first desktop app that inventories, lints, and tracks usage of every Claude Code skill a user has (global, project, and plugin-installed), and manages installed plugins (enable/disable/update/uninstall via the `claude` CLI). Skill inventory is read-only in v1; plugin management is the one scoped write capability, mediated entirely through the CLI's own commands.

**Real users.** Megatron has real users on macOS and Windows (no Linux build) and is built to scale to hundreds more, each with their own `~/.claude`: different plugin sets, Claude Code versions, project counts, and data volumes. This machine is one sample. Every fix, design choice, and grill-me recommendation targets that whole population: name the edge cases, handle each one, and choose the robust option over the one that only works here.

## Gotchas

- `npm test` is vitest only. Tests for the release and packaging scripts (`scripts/*.test.mjs`) run under `npm run test:package-security`.
- `npm run db:reset` deletes only the derived index (`megatron.db`). `usage-history.db` and the folder grants in `preferences.json` survive. A `schema.sql` change rebuilds the index without it.
- `src/renderer/src/components/ui/` is shadcn-vendored — don't hand-edit.
- Path alias `@/*` → `src/renderer/src/*` must be declared in **both** `tsconfig.json` (so the `shadcn` CLI resolves it) and `tsconfig.web.json` (so the renderer actually compiles).

## Locked decisions

Repo-wide. Subsystem decisions are locked in the owning doc — see the Docs table below.

| Area              | Decision                                                                                                                                                                                              | Why                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool scope        | Claude Code only, permanently — not "not built yet"                                                                                                                                                   | Megatron's identity. Multi-tool support (the shape is `references/skills-manager`'s `tool_adapters.rs`) needs an explicit, separate decision — not quiet scope creep                                                                              |
| Module system     | ESM source only — no `require`/`module.exports`/`__dirname`/`__filename`. The generated sandbox preload is the sole CJS output exception (`out/preload/index.cjs`).                                   | Electron sandbox preloads require bundled CJS. Main, worker, renderer, and source modules remain ESM; source lint still enforces this.                                                                                                            |
| Distribution      | macOS: own Homebrew tap (`Megatron-HQ/homebrew-tap`) + direct DMG, ad-hoc signed until a Developer ID exists (then notarized) — no Mac App Store                                                      | App Store mandates App Sandbox, which the permission model deliberately skips. Without a Developer ID, Squirrel.Mac can't install updates, so the app only checks and `brew upgrade` installs                                                     |
| Generated mirrors | `AGENTS.md` (from `CLAUDE.md`) and `.agents/skills/` (from `.claude/skills/`) — never hand-edited, no symlinks                                                                                        | Git symlinks need Developer Mode **and** `core.symlinks=true` on Windows. Instead `.githooks/pre-commit` regenerates and re-stages both every commit; CI runs `node .githooks/pre-commit --check` as the backstop                                 |
| Schema changes    | `megatron.db` rebuilds itself when `schema.sql` changes (fingerprint in `PRAGMA user_version`) — never write a migration. `usage-history.db` is the opposite: additive-only, see `docs/data-model.md` | The index is a pure derived cache of `~/.claude/` (see `docs/data-model.md`); a full rescan is sub-second even at hundreds of MB of transcripts. The archive outlives Claude Code's ~30-day `history.jsonl` retention, so it can never be rebuilt |
| Renderer state    | TanStack Query for IPC-backed data, plain `useState`/Context for local UI state — no Redux/Zustand                                                                                                    | Every piece of real state so far is either Query-backed or genuinely local; no cross-cutting, deeply interdependent client-state graph exists yet that either library would solve                                                                 |
| Data table        | `@tanstack/react-table` backs the skills table; no virtualization for the table itself (`@tanstack/react-virtual` is only for the file viewer's file tree)                                            | Real `~/.claude` data is tens of skills, not thousands — the file tree's per-directory file count is the actual scaling concern                                                                                                                   |
| Table columns     | Name / Source / Description only — Path was cut                                                                                                                                                       | A truncated absolute path needing a tooltip to be legible was spending the table's widest column on data nobody read from the table itself; it lives in the file viewer's header instead                                                          |

## Exploration budget

Bound exploration by default: read the requested file plus a small number of directly related files. No blind repo-wide search unless blocked.

Carve-out: any change touching `src/main/`, `src/preload/`, or `src/shared/` must first read the relevant IPC channel definitions and `isPathAllowed()` (`src/main/permissions.ts`) — **user-data reads route through it**; fixed CLI discovery, private app-cache preparation, and packaged-asset serving use separate capabilities described in `docs/security-hardening.md`; Tier 1 (`~/.claude/{skills,plugins,projects}`) is hardcoded-allowed, Tier 2 repo folders come from `grantPath()`. These are the cross-process contract seams where a locally-correct change can silently break another process.

## Testing

TDD is required for new code in `src/main/`, `src/preload/`, and `src/shared/` — permissions, scanners, linters, db queries, IPC handlers, anything with a branch, loop, or transform. Before writing implementation code in that scope, invoke the `test-driven-development` skill (`.claude/skills/test-driven-development/`).

Exceptions: pure type definitions, constants, thin IPC pass-through wiring. `src/renderer/` is excluded entirely — no `.tsx`/jsdom in `vitest.config.ts`, intentionally. Existing untested code isn't retroactively in scope.

Renderer changes are verified by running the app (`npm run dev`) or the `visual-verify` skill — a rendering/regression smoke check, not an assertion suite. Behavioral E2E assertions are **not built**; don't claim an automated gate that doesn't exist.

Before each push, complete applicable local verification. After every push, monitor GitHub Actions for the exact pushed commit SHA and wait for **both** `check (macos-latest)` and `check (windows-latest)` to finish successfully. Do not report the commit/push task complete while either job is queued, running, failed, cancelled, or unverified. Investigate failures, fix and revalidate locally, push the correction, and verify both jobs again. Include the final commit SHA and successful CI run link in the completion report. If CI cannot be checked, state that verification is incomplete.

## Lint hygiene

A pre-existing lint error surfaced during verification gets fixed in the same session, not stepped around — the lint gate stays green. Generated output (`out/`, `dist/`) is excluded from ESLint config, never left to error.

This isn't cosmetic: ESLint enforces the ESM-only decision above, so a stray lint error can be masking a real architectural violation, not just style noise.

## Docs

A doc holds only what code can't say: locked decisions and cross-file invariants, facts about things outside the repo (Claude Code's on-disk formats, binary constants, empirical calibrations), non-goals with revisit triggers, and rejected alternatives. Anything an agent learns by opening the file it describes stays in that file; a _why_ that applies to one file is a comment there.

- **Edit in place.** Fold each change into the section it changes so the doc reads as current state. Dates belong only on empirical facts ("verified against real `~/.claude` 2026-08-16").
- **Work goes to GitHub issues, evidence to commits and CI.** A doc records what is decided.

Each doc below is authoritative for the locked decisions it owns.

| Doc                         | Covers (incl. locked decisions)                                                                                                  | Consult before                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `docs/skill-scanner.md`     | The 3 skill sources; `.agents/skills/` out of scope; symlinks; scan integrity; frontmatter parsing; token estimation; linting    | Touching skill/plugin scanning in `src/main/ingest/`, `skill-parser.ts`, or `src/main/linter/`                                     |
| `docs/transcript-ingest.md` | Transcript on-disk shapes; `isSidechain`/`subagents/` double-count rule; scan cadence; `trigger_type`                            | Touching `src/main/ingest/transcript-scanner.ts`                                                                                   |
| `docs/data-model.md`        | `better-sqlite3`; index rebuild rule; no-FK join; plugin identity; Usage project identity; `usage-history.db` additive-only      | Touching `src/main/db/` or plugin parsing                                                                                          |
| `docs/usage-analytics.md`   | Usage data sources; `cost-state` hazards and ingest; per-skill cost attribution; time placement; Resident tax                    | `src/main/ingest/` usage extraction, `src/main/db/` usage tables, or the Usage view                                                |
| `DESIGN.md`                 | Visual design system — colors, type, layout, elevation, shapes, components, app icon; the Usage chart rules and their departures | Any `src/renderer/` UI work or app-icon change                                                                                     |
| `docs/releases.md`          | Publishing on macOS/Windows: unsigned-by-default signing switch, Homebrew tap, updater behavior, upgrade paths to paid signing   | Touching `electron-builder.yml`, `scripts/release-*.mjs`, the release/tap workflows, or `src/main/updater.ts`; adding code signing |
| `docs/environment-setup.md` | M0 install quirks (npm allowlist, silent `extract-zip` no-op)                                                                    | `npm run dev` failing with `Error: Electron uninstall`                                                                             |

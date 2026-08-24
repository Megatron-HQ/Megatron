# Megatron

Local-first desktop app that inventories, lints, and tracks usage of every Claude Code skill a user has (global, project, and plugin-installed), and manages installed plugins (enable/disable/update/uninstall via the `claude` CLI). Skill inventory is read-only in v1; plugin management is the one scoped write capability, mediated entirely through the CLI's own commands.

## Commands

Full script list is in `package.json`; these are the ones with a gotcha.

| Command                 | Note                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `npm run dev`           | electron-vite dev — the normal way to run the app                 |
| `npm run build`         | typechecks **first**, then builds — a type error fails the build  |
| `npm run test`          | vitest run                                                        |
| `npm run verify:visual` | Playwright-Electron screenshots; **not** wired into `npm test`/CI |
| `npm run db`            | opens the local SQLite index in DB Browser                        |
| `npm run db:reset`      | deletes the local index — run after editing `schema.sql`, see Locked decisions |
| `npm run build:unpack`  | `--dir`, no DMG                                                   |
| `npm run build:mac`     | the actual DMG                                                    |

`postinstall` (`electron-builder install-app-deps`) and `prepare` (`git config core.hooksPath .githooks`) both run automatically on `npm install` — don't invoke them by hand.

## Stack

Electron + React + TypeScript on `electron-vite`, Tailwind v4 + shadcn/ui (`new-york`, `neutral`), TanStack Query, `better-sqlite3`, Vitest, `electron-builder`. Non-obvious parts:

- npm, **no workspaces** — single-product repo, not a monorepo.
- `package-lock.json` **is** committed; both founders and CI install off it with `npm ci`.
- Node pinned to `22.x` via `.nvmrc` and `engines` — advisory, not `engine-strict`. A warning, not a hard block.
- **Ships macOS-only** (notarized DMG). CI runs `macos-latest` + `windows-latest`, but Windows is a test target only — there is no Windows/Linux build.

## Layout

`src/main/` · `src/preload/` · `src/renderer/src/` · `src/shared/`. Two things `ls` won't tell you:

- `src/renderer/src/components/ui/` is shadcn-vendored — don't hand-edit.
- Path alias `@/*` → `src/renderer/src/*` must be declared in **both** `tsconfig.json` (so the `shadcn` CLI resolves it) and `tsconfig.web.json` (so the renderer actually compiles).

## Locked decisions

Repo-wide. Subsystem decisions are locked in the owning doc — see the Docs table below.

| Area              | Decision                                                                                                       | Why                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool scope        | Claude Code only, permanently — not "not built yet"                                                            | Megatron's identity. Multi-tool support (the shape is `references/skills-manager`'s `tool_adapters.rs`) needs an explicit, separate decision — not quiet scope creep                                              |
| Module system     | ESM only (`"type": "module"`) — no `require`/`module.exports`/`__dirname`/`__filename`                         | ESLint-enforced. Preload builds to `out/preload/index.mjs` and must stay unsandboxed to load. Use `import.meta.dirname` — electron-vite's `__dirname` shim injects `createRequire`, which is CJS                  |
| Distribution      | Direct notarized DMG, indefinitely — no Mac App Store                                                          | App Store mandates App Sandbox, which the permission model deliberately skips                                                                                                                                     |
| Generated mirrors | `AGENTS.md` (from `CLAUDE.md`) and `.agents/skills/` (from `.claude/skills/`) — never hand-edited, no symlinks | Git symlinks need Developer Mode **and** `core.symlinks=true` on Windows. Instead `.githooks/pre-commit` regenerates and re-stages both every commit; CI runs `node .githooks/pre-commit --check` as the backstop |
| Schema changes    | Delete the local index and let it rebuild — never write a migration. Run `npm run db:reset` after editing `schema.sql`, then relaunch | The index is a pure derived cache of `~/.claude/` (see `docs/data-model.md`); a full rescan is sub-second even at hundreds of MB of transcripts. In-place migration code is pure risk for a saving that doesn't exist yet |
| Renderer state    | TanStack Query for IPC-backed data, plain `useState`/Context for local UI state — no Redux/Zustand | Every piece of real state so far is either Query-backed or genuinely local; no cross-cutting, deeply interdependent client-state graph exists yet that either library would solve |
| Data table        | `@tanstack/react-table` backs the skills table; no virtualization for the table itself (`@tanstack/react-virtual` is only for the file viewer's file tree) | Real `~/.claude` data is tens of skills, not thousands — the file tree's per-directory file count is the actual scaling concern |
| Table columns      | Name / Source / Description only — Path was cut | A truncated absolute path needing a tooltip to be legible was spending the table's widest column on data nobody read from the table itself; it lives in the file viewer's header instead |

## Exploration budget

Bound exploration by default: read the requested file plus a small number of directly related files. No blind repo-wide search unless blocked.

Carve-out: any change touching `src/main/`, `src/preload/`, or `src/shared/` must first read the relevant IPC channel definitions and `isPathAllowed()` (`src/main/permissions.ts`) — **every filesystem read routes through it**; Tier 1 (`~/.claude/{skills,plugins,projects}`) is hardcoded-allowed, Tier 2 repo folders come from `grantPath()`. These are the cross-process contract seams where a locally-correct change can silently break another process.

## Testing

TDD is required for new code in `src/main/`, `src/preload/`, and `src/shared/` — permissions, scanners, linters, db queries, IPC handlers, anything with a branch, loop, or transform. Before writing implementation code in that scope, invoke the `test-driven-development` skill (`.claude/skills/test-driven-development/`).

Exceptions: pure type definitions, constants, thin IPC pass-through wiring. `src/renderer/` is excluded entirely — no `.tsx`/jsdom in `vitest.config.ts`, intentionally. Existing untested code isn't retroactively in scope.

Renderer changes are verified by running the app (`npm run dev`) or the `visual-verify` skill — a rendering/regression smoke check, not an assertion suite. Behavioral E2E assertions are **not built** (see `docs/mvp-build-spec.md`, "Deferred, on purpose"); don't claim an automated gate that doesn't exist.

## Lint hygiene

A pre-existing lint error surfaced during verification gets fixed in the same session, not stepped around — the lint gate stays green. Generated output (`out/`, `dist/`) is excluded from ESLint config, never left to error.

This isn't cosmetic: ESLint enforces the ESM-only decision above, so a stray lint error can be masking a real architectural violation, not just style noise.

## Docs

Each doc below is authoritative for the locked decisions it owns.

| Doc                         | Covers (incl. locked decisions)                                        | Consult before                                                       |
| --------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `docs/skill-scanner.md`     | The 3 skill sources; `.agents/skills/` out of scope; symlinks followed | Touching `src/main/ingest/skills-scanner.ts` or `plugin-registry.ts` |
| `docs/transcript-ingest.md` | `isSidechain`/`subagents/` double-count rule; `trigger_type`           | Touching `src/main/ingest/transcript-scanner.ts`                     |
| `docs/data-model.md`        | `better-sqlite3`; index schema; no-FK join; plugin identity            | Touching `src/main/db/` or plugin parsing                            |
| `DESIGN.md`                 | Visual design system — colors, type, layout, elevation, shapes, components | Any `src/renderer/` UI work                                          |
| `docs/mvp-build-spec.md`    | Milestones, linter rules, frontmatter parsing, what's still open       | Assuming a decision hasn't been made yet                             |
| `docs/environment-setup.md` | M0 install quirks (npm allowlist, silent `extract-zip` no-op)          | `npm run dev` failing with `Error: Electron uninstall`               |

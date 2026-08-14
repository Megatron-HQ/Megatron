# Megatron

Local-first desktop app that inventories, lints, and tracks usage of every Claude Code skill a user has (global, project, and plugin-installed). Read-only in v1.

## Commands

| Command                | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | electron-vite dev — run the app in development                  |
| `npm run start`        | electron-vite preview                                           |
| `npm run build`        | typecheck, then electron-vite build                             |
| `npm run typecheck`    | typecheck:node + typecheck:web (tsc --noEmit, split by project) |
| `npm run lint`         | eslint --cache .                                                |
| `npm run format`       | prettier --write .                                              |
| `npm run test`         | vitest run                                                      |
| `npm run build:unpack` | build, then electron-builder --dir (unpacked, no DMG)           |
| `npm run build:mac`    | build, then electron-builder --mac (the actual DMG)             |

`postinstall` (`electron-builder install-app-deps`) runs automatically on `npm install` — don't invoke it by hand. `prepare` (`git config core.hooksPath .githooks`) also runs on `npm install` — see the `AGENTS.md` row in Locked decisions.

## Stack

Electron + React + TypeScript, scaffolded with `electron-vite`. npm (no workspaces — single-product repo, not a monorepo). Tailwind v4 + shadcn/ui (`new-york` style, `neutral` base color). TanStack Query for all IPC-backed renderer state. `better-sqlite3` for the local index. Vitest for tests. `electron-builder` for a notarized DMG, macOS only — no Windows/Linux targets, no App Store lane.

`package-lock.json` **is** committed. Node is pinned to `22.x` via `.nvmrc` and `package.json` `engines` (advisory, not `engine-strict` — a warning, not a hard block). Both founders and CI (`macos-latest` + `windows-latest`) install off the same lockfile with `npm ci`.

## Layout

```text
src/main/          # app lifecycle, ipc handlers, db, permissions
src/preload/       # narrow typed bridge (contextBridge + ipcRenderer.invoke)
src/renderer/src/  # React app; components/ui/ is shadcn-vendored, don't hand-edit
src/shared/        # types/constants shared between main and preload (e.g. IPC channel names)
```

```text
Path alias `@/*` → `src/renderer/src/*`, declared in **both** `tsconfig.json` (root, so the `shadcn` CLI can resolve it) and `tsconfig.web.json` (so the renderer project actually compiles with it).

## Locked decisions

| Area | Decision | Why |
| --- | --- | --- |
| Skill sources | Three tiers: global (`~/.claude/skills`), project (`<repo>/.claude/skills`), plugin (`~/.claude/plugins/installed_plugins.json` → each entry's `installPath/skills`) | Plugin skills are read-only — silently overwritten on update |
| `.agents/skills/` | **Never** scanned — permanently out of scope, not a v1 cut | It's a Codex convention, not a Claude Code artifact. Megatron is a Claude Code tool; this isn't "deferred," it's out of scope by definition. Don't add it as an opt-in source without an explicit, separate decision to do so. (This repo's own `.agents/skills/` is still kept in sync as a generated mirror — see the row below. That's repo housekeeping, unrelated to what the scanner reads.) |
| SQLite driver | `better-sqlite3`, not `node:sqlite` | `node:sqlite` is still experimental/evolving; wrong risk for the core data layer. `better-sqlite3` v13 ships N-API prebuilds (`prebuilds/darwin-arm64.node` etc.) — no native rebuild needed on install for this platform |
| `skill_invocations` join | Text `skill_name`, **no FK** to `skills.id` | Invocations can reference skills no scan will ever find (built-ins, deleted skills, ungranted repos) — join is best-effort at query time, not enforced |
| Built-in skills | **Not a skill source, permanently.** No `builtin-skills.json`, no `source: builtin` tag | Not user-managed state — no file to point at, nothing to lint, no path to go stale, no version to track. `source_type` is a 3-way enum: `global` \| `project` \| `plugin`. Cut, not deferred — see `docs/mvp-build-spec.md` |
| Plugin identity | Key on the composite `name@marketplace`, not bare name | `installed_plugins.json` keys this way; also handles `"version": "unknown"` (non-semver) |
| Plugin → install | One-to-**many** (array), with a `scope` field (`user`/project`) | `installed_plugins.json` values are arrays, not single objects |
| Marketplace repo | Read from `known_marketplaces.json` (separate file), not `installed_plugins.json` | This is what makes the plugin-remediation milestone's "Report" deep-link to the marketplace's GitHub repo resolvable — see `docs/mvp-build-spec.md` for milestone numbering |
| Transcript double-count | Filter `isSidechain === false` when counting invocations | Field exists on every transcript line; subagent transcripts must not double-count usage stats |
| Permission chokepoint | Every filesystem read routes through `isPathAllowed()` (`src/main/permissions.ts`) | Tier 1 (`~/.claude/{skills,plugins,projects}`) is hardcoded-allowed; Tier 2 (repo folders) via `grantPath()`, wired to the onboarding picker — see `docs/mvp-build-spec.md` for milestone numbering |
| Renderer state | TanStack Query for IPC data, plain `useState`/Context for local UI state | No Redux/Zustand — not enough state complexity to justify it |
| Distribution | Direct notarized DMG, indefinitely — no Mac App Store | App Store mandates App Sandbox, which the permission model above deliberately skips |
| Module system | ESM only (`package.json` `"type": "module"`) — no `require`/`module.exports`/`__dirname`/`__filename` anywhere | Enforced by ESLint (`no-require-imports`, `no-restricted-globals` in `eslint.config.mjs`). Preload builds to `out/preload/index.mjs` and must stay unsandboxed for that to load. Use `import.meta.dirname`, not electron-vite's CJS `__dirname` shim — that shim itself injects `createRequire`, which is CommonJS |
| Generated mirrors | `AGENTS.md` (from `CLAUDE.md`) and `.agents/skills/` (from `.claude/skills/`) are generated, never hand-edited — no symlinks | Windows only materializes a git symlink with Developer Mode **and** `core.symlinks=true`; otherwise the target checks out as a text file containing the literal link string. Instead: `.githooks/pre-commit` regenerates both mirrors from the git index and re-stages them every commit (file copy for `AGENTS.md`; full copy-and-prune for `.agents/skills/`, so a deleted skill's mirror is deleted too); `npm install` points git at that hooks dir (`core.hooksPath`, via `prepare`); CI (`node .githooks/pre-commit --check`) is the backstop for anyone whose hooks aren't wired up. Only `.claude/skills/` is mirrored, not all of `.claude/` — `settings.json`/`hooks/`/local config are Claude-specific and meaningless to other agents |

## Exploration budget

Bound exploration by default: read the requested file plus a small number of directly related files. No blind repo-wide search unless blocked.

Carve-out: any change touching `src/main/`, `src/preload/`, or `src/shared/` must read the relevant IPC channel definitions and `isPathAllowed()` (`src/main/permissions.ts`) first, regardless of the general cap — these are the cross-process contract seams where a locally-correct change can silently break another process.

## Testing

TDD is required for new code in `src/main/`, `src/preload/`, and `src/shared/` — permissions, scanners, linters, db queries, IPC handlers, anything with a branch, loop, or transform. Before writing implementation code in that scope, invoke the `test-driven-development` skill (vendored at `.claude/skills/test-driven-development/`, sourced from `obra/superpowers`).

Exceptions (no test-first required): pure type definitions, constants, thin IPC pass-through wiring. `src/renderer/` is excluded entirely — UI changes are verified by running the app, not by component tests (vitest.config.ts doesn't wire up `.tsx`/jsdom, and that's intentional for now).

This applies going forward; existing untested code isn't retroactively in scope.

Verification is two-tier: Vitest covers main-process/IPC-layer logic, wired up above. Renderer changes are verified by manually running the app via `npm run dev`, or via the `visual-verify` skill (`.claude/skills/visual-verify/`) — Playwright-Electron (`playwright-core`'s `_electron`) drives the packaged app in an isolated profile and screenshots the real screens for an agent to Read back. That's a rendering/regression smoke check, not an assertion suite: it isn't wired into `npm test` or `ci.yml`, and behavioral E2E assertions are still not built (see "Deliberately not built yet") — don't claim an automated gate that doesn't exist.

## Lint hygiene

A pre-existing lint error surfaced during verification gets fixed in the same session, not stepped around — the lint gate stays green. Generated output (`out/`, `dist/`, etc.) is excluded from ESLint config, never left to error.

This isn't cosmetic here: ESLint enforces the ESM-only Locked decision (`no-require-imports`, `no-restricted-globals`) — a stray lint error can be masking a real architectural violation, not just style noise.

## Real `~/.claude` data used to validate the above

Checked against this machine's actual `~/.claude` (131 transcripts, 34 recorded Skill invocations, live `installed_plugins.json`) before scaffolding. Two things worth knowing if you're extending the scanners:

- **A 4th skill source exists in the wild, and it's not ours**: `Portfolio/.claude/skills/` and `Portfolio/.agents/skills/` both exist with 11 same-named-but-diverged skills. The `.agents/` copies are Codex's, not Claude Code's — permanently out of scope (see table above). If you're debugging "why didn't Megatron find this skill," check whether it's actually the `.agents/skills` variant before assuming the scanner is broken.
- **Skills dirs contain non-skill files** (e.g. a stray `summary.md` next to skill folders) — the scanner must key on `<dir>/SKILL.md` existing, not on every direntry.

## Environment quirks hit during M0 setup (not project bugs)

- This machine's npm (11.x) has an install-script allowlist (`npm approve-scripts`, writes an `allowScripts` block into `package.json`). It silently blocked Electron's own postinstall (which downloads the Electron binary) on first `npm install` — `npm run dev` failed with `Error: Electron uninstall`. Fixed via `npm approve-scripts electron`, which wrote a version-pinned `"allowScripts": {"electron@<version>": true}` into `package.json` (now tracked). Because `package-lock.json` is committed, everyone resolves the exact same Electron version, so this approval should just work for a fresh clone — nobody else should need to re-run `npm approve-scripts` unless the Electron version in `package.json` actually changes (e.g. a deliberate upgrade), in which case re-approve for the new pinned version. Don't blindly approve every flagged package — only ones you actually need (we skipped `electron-winstaller`, which is Windows-only and irrelevant to a macOS-only build target).
- **If you ever see `Error: Electron uninstall` when running `npm run dev`**: even after the above approval, `node_modules/electron`'s `extract-zip`-based install script silently no-op'd once in this environment (exits 0, extracts nothing, no error) despite the artifact downloading fine to the local Electron cache. Root cause wasn't pinned down — check first whether `node_modules/electron/dist/` actually contains an `Electron.app` (mac) / `electron.exe` (Windows). If it's missing, extract the cached zip manually: the cache lives at `~/Library/Caches/electron/<hash>/electron-v<version>-<platform>-<arch>.zip` on macOS (use `unzip`) or `%LOCALAPPDATA%\electron\Cache` on Windows (use `tar -xf` or PowerShell's `Expand-Archive`), into `node_modules/electron/dist/`, then write `node_modules/electron/path.txt` with the platform-relative exe path (`Electron.app/Contents/MacOS/Electron` on macOS, `electron.exe` on Windows). CI now runs on `windows-latest` too (see below) — if this is a real cross-platform issue rather than a one-off local quirk, CI should catch it on a clean install before anyone hits it manually.
- CI runs the full `typecheck`/`lint`/`test` suite on both `macos-latest` and `windows-latest` (packaging/DMG build stays macOS-only, unrelated to catching dev-environment breakage). This exists specifically because the team develops across both platforms — it's the safety net for anything platform-specific slipping through.

## Docs fan-out trigger

`docs/mvp-build-spec.md` exists — the living build spec (supersedes the original from-zero MVP PDF), kept current as milestone/schema/architecture decisions get made. Consult it for milestone numbering and anything marked "still open" there before assuming a decision hasn't been made yet.

That file is a project-wide planning doc, a different category from the per-subsystem docs below. A subsystem earns its own `docs/<name>.md` (plus this routing-table row) once its implementation detail no longer fits gracefully in the Locked-decisions table.

| Doc | Covers | Consult before |
| --- | --- | --- |
| `docs/design-system.md` | Color, typography, icons, motion, state-management scope, data-table/component-vendoring strategy, empty/loading/error states — decided before any renderer screen existed | Any `src/renderer/` UI work, starting with M2's `SkillInventory.tsx` |

Still-flagged, not yet split out: M1's scanner — the "Real `~/.claude` data used to validate the above" section above is still the candidate for its own doc now that `skills-scanner.ts` actually exists (M1 shipped), just not done yet.

## Deliberately not built yet

No stub files for M1+ modules (`skills-scanner.ts`, linter rule files, `SkillInventory.tsx`, `schema.sql`, …). They land with their milestone. A behavioral, assertion-based E2E harness is still not installed — the `visual-verify` skill (see Testing) covers the rendering-smoke-check gap, but nothing asserts on interaction outcomes or gates CI. Pricing, onboarding visual design, and beta distribution mechanism are explicitly deferred — not blockers for build work.
```

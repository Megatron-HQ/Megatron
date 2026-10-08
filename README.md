# Megatron

**A local-first desktop control center for Claude Code skills, plugins, and usage.**

Megatron inventories your global, project, and plugin skills, checks their definitions, and shows
how they are used across local Claude Code sessions. It also manages existing plugin installs
through the Claude CLI.

[![Node.js Version](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](package.json)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](package.json)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](package.json)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Current scope

- **Claude Code only.** Skills belonging to Codex or other tools, including `.agents/skills/`,
  are outside the product's inventory scope.
- **Read-only skill inspection and analytics.** Megatron does not edit skills or execute their
  scripts or hooks. Plugin enable, disable, update, and uninstall actions use Claude's own CLI.
- **macOS and Windows.** Both platforms run the development checks in CI. macOS packaging is
  configured; the intended release is a direct notarized DMG. The checked-in configuration
  currently disables notarization. Windows installer type and code signing are still undecided,
  and no `win:` block or dedicated Windows packaging script is configured. Linux is not a
  distribution target.

## Features

### Skill inventory and inspection

- Discover global skills in `~/.claude/skills/`, project skills in explicitly granted repository
  folders, and installed plugin skills from `~/.claude/plugins/`.
- Recognize Claude.ai-synced skills under `~/.claude/skills/synced/` and nested project skills in
  monorepos. Colliding nested names are directory-qualified, such as `apps/web:deploy`.
- Filter by source, project, plugin, disabled state, or user-invocable-only state. Sort the
  inventory by name, lint status, source, description, estimated listing tokens, and uses.
- Surface shadowed project skills, synced copies, declared plugin hook events, disabled skills,
  and skills that Claude cannot invoke automatically.
- Inspect Markdown, frontmatter metadata, paths, listing/body token estimates, recent invocations,
  trigger types, project usage, and the full retained invocation history.
- Explore bundled files in a resizable, searchable, virtualized file tree with Markdown rendering
  and plain-text code previews. Binary or unreadable files and preview limits have explicit states.

### Deterministic skill linting

Five local rules check `SKILL.md` without network requests or LLM calls:

| Rule                  | Checks                                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| `yaml-frontmatter`    | Missing or malformed YAML frontmatter, including unserializable metadata |
| `missing-description` | Missing or empty descriptions                                            |
| `broken-file-paths`   | Broken local Markdown links and bundled script/reference paths           |
| `missing-mcp-server`  | Referenced MCP servers absent from global or project configuration       |
| `name-collision`      | Project skills shadowed by a global skill of the same name               |

Findings appear in skill detail and file views with severity, explanation, and line numbers where
available. Scans rerun linting; unreadable documents or failed rule evaluations retain prior findings.

### Plugin inventory and management

- Group plugins by their full `name@marketplace` identity and inspect each **user**, **project**,
  or **local** install separately.
- Show installed and locally cached marketplace versions, mixed install versions, available
  updates, scope, project paths, enablement, skill counts, usage, and lint totals.
- Enable, disable, update, or uninstall an install through `claude plugin`, with an explicit scope.
  Project/local actions run from the recorded project directory and require a folder grant and
  known settings. Unreadable settings display an Unknown state; installs without a recorded
  project cannot be changed from Megatron.
- Confirm uninstall actions, report CLI errors, prevent overlapping actions on the same install,
  and refresh the inventory after success. Update feedback distinguishes a changed version from
  one already current. Updates take effect after Claude Code restarts.

Marketplace version indicators come from local marketplace data; they do not perform an online
update check. Installing new plugins and managing marketplaces are outside the current UI.

### Usage analytics

The Usage section has five panels. Activity, Cost, Models, and Skills each have independent rolling
**24-hour**, **7-day**, and **30-day** windows.

| Panel            | Current insights                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Activity**     | Prompts, sessions, active days, slash commands, chronological hourly/daily charts, weekday-by-hour punchcard, and project rankings                                        |
| **Cost**         | Estimated API-equivalent spend, model-family/version breakdown, hourly/daily trends, time-of-day punchcard, project rankings, and clickable hour/day cost details         |
| **Models**       | Logical turns, distinct models, output tokens, model and reasoning-effort rankings, and a model-by-effort matrix                                                          |
| **Skills**       | Invocations, unique skills, active sessions, trend drilldowns, top skills, trigger distribution, and proportional estimated cost attribution with a General work bucket   |
| **Resident tax** | A recent cold session's measured first-turn cache write, with estimated Skills, Agents, SessionStart hooks, MCP instructions, project instructions, and remainder context |

Invocation dialogs show timestamps, project context, trigger types, and preceding prompts. The
Usage invocation dialog supports text search and trigger filtering. Skills with an unambiguous
identity open directly; ambiguous names open a filtered invocation list.

Costs use Claude Code's recorded cumulative `cost-state`, with continuation lineages and subagent
accounting handled to avoid double-counting. Recorded cost is distributed over activity timestamps
and skills proportionally using output tokens. These breakdowns are approximate API-equivalent
estimates, not subscription charges or actual invoices. Sessions without usable cost or timestamps
are reported as coverage gaps rather than silently treated as zero spend.

Skill invocation detection covers `Skill` tool calls, harness-native skill slash commands, and
`attributionSkill` records. Triggers are classified as user-invoked, autonomous, or subagent;
user-versus-autonomous attribution is a preceding-message heuristic.

### Context budget and navigation

- Estimate skill listing and full-document tokens using the calibrated `characters / 3` heuristic.
- Show the enabled, model-invocable **global and plugin** listing budget in the Skills sidebar.
  Its reference limit is 2,666 estimated tokens, derived from an 8,000-character budget; project
  skills are excluded. The budget dialog accounts for disabled/user-invocable-only exclusions
  and surfaces heavy, unused skills.
- Search skills and plugins by name, description, project, or marketplace with **Cmd+K / Ctrl+K**.
- Open Settings with **Cmd+, / Ctrl+,** to select Light, Dark, or System appearance, manage
  repository grants, rescan, reveal the data folder, and see the app version.
- Persist appearance and the last active section. Inventory and file-tree navigation support
  keyboard controls, and the file-tree divider supports both pointer and keyboard resizing.

The listing budget is an estimate for a reference context window. Resident tax separately measures
first-turn cache creation; its category breakdowns are estimates from injected text. A suitable
cold-session sample is required before that panel can show data.

## Getting started

### Prerequisites

- **Node.js 22.x**, as specified in `.nvmrc` and `package.json`.
- **npm** and Git. Use the committed `package-lock.json` with `npm ci`.
- Local Claude Code data to populate the inventory and analytics. Plugin actions additionally
  require the `claude` executable on the PATH available to the desktop app.

### Run locally

```powershell
git clone https://github.com/Megatron-HQ/Megatron.git
cd Megatron
npm ci
npm run dev
```

Installation automatically rebuilds Electron's native dependencies and configures the Git hook.
Do not invoke `postinstall` or `prepare` separately. Dependency install-script approvals are
recorded in `package.json`.

On first launch, Megatron scans its allowed Claude Code locations. Open **Settings > Project
folders > Manage** to grant repositories containing project skills or project/local plugin settings.
The app also rescans when its window regains focus, when grants change, and after successful plugin
actions. **Settings > Rescan now** provides a manual refresh; there is no continuous filesystem watcher.

If Electron's binary is missing or startup reports `Error: Electron uninstall`, follow
[Environment setup](docs/environment-setup.md) to check install-script approval and extraction.

## Commands

| Command                  | Purpose                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run dev`            | Launch Electron with renderer hot reload                                                 |
| `npm run start`          | Preview a production build; run `npm run build` first                                    |
| `npm run build`          | Run both type checks, then build with electron-vite                                      |
| `npm run typecheck`      | Check the main/preload and renderer TypeScript projects                                  |
| `npm run typecheck:node` | Check the main/preload TypeScript project                                                |
| `npm run typecheck:web`  | Check the renderer TypeScript project                                                    |
| `npm run lint`           | Run ESLint                                                                               |
| `npm run format`         | Format the repository with Prettier                                                      |
| `npm run test`           | Run Vitest tests                                                                         |
| `npm run verify:visual`  | Build and capture Electron rendering evidence using Playwright                           |
| `npm run build:unpack`   | Build and create an unpacked app with electron-builder `--dir`                           |
| `npm run build:mac`      | Build and package for macOS using `electron-builder.yml`                                 |
| `npm run build:icons`    | Regenerate icon outputs under Electron; the macOS `.icon` remains hand-assembled         |
| `npm run db`             | Open the local index in DB Browser for SQLite on macOS, or the associated app on Windows |
| `npm run db:reset`       | Delete the local index and SQLite sidecar files; also removes repository grants          |
| `npm run explore:usage`  | Inspect real local Claude usage data and overwrite `scripts/explore-usage.report.md`     |

### Verification

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

CI runs the generated-mirror check, type checks, lint, and tests on `macos-latest` and
`windows-latest`. Packaging and visual verification are separate from those CI checks.

Vitest covers backend logic, shared utilities, and pure renderer helpers in `src/**/*.test.ts`.
React component tests and behavioral UI E2E assertions are not part of the test suite. For renderer
changes, run the app or use `npm run verify:visual`: the verifier launches an isolated profile,
checks the supported window sizes, and writes screenshots and comparison evidence to
`.visual-verify/`. Its screenshots still use local Claude data and require visual review.

## Architecture

Megatron is a single-package, ESM-only Electron application:

```text
React renderer -> typed window.api preload bridge -> Electron main process
                                                    |
                                      Permission-aware scanners and linter
                                                    |
                                          Local SQLite index

Plugin management -> validated install action -> Claude CLI -> rescan
```

| Area                 | Implementation                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Desktop and build    | Electron 43, electron-vite 5, electron-builder                                             |
| UI                   | React 19, TypeScript 5.9, Tailwind CSS v4, shadcn/ui with Radix primitives, Lucide, Motion |
| Renderer state       | TanStack Query for IPC data; React state for local UI                                      |
| Tables and file tree | TanStack Table v9; TanStack Virtual v3 for the file tree                                   |
| Storage              | better-sqlite3 and electron-store preferences                                              |
| Parsing and display  | YAML, react-markdown, remark-gfm, Geist Sans and Geist Mono                                |
| Verification         | Vitest, ESLint, Prettier, Playwright's Electron support                                    |

```text
src/main/                 App lifecycle, validated IPC, permissions, CLI actions
  db/                     SQLite schema, inventory/usage queries, cost windows
  ingest/                 Skills, plugins, transcripts, history, cost/context extraction
  linter/                 Five deterministic rules and MCP configuration resolution
src/preload/              Context-isolated, typed window.api bridge
src/renderer/src/         React views, components, charts, styles, and helpers
  components/usage/       Usage charts and drilldown dialogs
  components/ui/          Vendored shadcn/ui primitives
src/shared/               IPC contracts and version helpers
scripts/                  Database tools, icon generation, usage exploration
docs/                     Architecture, feature contracts, and setup notes
.claude/skills/           Project development workflows and visual verification
.agents/skills/           Generated mirror of project development workflows
.github/workflows/        macOS and Windows CI
build/ and resources/     Packaging resources and app icons
references/               Reference code outside the shipped application
```

### Local data, permissions, and scan integrity

Claude data reads pass through `isPathAllowed()` and permission-aware filesystem helpers:

- Tier 1 allows `~/.claude/{skills,plugins,projects}` plus the specific files
  `~/.claude.json`, `~/.claude/settings.json`, and `~/.claude/history.jsonl`.
- Tier 2 allows repository folders explicitly granted through the native folder picker.
  Revoking a grant removes its project skill rows and refreshes the inventory.
- Scanners follow symlinks rooted at allowed paths, with cycle protection. The permission check
  applies to the discovered link path.

The renderer has context isolation enabled and Node integration disabled. Its ESM preload is
unsandboxed and exposes the application API without raw IPC or environment variables. IPC checks
the trusted window's main frame, exact renderer URL, argument shapes, and matching plugin install.
Navigation outside the app is blocked; HTTP(S) links open through the external browser.

Analysis runs locally without Megatron telemetry or external LLM calls. Plugin actions delegate to
the Claude CLI, which may use the network. The local index contains invocation arguments and
preceding prompt excerpts; prompt-history rows and resident-context samples retain metadata or
numeric measurements rather than full prompt/attachment text.

Scans distinguish **complete**, **partial**, and **failed** outcomes. Unavailable reads, invalid
settings or registries, and corrupt cost snapshots preserve usable cached data while readable sources
can refresh. The app reports incomplete scans and offers rescan feedback in Settings. Transcript
caching uses file modification times, sizes,
and parser version; changed main/subagent data is reconciled transactionally, including resume
replay deduplication. The index reflects retained Claude files, not a permanent history archive.

File previews are bounded to 256 KiB per file and 4 MiB total content, with traversal limits of
1,024 files, 4,096 entries, and 32 directory levels. Omitted preview content is marked explicitly.

### Index location and recovery

The database is `megatron.db` under Electron's user data directory. Default development locations:

| Platform | Directory                                 |
| -------- | ----------------------------------------- |
| macOS    | `~/Library/Application Support/megatron/` |
| Windows  | `%APPDATA%\megatron\`                     |

Use **Settings > Reveal data folder** to locate the active profile. Preferences are stored
separately in that folder.

After a schema change or when rebuilding the index, close Megatron, run `npm run db:reset`, and
relaunch. The command removes the database and its WAL, SHM, and journal sidecars. Source skills,
plugins, and transcripts remain intact, but **repository folder grants are deleted** and must be
added again. Scanned data rebuilds from the Claude files still present. Schema changes use this
reset workflow rather than migrations.

## Development documentation

| Document                                                  | Covers                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [CLAUDE.md](CLAUDE.md)                                    | Repository rules and locked decisions; source for generated `AGENTS.md`        |
| [Design system](DESIGN.md)                                | Visual language, components, layouts, and app icons                            |
| [Skill scanner](docs/skill-scanner.md)                    | Sources, synced/nested skills, symlinks, and precedence                        |
| [Transcript ingestion](docs/transcript-ingest.md)         | Invocation detection, trigger classification, and deduplication                |
| [Data model](docs/data-model.md)                          | Index schema, plugin identity, and attribution joins                           |
| [Usage analytics](docs/usage-analytics.md)                | Data sources, cost accounting, estimates, and deferred analytics               |
| [Usage UI specification](docs/usage-view-ui-spec.md)      | Usage panel layout, chart vocabulary, tokens, and interactions                 |
| [Security and scan integrity](docs/security-hardening.md) | IPC boundaries, cache preservation, resource bounds, and verification evidence |
| [MVP build specification](docs/mvp-build-spec.md)         | Milestones, feature decisions, and testing scope                               |
| [Environment setup](docs/environment-setup.md)            | Electron installation troubleshooting                                          |

Edit `CLAUDE.md` and `.claude/skills/` as the instruction sources. The pre-commit hook regenerates
and stages `AGENTS.md` and `.agents/skills/`; CI checks that those mirrors match. Do not hand-edit
the generated copies or vendored `components/ui/` files.

## Founders

- **Vijay Sai Chigullapally** — Co-founder
- **Sairithik Komuravelly** — Co-founder

## License

[MIT](LICENSE).

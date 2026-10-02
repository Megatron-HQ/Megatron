# Megatron

<div align="center">

**The local-first desktop control center for Claude Code skills, plugins, and usage analytics.**<br />
Inventory, inspect, lint, and track usage across all your global, project, and plugin skills. Manage user-scoped plugins without leaving the app.

[![Node.js Version](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Overview

When using **Claude Code**, capabilities and sessions expand rapidly across multiple environments:

- **Global Skills** in `~/.claude/skills/`
- **Project Skills** scoped inside your git repositories (`<repo>/.claude/skills/`)
- **Plugin Skills** installed through Claude marketplaces (`~/.claude/plugins/`)
- **Session Transcripts & History** recorded locally in `~/.claude/projects/*/*.jsonl` and `history.jsonl`

**Megatron** gives developers complete visibility and confidence over their agent capabilities. It scans your skill ecosystem in milliseconds, indexes metadata in a local SQLite database, lints skill definitions against 5 deterministic rules, allows instant code exploration, classifies how skills are triggered, and provides a full-featured analytics suite covering prompt activity, API-equivalent costs, model effort matrices, skill cost attribution, and cold-start context overhead.

Megatron is read-only for skill inventory and usage telemetry. Its only scoped write capability is managing user-scoped Claude Code plugins through the Claude CLI's own enable, disable, update, and uninstall commands.

### Scope and platform

- **Claude Code only**: Megatron inventories and analyzes Claude Code skills and transcripts; it does not track skills from Codex or other agent tools.
- **macOS distribution**: v1 ships as a direct, notarized macOS DMG. Windows is supported for development and CI verification, not as a distributable target.
- **Plugin management**: Enable, disable, update, and uninstall are available for user-scoped Claude Code plugins. Project-scoped plugin actions are not yet supported end to end.

---

## Key Features

### 🔍 Unified Skill Inventory

- Real-time catalog of all skills across **Global**, **Project**, and **Plugin** sources.
- Native support for **Claude.ai Synced Skills** (`~/.claude/skills/synced/`) with dedicated indicators and lowest-priority source precedence.
- Recursive detection for **Monorepo / Nested Skills** with automatic directory qualification upon name collisions (e.g. `apps/web:deploy`).
- Displays dynamic source badges with repository names, plugin packages, read-only locks, and declared hook indicators.
- Status badges (`Valid`, `Warnings`, `Errors`) highlighting skill health at a glance.
- Visual warning badges for shadowed project skills overridden by same-named global skills.
- Fluid active-state animations and keyboard navigation (Arrow keys, Enter, Esc).
- Instant multi-column sorting (by name, status, source, description, tokens, and uses).

### 🛠️ Deterministic Skill Linter

- Runs synchronously on startup, folder grant, and folder revocation with zero external network requests.
- Validates skill health against 5 deterministic rules:
  1. **YAML Frontmatter (`yaml-frontmatter`)**: Detects missing or malformed YAML frontmatter blocks in `SKILL.md`.
  2. **Missing Description (`missing-description`)**: Flags empty or absent descriptions required for Claude Code auto-trigger matching.
  3. **Broken File Paths (`broken-file-paths`)**: Validates markdown link targets and bundled script/reference asset paths on disk.
  4. **Missing MCP Servers (`missing-mcp-server`)**: Cross-references referenced MCP tools (`mcp__<server>__*`) against `~/.claude.json` and project `.mcp.json` configurations.
  5. **Name Collision & Shadowing (`name-collision`)**: Warns when project skills shadow global skills or share conflicting names.
- Interactive `LintFindingsPanel` in both Skill Detail and File Viewer views with precise line numbers and explanations.

### 📈 Usage Analytics Dashboard

Megatron includes a comprehensive local analytics engine with a secondary 220px navigation sidebar featuring 5 dedicated insight panels:

- **Activity**:
  - Independent rolling window controls (**24 hours**, **7 days**, **30 days**).
  - Prompt volume, active days, session counts, and slash command usage stats.
  - Interactive 24-hour chronological hourly prompt bar chart.
  - Daily prompt volume strip with weekend bands and interactive cursor scrubbing.
  - 7×24 weekday-by-hour punchcard highlighting work rhythms and session clustering.
  - Ranked project breakdown showing where your prompts land.
- **Cost**:
  - Estimated API-equivalent cost computed across all cost-tracked session history.
  - Multi-color spend bar direct-labeled by model family (Sonnet, Opus, Haiku) using a CVD-validated categorical palette.
  - Daily cost trend strip with weekend shading and today-so-far outline indicators.
  - Ranked project cost distribution with ambient row fills and full-path tooltips.
- **Models**:
  - Logical turn counts, distinct models, and output token volume across 24h, 7d, and 30d windows.
  - Ranked breakdown of turns by model and by reasoning effort tier (`xhigh`, `high`, `medium`, `low`, and `not_recorded`).
  - Semantic **Model × Effort** matrix with column totals and horizontal scrolling.
- **Skills**:
  - Invocation volume, unique skills exercised, and active session metrics per window.
  - Interactive **Invocations over time** trend chart with click-through drilldown into a chronological timeline modal (`SkillInvocationDialog`), showing exact timestamps, project basenames, trigger badges, and preceding prompt texts.
  - **Top skills** ranking with automated disambiguation: opens skill details for unambiguous skills and opens a filtered invocation dialog for skills sharing identical names across multiple repositories.
  - Invocation trigger distribution (User-invoked, Autonomous, and Subagent).
  - Proportional **Estimated cost attribution** table using output-token weighting, largest-remainder cent allocation, and explicit general work accounting.
- **Resident Tax**:
  - Measures true cold-start context consumption from first-turn `cache_creation_input_tokens`.
  - Additive monochrome composition bar itemized into 6 ledger categories: Skills, Agents, SessionStart Hooks, MCP Instructions, Project Instructions, and Remainder context.
  - Sample provenance detailing sample time, project basename, normalized model, and Claude Code version.

### 📋 Skill Detail & Context Budget Estimator

- Master-detail view with rich Markdown previewing, copyable commands, and formatted metadata.
- **Token Budget Metrics**: Calculates estimated listing tokens (frontmatter description loaded into Claude system prompt) and estimated body tokens (`chars / 3.0` rounding, empirically calibrated against Claude Code's own `/context` output).
- **Context Budget Triage Dialog**: Real-time sidebar readout and interactive `ContextBudgetDialog` measuring total resident listing tokens against the Claude Code 2,666-token limit, surfacing over/under-budget status and "Never used, heaviest first" triage.
- **Invocation Analytics**: Real-time breakdown of total uses, manual vs. auto vs. subagent invocations, and per-project usage distribution.
- **Plugin Hooks Manifest Detection**: Displays declared hook event subscriptions (e.g. `SessionStart`) parsed from `.claude-plugin/plugin.json`.

### 🧩 Plugin Inventory & Management

- Dedicated plugin inventory with marketplace, installed version, scope, skill count, and enabled or disabled status.
- Plugin detail view rolls up the skills it provides, their usage, and lint health.
- Enable, disable, update, or uninstall user-scoped plugins through the local Claude CLI; Megatron refreshes the inventory after each successful action.
- Version-aware update feedback clearly distinguishes a plugin already at the latest version from one updated to a newer version.
- Success confirmations appear in a compact bottom-right stack for three seconds, can be dismissed manually, and keep up to three recent actions visible.

### 🛡️ Tier-2 Repo Folder Management

- Explicit permission boundary: auto-trusts Tier 1 (`~/.claude/*`) while requiring explicit user consent (Tier 2) to scan project repositories.
- Built-in folder manager modal to add repository folders or revoke permissions with automatic index cleanup.

### 📂 Interactive Skill Explorer & Code Previewer

- Fast split-pane view with a resizable divider.
- Virtualized directory tree powered by `@tanstack/react-virtual` with real-time file filtering.
- Syntax-highlighted code viewer with binary file detection and size guards.

### ⚡ Spotlight Command Palette (`⌘K` / `Ctrl+K`)

- Instant fuzzy search across skill names, descriptions, project names, plugin names, and plugin marketplaces.
- Jump directly into any skill detail or file from anywhere in the app.

### 📊 Transcript Ingestion & Trigger Classification

- Scans Claude Code session transcripts (`~/.claude/projects/*/*.jsonl`) and dedicated subagent sessions (`subagents/*.jsonl`).
- Differentiates 3 distinct trigger classifications: **Manual** (`user_invoked`), **Auto** (`autonomous`), and **Subagent** (`subagent`).
- Subagent double-count protection (`isSidechain === false` on parent sessions) and timestamp mtime-skipping for zero-overhead background scanning.

### 🌓 Clean Modern UI & Theme Support

- Dark mode and Light mode with persistent state storage.
- Custom typography using Geist Sans & Geist Mono.
- Fully accessible with Radix UI primitives and TanStack table models.

---

## System Architecture

Megatron follows a secure multi-process Electron architecture:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                       RENDERER                                         │
│   React 19  •  TanStack Query / Table / Virtual  •  Tailwind CSS v4  •  Motion          │
│   Navigation: AppRail (Skills • Plugins • Usage)  •  UsageSidebar                      │
│   Views: SkillInventory  •  SkillDetail  •  PluginInventory  •  PluginDetail           │
│          SkillFileViewer  •  UsageView (Activity, Cost, Models, Skills, Resident Tax)  │
│   Modals: ContextBudgetDialog  •  SkillActivityDialog  •  SkillInvocationDialog         │
│           ManageFoldersDialog  •  SettingsDialog       •  CommandPalette               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ (Typed IPC via contextBridge)
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                                       PRELOAD                                          │
│   Narrow secure bridge exposing window.api (src/preload/index.ts)                      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                                     MAIN PROCESS                                       │
│  ┌────────────────────────┐  ┌──────────────────────────────────────────────────────┐  │
│  │ Permission Chokepoint  │  │ SQLite Database (better-sqlite3)                     │  │
│  │ isPathAllowed()        │  │ • skills, sessions_meta, skill_invocations           │  │
│  │ grantPath()            │  │ • plugin_registry, allowed_paths, lint_findings      │  │
│  │ revokePath()           │  │ • session_cost, session_model_cost, turn_usage       │  │
│  │                        │  │ • session_skill_cost, resident_context_sample       │  │
│  │                        │  │ • prompt_history                                     │  │
│  └───────────┬────────────┘  └──────────────────────────┬───────────────────────────┘  │
│              │                                          │                              │
│  ┌───────────▼──────────────────────────────────────────▼───────────────────────────┐  │
│  │ Ingestion & Analysis Engines (Local-first, zero cloud telemetry)                  │  │
│  │ • Skills Scanner        • Plugin Registry        • Plugin Actions (Claude CLI)   │  │
│  │ • Transcript Ingest     • Cost-State Parser      • Turn-Usage Extractor          │  │
│  │ • Prompt History Parser • Skill Cost Allocator   • Resident Context Analyzer     │  │
│  │ • Deterministic Linter (5 static rules + MCP config resolver)                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Security & Privacy

- **Single Permission Chokepoint**: Every filesystem access routes strictly through `isPathAllowed()`.
- **Local Analysis**: Linting, parsing, and trigger analysis are deterministic and local, with no external LLM calls or Megatron telemetry. Plugin actions are delegated to the user's local Claude CLI.
- **Transient Local Index**: The SQLite database (`megatron.db`) is purely a regenerable cache; deleting it causes zero data loss.

---

## Tech Stack

| Layer                       | Technologies                                                                                                                                                                          |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop Shell**           | [Electron 43](https://www.electronjs.org/), [electron-vite 5](https://electron-vite.org/)                                                                                             |
| **UI Framework**            | [React 19](https://react.dev/), [TypeScript 5.9](https://www.typescriptlang.org/)                                                                                                     |
| **Styling & Components**    | [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Lucide Icons](https://lucide.dev/), [Motion](https://motion.dev/)                                  |
| **Data Layer**              | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [TanStack React Query v5](https://tanstack.com/query), [electron-store](https://github.com/sindresorhus/electron-store) |
| **Tables & Virtualization** | [TanStack React Table v9](https://tanstack.com/table), [TanStack React Virtual v3](https://tanstack.com/virtual)                                                                      |
| **Parsing & Rendering**     | [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [yaml](https://eemeli.org/yaml/)                                  |
| **Testing & Tooling**       | [Vitest](https://vitest.dev/), [ESLint 9](https://eslint.org/), [Prettier](https://prettier.io/), [Playwright-Electron](https://playwright.dev/)                                      |

---

## Directory Structure

```text
src/
├── main/                          # Electron main process
│   ├── db/                        # SQLite schemas, initialization, and queries
│   │   ├── index.ts               # Database connection and initialization
│   │   ├── schema.sql             # Table schemas, indexes, and views
│   │   └── queries.ts             # Typed database read/write queries
│   ├── ingest/                    # Ingestion and parsing engines
│   │   ├── skills-scanner.ts      # Global, project, synced, and nested skill scanner
│   │   ├── plugin-registry.ts     # Marketplace plugin registry and cache reader
│   │   ├── transcript-scanner.ts  # Session transcript and subagent parser
│   │   ├── prompt-history-scanner.ts # History.jsonl reader and slash-command classifier
│   │   ├── cost-parser.ts         # Cost-state and turn-usage extractor
│   │   ├── skill-cost-allocation.ts # Proportional session and timed skill cost engine
│   │   ├── resident-context-parser.ts # Cold-session context attachment analyzer
│   │   ├── claude-settings.ts     # Settings and enablement resolver
│   │   ├── token-estimate.ts      # Calibrated token calculation
│   │   └── scan-all.ts            # Sequential scan orchestrator
│   ├── linter/                    # Deterministic skill linter engine
│   │   ├── rules/                 # Static rules (yaml, description, paths, mcp, collisions)
│   │   ├── frontmatter.ts         # Robust YAML frontmatter parser
│   │   ├── mcp-config.ts          # Global & project MCP config reader
│   │   └── index.ts               # Linter runner and finding reporter
│   ├── chromium-cache.ts          # Disables Chromium HTTP cache for local bundle reliability
│   ├── index.ts                   # Application lifecycle and IPC handlers
│   ├── plugin-actions.ts          # Cross-platform Claude CLI plugin execution
│   ├── permissions.ts             # Path validation and permission chokepoint
│   ├── shell.ts                   # Protocol validation and external link opener
│   ├── skill-files.ts             # Directory tree walk and file preview reader
│   └── theme.ts                   # Theme and active section persistence
├── preload/                       # Context-isolated IPC bridge
│   ├── index.ts                   # window.api exposure
│   └── index.d.ts                 # Global TypeScript declarations
├── renderer/src/                  # React application
│   ├── components/                # Reusable UI components
│   │   ├── usage/                 # Usage analytics charts, punchcards, and sections
│   │   ├── ui/                    # shadcn/ui primitives
│   │   ├── AppRail.tsx            # Primary navigation rail (Skills, Plugins, Usage)
│   │   ├── Sidebar.tsx            # Skills filter and budget sidebar
│   │   ├── PluginSidebar.tsx      # Plugins filter sidebar
│   │   ├── UsageSidebar.tsx       # Usage panels sidebar
│   │   ├── CommandPalette.tsx     # Spotlight search dialog
│   │   ├── ContextBudgetDialog.tsx # Listing token budget triage modal
│   │   ├── ManageFoldersDialog.tsx # Repository grant management modal
│   │   ├── SettingsDialog.tsx     # App settings modal
│   │   ├── SkillActivityDialog.tsx # Lifetime invocation history modal (single skill)
│   │   └── LintFindingsPanel.tsx  # Linter findings list
│   ├── views/                     # Main view routers
│   │   ├── SkillInventory.tsx     # Skills data table
│   │   ├── SkillDetail.tsx        # Skill metadata and overview
│   │   ├── SkillFileViewer.tsx    # Virtualized file explorer and code preview
│   │   ├── PluginInventory.tsx    # Plugins data table
│   │   ├── PluginDetail.tsx       # Plugin overview and provided skills
│   │   └── UsageView.tsx          # Usage analytics dashboard
│   ├── lib/                       # Pure utility helpers
│   └── App.tsx                    # Root application component
└── shared/                        # Shared contracts between Main, Preload, and Renderer
    ├── ipc.ts                     # Type definitions and IPC channel constants
    └── version.ts                 # Semantic version helpers
```

---

## Getting Started

### Prerequisites

- **Node.js**: `^22.0.0` (managed via `.nvmrc`)
- **npm**: `^10.0.0` or `^11.0.0`

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/Megatron-HQ/Megatron.git
   cd Megatron
   ```

2. **Install the locked dependencies**:

   ```bash
   npm ci
   ```

   _(Git hooks and Electron app dependencies configure automatically.)_

3. **Run in development mode**:
   ```bash
   npm run dev
   ```

---

## Available Commands

| Command                 | Description                                                  |
| :---------------------- | :----------------------------------------------------------- |
| `npm run dev`           | Launch Electron app with Hot Module Replacement (HMR)        |
| `npm run start`         | Preview the production build with electron-vite              |
| `npm run build`         | Run typechecks and build production bundle                   |
| `npm run typecheck`     | Run TypeScript validation across both Node and Web projects  |
| `npm run lint`          | Run ESLint across all files                                  |
| `npm run format`        | Format the entire codebase with Prettier                     |
| `npm run test`          | Run unit and integration test suite with Vitest              |
| `npm run verify:visual` | Run visual smoke tests via Playwright-Electron               |
| `npm run build:unpack`  | Create unpacked application build                            |
| `npm run build:mac`     | Package distributable macOS DMG                              |
| `npm run db`            | Open the local SQLite index in DB Browser for SQLite (macOS) |
| `npm run db:reset`      | Reset and delete the local SQLite index cache                |
| `npm run explore:usage` | Run local usage and cost data exploration harness            |

---

## Founders

Megatron is built by:

- **Vijay Sai Chigullapally** — Co-founder
- **Sairithik Komuravelly** — Co-founder

---

## License

This project is licensed under the [MIT License](LICENSE).

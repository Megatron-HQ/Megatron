# Megatron

<div align="center">

**The local-first desktop control center for Claude Code skills.**  
Inventory, inspect, lint, and track usage across all your global, project, and plugin skills.

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

When using **Claude Code**, capabilities expand rapidly across multiple environments:

- **Global Skills** in `~/.claude/skills/`
- **Project Skills** scoped inside your git repositories (`<repo>/.claude/skills/`)
- **Plugin Skills** installed through Claude marketplaces (`~/.claude/plugins/`)

**Megatron** gives developers complete visibility and confidence over their agent capabilities. It scans your skill ecosystem in milliseconds, indexes metadata in a local SQLite database, lints skill definitions against 5 deterministic rules, allows instant code exploration, and classifies how your skills are triggered during real coding sessions.

Megatron is strictly **read-only in v1**—it discovers and analyzes disk state without mutating your `~/.claude` directory.

### Scope and platform

- **Claude Code only**: Megatron inventories and analyzes Claude Code skills and transcripts; it does not track skills from Codex or other agent tools.
- **macOS distribution**: v1 ships as a direct, notarized macOS DMG. Windows is supported for development and CI verification, not as a distributable target.

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

### 📋 Skill Detail & Context Budget Estimator

- Master-detail view with rich Markdown previewing, copyable commands, and formatted metadata.
- **Token Budget Metrics**: Calculates estimated listing tokens (frontmatter description loaded into Claude system prompt) and estimated body tokens (`chars / 4` rounding matching Claude Code binary logic).
- **Context Budget Triage Dialog**: Real-time sidebar readout and interactive `ContextBudgetDialog` measuring total resident listing tokens against the Claude Code 2,000-token limit, surfacing over/under-budget status and "Never used, heaviest first" triage.
- **Invocation Analytics**: Real-time breakdown of total uses, manual vs. auto vs. subagent invocations, and per-project usage distribution.
- **Plugin Hooks Manifest Detection**: Displays declared hook event subscriptions (e.g. `SessionStart`) parsed from `.claude-plugin/plugin.json`.

### 🛡️ Tier-2 Repo Folder Management

- Explicit permission boundary: auto-trusts Tier 1 (`~/.claude/*`) while requiring explicit user consent (Tier 2) to scan project repositories.
- Built-in folder manager modal to add repository folders or revoke permissions with automatic index cleanup.

### 📂 Interactive Skill Explorer & Code Previewer

- Fast split-pane view with a resizable divider.
- Virtualized directory tree powered by `@tanstack/react-virtual` with real-time file filtering.
- Syntax-highlighted code viewer with binary file detection and size guards.

### ⚡ Spotlight Command Palette (`⌘K` / `Ctrl+K`)

- Instant fuzzy search across skill names, descriptions, project names, and plugin marketplaces.
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
│   React 19  •  TanStack Query / Table / Virtual  •  Tailwind CSS v4                    │
│   Views: SkillInventory  •  SkillDetail  •  SkillFileViewer  •  ManageFoldersDialog    │
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
│  │ isPathAllowed()        │  │ skills, sessions_meta, skill_invocations,            │  │
│  │                        │  │ plugin_registry, allowed_paths, lint_findings        │  │
│  └───────────┬────────────┘  └──────────────────────────┬───────────────────────────┘  │
│              │                                          │                              │
│  ┌───────────▼──────────────────────────────────────────▼───────────────────────────┐  │
│  │ Ingestion & Analysis Engine                                                      │  │
│  │ • Skills Scanner        • Plugin Registry        • Transcript Ingest             │  │
│  │ • Deterministic Linter (5 static rules + MCP config resolver)                    │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Security & Privacy

- **Single Permission Chokepoint**: Every filesystem access routes strictly through `isPathAllowed()`.
- **Zero API Key Requirement**: All linting, parsing, and trigger analysis is 100% deterministic (no external LLM calls, zero telemetry, zero data egress).
- **Transient Local Index**: The SQLite database (`megatron.db`) is purely a regenerable cache; deleting it causes zero data loss.

---

## Tech Stack

| Layer                       | Technologies                                                                                                                                         |
| :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop Shell**           | [Electron 43](https://www.electronjs.org/), [electron-vite](https://electron-vite.org/)                                                              |
| **UI Framework**            | [React 19](https://react.dev/), [TypeScript 5.9](https://www.typescriptlang.org/)                                                                    |
| **Styling & Components**    | [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Lucide Icons](https://lucide.dev/), [Motion](https://motion.dev/) |
| **Data Layer**              | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [TanStack React Query v5](https://tanstack.com/query)                                  |
| **Tables & Virtualization** | [TanStack React Table v9](https://tanstack.com/table), [TanStack React Virtual v3](https://tanstack.com/virtual)                                     |
| **Testing & Tooling**       | [Vitest](https://vitest.dev/), [ESLint 9](https://eslint.org/), [Prettier](https://prettier.io/), [Playwright-Electron](https://playwright.dev/)     |

---

## Directory Structure

```text
src/
├── main/                          # Electron main process
│   ├── db/                        # SQLite schemas, column retrofits, and queries
│   ├── ingest/                    # Ingestion workers (skills, plugins, transcripts)
│   ├── linter/                    # Deterministic skill linter engine
│   │   ├── rules/                 # 5 static rules (yaml, description, paths, mcp, collisions)
│   │   ├── frontmatter.ts         # Robust YAML frontmatter parser
│   │   ├── mcp-config.ts          # Global & project MCP config reader
│   │   └── index.ts               # Orchestrator & multi-skill runner
│   ├── index.ts                   # Application lifecycle and IPC handlers
│   ├── permissions.ts             # Path validation and permission chokepoint
│   ├── shell.ts                   # Protocol validation and safe external link opener
│   ├── skill-files.ts             # Recursive directory walk and file preview reader
│   └── theme.ts                   # Theme resolution and persistence
├── preload/                       # Context-isolated IPC bridge
│   ├── index.ts                   # window.api exposure
│   └── index.d.ts                 # Global TypeScript declarations
├── renderer/src/                  # React application
│   ├── components/                # Reusable UI components (ContextBudgetDialog, LintFindingsPanel, etc.)
│   ├── views/                     # Main view routers (SkillInventory, SkillDetail, SkillFileViewer)
│   ├── lib/                       # Pure utility helpers (file-tree, source-name, glide-highlight)
│   └── App.tsx                    # Root application component
└── shared/                        # Shared contracts between Main, Preload, and Renderer
    └── ipc.ts                     # Type definitions and IPC channel constants
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

---

## Founders

Megatron is built by:

- **Vijay Sai Chigullapally** — Co-founder
- **Sairithik Komuravelly** — Co-founder

---

## License

This project is licensed under the [MIT License](LICENSE).

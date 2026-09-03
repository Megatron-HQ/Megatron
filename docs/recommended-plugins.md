# Recommended Claude Code Plugins for Megatron

This document outlines the top 5 Claude Code plugins tailored specifically for the Megatron codebase, their recommended installation scopes, and their technical rationale.

---

## Scope Strategy: Team vs. Local

In Claude Code, plugins can be installed at different scopes:

| Scope                  | Command Flag      | Location                                                | Best For                                                                                                                              |
| ---------------------- | ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Project (Team)**     | `--scope project` | Repository configuration (`.claude/`)                   | Shared tooling, project-wide standards, language servers, and team workflows checked into git.                                        |
| **Local (Individual)** | `--scope local`   | Personal machine config (`.claude/settings.local.json`) | Individual developer ergonomics, local testing environments, personal git preferences, or tools with heavy local binary dependencies. |

---

## Priority Recommendations: Team & Local

### 1. Priority for Team & Core Architecture (`--scope project`): `typescript-lsp`

- **Why**: Megatron is a 100% strict TypeScript application split across Electron main (Node.js), preload (bridge), and renderer (React 19 / Vite) with distinct tsconfigs ([`tsconfig.node.json`](file:///C:/Megatron/tsconfig.node.json) and [`tsconfig.web.json`](file:///C:/Megatron/tsconfig.web.json)).
- **Team Impact**: Cross-process IPC contracts ([`src/shared/ipc.ts`](file:///C:/Megatron/src/shared/ipc.ts)) and permission checks ([`src/main/permissions.ts`](file:///C:/Megatron/src/main/permissions.ts)) require exact type alignment. Having `typescript-lsp` active for everyone on the project guarantees Claude Code has real-time compiler diagnostics, preventing type hallucinations and broken IPC signatures before code is even committed.
- **Install**:
  ```bash
  claude plugin install typescript-lsp --scope project
  ```

### 2. Priority for Team & Frontend Development (`--scope project`): `playwright`

- **Why**: Megatron features an automated visual regression suite (`npm run verify:visual`, `playwright-core`, pixelmatch) with baselines in `.visual-verify-baselines/`.
- **Team Impact**: For teammates building and refining the React 19 UI ([`src/renderer/src/`](file:///C:/Megatron/src/renderer/src/)), `playwright` provides Claude with live browser automation, element interaction, and screenshot verification to validate views and prevent UI regressions.
- **Install**:
  ```bash
  claude plugin install playwright --scope project
  ```

### 3. Priority for Local Developer (`--scope local`): `commit-commands`

- **Why**: Megatron maintains strict pre-commit hooks (`.githooks/pre-commit`) that automatically run to verify and regenerate mirrors (`AGENTS.md` and `.agents/skills`).
- **Local Impact**: Git commit and pull-request habits are personal to each developer's workflow. Installing `commit-commands` locally provides slash commands like `/commit` and `/commit-push-pr` to help draft concise, structured commit messages that pass repository hooks—without forcing Claude commit tools onto teammates who prefer standard command-line or GUI git workflows.
- **Install**:
  ```bash
  claude plugin install commit-commands --scope local
  ```

---

## The 5 Essential Plugins for Megatron

### 1. `typescript-lsp` (Language Server Protocol)

- **Marketplace**: `claude-plugins-official`
- **Recommended Scope**: `project` (Team)
- **Purpose**: Provides real-time TypeScript compilation errors, type inference, go-to-definition, and symbol navigation across Electron main, preload, and web processes.
- **Command**:
  ```bash
  claude plugin install typescript-lsp --scope project
  ```

### 2. `playwright` (UI Automation & Visual Verification)

- **Marketplace**: `claude-plugins-official` (external)
- **Recommended Scope**: `project` (Team)
- **Purpose**: Powers browser automation, UI testing, and snapshot verification to support Megatron's visual testing workflows across all frontend developers.
- **Command**:
  ```bash
  claude plugin install playwright --scope project
  ```

### 3. `frontend-design` (UI & Design System Conformance)

- **Marketplace**: `claude-plugins-official`
- **Recommended Scope**: `project` (Team)
- **Purpose**: Megatron follows a strict visual design specification ([`DESIGN.md`](file:///C:/Megatron/DESIGN.md)) with Geist typography, Tailwind CSS v4 tokens, and shadcn/ui components. This plugin guides Claude to produce production-grade, design-system-compliant UI.
- **Command**:
  ```bash
  claude plugin install frontend-design --scope project
  ```

### 4. `plugin-dev` (Claude Code Plugin Development & Validation)

- **Marketplace**: `claude-plugins-official`
- **Recommended Scope**: `project` (Team)
- **Purpose**: Megatron's primary domain is reading and managing Claude Code plugins (`.claude-plugin/plugin.json`, hook manifests, `known_marketplaces.json`). This plugin provides built-in validation tools (`claude plugin validate`) and schema authoring helpers directly matching Megatron's internal models.
- **Command**:
  ```bash
  claude plugin install plugin-dev --scope project
  ```

### 5. `commit-commands` (Structured Git & Hook Hygiene)

- **Marketplace**: `claude-plugins-official`
- **Recommended Scope**: `local` or `project`
- **Purpose**: Megatron maintains strict pre-commit hooks (`.githooks/pre-commit`) that regenerate and restage mirrored files (`AGENTS.md` and `.agents/skills`). This plugin provides structured `/commit` and PR workflows that respect repository hooks.
- **Command**:
  ```bash
  claude plugin install commit-commands --scope project
  ```

---

## Management Cheatsheet

```bash
# List all active plugins and their scopes
claude plugin list

# Check status or details of a specific plugin
claude plugin details <plugin-name>

# Update a project-scoped plugin
claude plugin update <plugin-name> --scope project

# Temporarily disable a plugin
claude plugin disable <plugin-name> --scope project
```

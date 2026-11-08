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
- **macOS (Apple silicon) and Windows (x64).** Releases ship as an ad-hoc signed DMG and Homebrew
  cask on macOS and a per-user NSIS installer on Windows. Neither is notarized or code-signed yet;
  see [Install](#install). Both platforms run the development checks in CI. Linux is not a
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

The Usage section has seven panels. Activity, Tokens, Cost, Models, and Skills each have independent
rolling **24-hour**, **7-day**, and **30-day** windows; History picks a calendar year.

| Panel            | Current insights                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Activity**     | Prompts, sessions, active days, slash commands, chronological hourly/daily charts, weekday-by-hour punchcard, and project rankings                                        |
| **History**      | An annual prompt contribution calendar, year-in-review readouts (active days, longest streak, busiest day), a project-by-month timeline, and day details                  |
| **Tokens**       | Total tokens processed, input/output/cache-read/cache-write readouts, an hourly or daily trend, and model and project rankings                                            |
| **Cost**         | Estimated API-equivalent spend, model-family/version breakdown, hourly/daily trends, time-of-day punchcard, project rankings, and clickable hour/day cost details         |
| **Models**       | Logical turns, distinct models, output tokens, model and reasoning-effort rankings, and a model-by-effort matrix                                                          |
| **Skills**       | Invocations, unique skills, active sessions, trend drilldowns, top skills, trigger distribution, and proportional estimated cost attribution with a General work bucket   |
| **Resident tax** | Claude Code's own `/context` for your global setup: used / window, every category, and drill-ins down to every skill, MCP tool, system-prompt block, and tool JSON schema |

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

The listing budget is an estimate for a reference context window. Resident tax instead runs
Claude Code's `/context` headless (`claude -p "/context" --no-session-persistence`, no API call)
from an empty folder, so it shows the measured global baseline. Its per-item detail comes from your
newest interactive session's recorded request (Claude Code 2.1.300+).

## Install

### macOS (Apple silicon)

Install with Homebrew, which is also how you upgrade:

```sh
brew install --cask megatron-hq/tap/megatron
```

Or download `megatron-<version>.dmg` from
[Releases](https://github.com/Megatron-HQ/Megatron/releases/latest), drag Megatron to Applications,
and open it. Megatron isn't notarized yet, so macOS blocks the first launch: open **System Settings >
Privacy & Security**, find the message about Megatron, and click **Open Anyway**.

### Windows (x64)

Download `megatron-<version>-setup.exe` from
[Releases](https://github.com/Megatron-HQ/Megatron/releases/latest) and run it. It installs for
your user only, with no administrator prompt. The installer isn't code-signed yet, so SmartScreen
may warn about it: click **More info > Run anyway**.

### Updates

Megatron checks GitHub for a newer release 10 seconds after launch and every 6 hours. Turn this off
in **Settings > Updates**; **Check now** works either way.

- **Windows** downloads the update in the background. A dot on the Settings gear means it's ready:
  choose **Restart to update**, or quit Megatron and it installs then.
- **macOS** can't install its own updates without a Developer ID signature, so the dot means a new
  version is available. Run `brew upgrade --cask megatron`, or choose **Download** for the new DMG.

Each check is one request to github.com, which sees your IP address and which platform's update
feed is fetched. No skills, usage data, or paths are sent.

## Run locally

Requires Node.js 22 (`.nvmrc`) and npm. Plugin actions also need the `claude` executable on the
desktop app's PATH.

```sh
git clone https://github.com/Megatron-HQ/Megatron.git
cd Megatron
npm ci
npm run dev
```

On first launch, Megatron scans its allowed Claude Code locations. Open **Settings > Project
folders > Manage** to grant repositories containing project skills or project/local plugin
settings. If startup reports `Error: Electron uninstall`, see
[Environment setup](docs/environment-setup.md).

Scripts live in `package.json`; `CLAUDE.md` notes the ones with a gotcha. Design and architecture
decisions live in `docs/` (see [Development documentation](#development-documentation)).

## Privacy

- **Analysis stays on your machine.** Megatron has no telemetry and makes no LLM calls. Nothing it
  indexes is uploaded.
- **Update checks reach github.com.** Installed builds ask GitHub for new releases (see
  [Updates](#updates)); no skills, usage data, or paths are sent.
- **The Claude CLI may use the network.** Plugin actions and Resident tax run Claude Code's own
  CLI. Resident tax's `/context` is computed locally, but it starts your MCP servers and
  SessionStart hooks.
- **The local index holds some prompt text.** It stores skill invocation arguments and excerpts of
  the prompt that preceded each invocation. Resident tax results stay in memory.
- **The usage archive keeps metadata only.** `usage-history.db` records prompt counts, session and
  project identifiers, timestamps, and token counters, never prompt or response text. It outlives
  Claude Code's own ~30-day history so Usage can show more than a month.

## Index location and recovery

The database is `megatron.db` under Electron's user data directory. Default development locations:

| Platform | Directory                                 |
| -------- | ----------------------------------------- |
| macOS    | `~/Library/Application Support/megatron/` |
| Windows  | `%APPDATA%\megatron\`                     |

Use **Settings > Reveal data folder** to locate the active profile. Preferences are stored
separately in that folder.

The index rebuilds itself whenever a new version changes its schema, so updates never need a
manual reset. To rebuild it by hand, close Megatron, run `npm run db:reset`, and relaunch; the
command removes the database and its WAL, SHM, and journal sidecars. Source skills, plugins,
transcripts, and repository folder grants (stored in `preferences.json`) remain intact, and
scanned data rebuilds from the Claude files still present. The usage archive, `usage-history.db`,
is never deleted by either.

## Development documentation

| Document                                                  | Covers                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                    | Repository rules, the docs rule, and locked decisions; source for generated `AGENTS.md` |
| [Design system](DESIGN.md)                                | Visual language, components, Usage chart rules, layouts, and app icons                  |
| [Skill scanner](docs/skill-scanner.md)                    | Skill sources, scan integrity, frontmatter parsing, token estimates, and linting        |
| [Transcript ingestion](docs/transcript-ingest.md)         | Transcript formats, invocation detection, trigger classification, and scan cadence      |
| [Data model](docs/data-model.md)                          | Index and usage-archive invariants, plugin identity, and Usage project identity         |
| [Usage analytics](docs/usage-analytics.md)                | Data sources, double-counting hazards, cost attribution, and Resident tax               |
| [Security and scan integrity](docs/security-hardening.md) | Security boundaries and threats, cache preservation, and resource bounds                |
| [Releases](docs/releases.md)                              | Signing switch, Homebrew tap, updater behavior, and upgrade paths                       |
| [Environment setup](docs/environment-setup.md)            | Electron installation troubleshooting                                                   |

## Founders

- **Vijay Sai Chigullapally** — Co-founder
- **Sairithik Komuravelly** — Co-founder

## License

[MIT](LICENSE).

# MCP servers

Owns where Megatron finds a user's MCP servers, how one server is identified across the places
that declare it, what is stored about it, and how its use is read from transcripts. `CLAUDE.md`
stays authoritative for repo-wide decisions; the decisions below are locked here.

Tracking: epic #54. Implementation lands in `src/main/ingest/` (declarations, tool-call ingest),
`src/main/db/` (identity and queries), and `src/main/linter/` (MCP rules).

## Sources

Verified against [Claude Code's MCP docs](https://code.claude.com/docs/en/mcp.md) and a real
`~/.claude.json` (Claude Code 2.1.327), 2026-11-18.

| Source        | Where it is declared                                                                | How Megatron reads it                                                              |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Local         | `.claude.json` → `projects[<path>].mcpServers`                                      | Tier 1 file, for every project, granted or not                                     |
| Project       | `<repo>/.mcp.json`                                                                  | Tier 2: granted repos only. Ungranted repos are counted for a grant suggestion     |
| User          | `.claude.json` → top-level `mcpServers`                                             | Tier 1 file                                                                        |
| Plugin        | The plugin's `.mcp.json`, manifest, or marketplace entry (`docs/skill-scanner.md`)  | Already resolved into `plugin_components` (kind `mcp`); never rescanned            |
| claude.ai     | Not on disk. Claude Code fetches the account's connectors from claude.ai at startup | `mcp__claude_ai_*` tool calls in transcripts, and the on-demand live check         |
| Built-in      | Not on disk (e.g. `claude-in-chrome`, `computer-use`)                               | Tool calls in transcripts only                                                     |
| Managed (org) | `managedMcpServers` managed setting, `managed-mcp.json` in a system folder          | Not read (non-goal below). Such servers appear only as Observed or live-check rows |

`.claude.json` sits in `$HOME` by default and inside the Claude Code Folder when `CLAUDE_CONFIG_DIR`
names it (`docs/security-hardening.md`); Megatron reads whichever `claudeConfig().claudeJson` names.

Per-project state, also in `.claude.json` → `projects[<path>]`:

- `enabledMcpjsonServers` / `disabledMcpjsonServers`, plus `enableAllProjectMcpServers` in any
  settings file: approval of a `.mcp.json` server. Neither listed → **pending approval**. A
  `disabledMcpjsonServers` entry in any settings file rejects. A repo's own committed
  `.claude/settings.json` approves its servers only once the folder is trusted
  (`projects[<path>].hasTrustDialogAccepted`); untrusted, the server stays pending.
- `disabledMcpServers`: the `/mcp` per-project off switch for user, plugin, managed, claude.ai
  (by display name, e.g. `claude.ai Slack`), and default-on built-in servers.
- `enabledMcpServers`: the opt-in list for default-off built-ins only.

`disableClaudeAiConnectors: true` in any settings scope (any-source-true) turns off the connectors
Claude Code fetches itself. The `ENABLE_CLAUDEAI_MCP_SERVERS` environment variable does the same for
one shell, which Megatron cannot see.

## Locked decisions

| Area                  | Decision                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server identity       | One row per server: a configured name (local, project, user), `plugin:<plugin>:<server>`, a claude.ai connector, or an **Observed** server known only from tool calls. Every place that declares it is a **Declaration** listed under that one row                                                            | The same name declared in three scopes is one server to the user. One row per declaration would repeat it and split its usage                                         |
| Precedence            | Local > project > user > plugin > claude.ai, per project. The three scopes match duplicates by name; plugin servers and connectors match an enabled server above them by endpoint (URL equal up to scheme/host case, default port, trailing slash; or the same command). The winning entry is used whole      | Claude Code's own rule. Megatron marks the losers "shadowed" rather than hiding them                                                                                  |
| Endpoint comparison   | Done in memory during a Scan. Only the outcome (which identity a declaration duplicates) is stored                                                                                                                                                                                                            | Endpoint equality needs the full URL, and the path and query often carry credentials                                                                                  |
| Stored config         | Transport, URL host or command basename, env and header **key names**, arg count, and per value whether it is a `${VAR}` / `${VAR:-default}` reference or a literal, plus a scan-time boolean for a credential-looking literal. Never values, args, URL path, query, or userinfo                              | MCP configs in the wild inline tokens in args, env, headers, and URLs. Key names say what a server needs without exposing it                                          |
| Transport             | `type` absent means stdio; `streamable-http` is `http`; `sse` is deprecated but read. An entry with a `url` and no `type` is skipped by Claude Code and is a lint finding here                                                                                                                                | Claude Code reads a missing `type` as stdio and refuses a url-without-type entry, so the user's server silently never loads                                           |
| Tool-call attribution | A transcript `tool_use` named `mcp__<prefix>__<tool>` belongs to the server whose sanitized name is the longest matching `<prefix>`, within the session's project and its precedence. Unmatched prefixes become Observed servers                                                                              | Names are sanitized (below), so the split cannot be done by a fixed separator. Longest match against known identities is the only reading that survives `_` in names  |
| Prefix collision      | Two identities that sanitize to the same prefix mark their calls ambiguous and raise a lint finding. Calls are never counted twice                                                                                                                                                                            | The transcript alone cannot tell them apart                                                                                                                           |
| Call data             | Per call: `tool_use.id` (global dedup), session, project, prefix, tool, time, agent id, `is_error`, whether the user refused it (`is_denied`), and result size. Never input or result content                                                                                                                 | Inputs and results hold SQL, mail, file contents, and page text. Size alone answers "which tools flood the context"                                                   |
| Retention             | Tool calls live only in the derived index (`megatron.db`), like Skill Invocations, so they age out with Claude Code's transcript pruning (~30 days). The UI names the window it covers. Archiving both together is #51                                                                                        | Archiving MCP calls alone would make the two histories disagree                                                                                                       |
| Cost                  | Context weight only, in tokens: resident tool-definition tokens per server from the existing `/context` measurement (never a new run; deferred tools marked), and estimated result tokens from result size. No dollar figure                                                                                  | Per-call dollars would need a new allocation model across the `cost-state` hazards in `docs/usage-analytics.md`                                                       |
| Live check            | `claude mcp list` runs only when the user asks, after a one-time confirm, from an empty app-private folder (user scope and connectors) or a granted repo (that project). Only each line's leading name and trailing status are kept; the middle is dropped inside the CLI wrapper. Cached for the app session | It is the only source for unused connectors and auth state, but it starts every approved stdio server, contacts every remote one, and prints commands, args, and URLs |
| Writes                | Only through the CLI: `claude mcp remove --scope <scope>`, `reset-project-choices`, and `logout` (#48). Never edit `.claude.json` or `.mcp.json` directly                                                                                                                                                     | Claude Code rewrites `.claude.json` on every start; a second writer risks corrupting it. Enable/disable has no CLI command, so it waits for one                       |
| Rescans               | No file watcher on `.claude.json`. Declarations are reread whole on every inventory and plugin Scan; parsing the file is cheap                                                                                                                                                                                | Claude Code writes the file constantly (startup counters, tips), so a watcher would rescan nonstop                                                                    |

## Tool names

Claude Code names a server's tools `mcp__<server>__<tool>` and replaces every character of the server
part outside `A-Z`, `a-z`, `0-9`, `_`, `-` with `_`:

| Server                         | Prefix                         |
| ------------------------------ | ------------------------------ |
| `github` (local/project/user)  | `github`                       |
| `plugin:playwright:playwright` | `plugin_playwright_playwright` |
| `claude.ai Google Drive`       | `claude_ai_Google_Drive`       |
| built-in `claude-in-chrome`    | `claude-in-chrome`             |

A tool whose full name exceeds 128 characters is left out by Claude Code, so it never appears in a
transcript. Observed servers get a readable label until a live check supplies the real name
(`claude_ai_Google_Drive` reads "Google Drive").

## Non-goals

| Non-goal                                      | Revisit when                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Reading org-managed MCP config (#53)          | The first report from a user on an org-managed install                            |
| Add, login, and other full management (#50)   | v2 (#48, #49) has shipped, and add can take secrets without Megatron holding them |
| Enable/disable per project                    | Claude Code ships a CLI command for it                                            |
| Dollar cost per server or tool                | A per-call allocation model is decided in `docs/usage-analytics.md`               |
| Stdio command resolvable on `PATH` lint (#52) | Resolution is reliable across PATHEXT, shims, and version managers                |

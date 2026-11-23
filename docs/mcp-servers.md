# MCP servers

Owns where Megatron finds a user's MCP servers, how one server is identified across the places
that declare it, what is stored about it, and how its use is read from transcripts. `CLAUDE.md`
stays authoritative for repo-wide decisions; the decisions below are locked here.

Tracking: epic #54. Implementation lands in `src/main/ingest/` (declarations, tool-call ingest),
`src/main/db/` (identity and queries), and `src/main/linter/` (MCP rules).

## Sources

Verified against [Claude Code's MCP docs](https://code.claude.com/docs/en/mcp.md) and a real
`~/.claude.json` (Claude Code 2.1.327), 2026-11-18.

| Source    | Where it is declared                                                                | How Megatron reads it                                                       |
| --------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Local     | `.claude.json` → `projects[<path>].mcpServers`                                      | Tier 1 file, for every project, granted or not                              |
| Project   | `<repo>/.mcp.json`                                                                  | Tier 2: granted repos only. Settings lists used folders no grant covers yet |
| User      | `.claude.json` → top-level `mcpServers`                                             | Tier 1 file                                                                 |
| Plugin    | The plugin's `.mcp.json`, manifest, or marketplace entry (`docs/skill-scanner.md`)  | Already resolved into `plugin_components` (kind `mcp`); never rescanned     |
| claude.ai | Not on disk. Claude Code fetches the account's connectors from claude.ai at startup | `mcp__claude_ai_*` tool calls in transcripts, and the on-demand live check  |
| Built-in  | Not on disk (e.g. `claude-in-chrome`, `computer-use`)                               | Tool calls in transcripts only                                              |

A project folder the user hid in Megatron (`hiddenProjects`, `docs/data-model.md`) contributes no
local or project Declarations and no project state: the scan skips its group, and every folder
inside it. Trust is still read from every `projects` entry, since that is how Claude Code decides
it. Consequence, accepted: calls to a server declared only in a hidden project stay in Usage but are
credited to an Observed prefix, because `mcpCallOwners` reads the inventory, which no longer holds
that Declaration.
| Managed (org) | `managedMcpServers` managed setting, `managed-mcp.json` in a system folder | Not read (non-goal below). Such servers appear only as Observed or live-check rows |

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

| Area                  | Decision                                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server identity       | One row per server: a configured name (local, project, user), `plugin:<plugin>:<server>`, a claude.ai connector, or an **Observed** server known only from tool calls. Every place that declares it is a **Declaration** listed under that one row                                                                                            | The same name declared in three scopes is one server to the user. One row per declaration would repeat it and split its usage                                                                                 |
| Precedence            | Local > project > user > plugin > claude.ai, per project. The three scopes match duplicates by name; plugin servers and connectors match an enabled server above them by endpoint (URL equal up to scheme/host case, default port, trailing slash; or the same command). The winning entry is used whole                                      | Claude Code's own rule. Megatron marks the losers "shadowed" rather than hiding them                                                                                                                          |
| Endpoint comparison   | Done in memory during a Scan. Only the outcome (which identity a declaration duplicates) is stored                                                                                                                                                                                                                                            | Endpoint equality needs the full URL, and the path and query often carry credentials                                                                                                                          |
| Stored config         | Transport, URL host or command basename, env and header **key names**, arg count, and per value whether it is a `${VAR}` / `${VAR:-default}` reference or a literal, plus a scan-time boolean for a credential-looking literal. Never values, args, URL path, query, or userinfo                                                              | MCP configs in the wild inline tokens in args, env, headers, and URLs. Key names say what a server needs without exposing it                                                                                  |
| Transport             | `type` absent means stdio; `streamable-http` is `http`; `sse` is deprecated but read. An entry with a `url` and no `type` is skipped by Claude Code and is a lint finding here                                                                                                                                                                | Claude Code reads a missing `type` as stdio and refuses a url-without-type entry, so the user's server silently never loads                                                                                   |
| Tool-call attribution | A transcript `tool_use` named `mcp__<prefix>__<tool>` belongs to the server whose sanitized name is the longest matching `<prefix>`, within the session's project and its precedence. Unmatched prefixes become Observed servers                                                                                                              | Names are sanitized (below), so the split cannot be done by a fixed separator. Longest match against known identities is the only reading that survives `_` in names                                          |
| Prefix collision      | Two identities that sanitize to the same prefix mark their calls ambiguous and raise a lint finding. Calls are never counted twice                                                                                                                                                                                                            | The transcript alone cannot tell them apart                                                                                                                                                                   |
| Call data             | Per call: `tool_use.id` (global dedup), session, project, prefix, tool, time, agent id, `is_error`, whether the user refused it (`is_denied`), and result size. Never input or result content                                                                                                                                                 | Inputs and results hold SQL, mail, file contents, and page text. Size alone answers "which tools flood the context"                                                                                           |
| Retention             | Tool calls are archived with Skill Invocations, metadata only, in `usage-history.db` (#51, `docs/data-model.md`). The server list and the Usage panel read the archive, so their call counts outlive Claude Code's transcript pruning (~30 days), and name the date they are complete from                                                    | Archiving MCP calls alone would make the two histories disagree                                                                                                                                               |
| Cost                  | Context weight only, in tokens: resident tool-definition tokens per server from the existing `/context` measurement (never a new run; deferred tools marked), and estimated result tokens from result size. No dollar figure                                                                                                                  | Per-call dollars would need a new allocation model across the `cost-state` hazards in `docs/usage-analytics.md`                                                                                               |
| Live check            | `claude mcp list` runs only when the user asks, after a one-time confirm, from an empty app-private folder (user scope and connectors) or a granted repo (that project). Only each line's leading name and trailing status are kept; the middle is dropped inside the CLI wrapper. Cached for the app session                                 | It is the only source for unused connectors and auth state, but it starts every approved stdio server, contacts every remote one, and prints commands, args, and URLs                                         |
| Writes                | Only through the CLI: `claude mcp remove --scope <scope>`, `reset-project-choices`, `logout` (#48), and `add-json` (#50). Never edit `.claude.json` or `.mcp.json` directly. No logout for claude.ai connectors: they read "Managed in claude.ai" (Connector logout below)                                                                    | Claude Code rewrites `.claude.json` on every start; a second writer risks corrupting it. Enable/disable has no CLI command, so it waits for one                                                               |
| Rescans               | No watch on `.claude.json` (#67). Declarations are reread whole on every inventory and plugin Scan; parsing the file is cheap. A change made in Claude Code reaches the index through the window-focus Scan (on switching back to Megatron, at most one per 10 s), the inventory watcher's 30 s reconcile, or the rescan each MCP action runs | Claude Code rewrites the file about once a minute while working, every write a counter or cache key. Watching it cost a full inventory Scan per write for no change; the worst case without it is a 30 s wait |

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

## Definition tokens

Verified 2026-11-18 against Claude Code 2.1.327: `/context`'s `MCP Tools` table has one row per
tool, columns `Tool | Server | Tokens`, and its `Server` column is the same sanitized prefix a
call's name carries. No row says whether its tool is deferred; only the category table splits loaded
(`MCP tools`) from deferred (`MCP tools (deferred)`) totals, 701 against 272.6k on the verifying
machine. Resident tax measures from an empty folder, so local and project servers never appear.
Megatron therefore shows a server's tool-definition tokens, never whether they sit in context, and
reads them only from the last measurement this launch.

## Live check

Verified 2026-11-18 against Claude Code 2.1.327, from its own status strings. `claude mcp list`
prints `Checking MCP server health…`, then one line per server, `<name>: <URL or command line> -
<status>`, the middle holding the server's credentials as configured. A failed server can add an
indented issue line, an error that may quote a URL. The statuses: `✔ Connected`, `! Connected ·
tools fetch failed`, `! Needs authentication`, `✗ Failed to connect`, `✗ Connection error`,
`⏸ Pending approval`, `Rejected (see disabledMcpjsonServers in settings)`, `⊘ Disabled for this
project`, and `- Not configured`. With no servers it prints `No MCP servers configured`.

Megatron reads the name up to the first `: ` and the status from the last `" - "` segment that reads
as one, by its words with the glyph stripped. Indented lines, unknown statuses, and everything in
between are dropped inside the parser; output with no readable line is an error, not an empty
list. The general check runs from an empty app-private folder, so only user servers, connectors,
and user plugins appear; local and project servers answer only from their own project, checked one
granted project at a time. A real run took about 10 seconds with seven connectors.

## Writes

Four actions, each one `claude mcp` command (#48, #50). The renderer names a Declaration by server id,
scope, and project; main finds it in the index and takes the name from there, since names are free
text. Plugin servers are changed from their plugin, connectors on claude.ai, and Observed servers
have no Declaration to change, so all three are refused.

| Action        | Command                                           | For                                   | Runs from                                                        |
| ------------- | ------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Remove        | `claude mcp remove --scope <scope> -- <name>`     | A local, project, or user Declaration | The granted project (local, project), an empty app folder (user) |
| Reset choices | `claude mcp reset-project-choices`                | A project whose `.mcp.json` was read  | That granted project                                             |
| Logout        | `claude mcp logout -- <name>`                     | A configured http, sse, or ws server  | As for Remove                                                    |
| Add           | `claude mcp add-json --scope <scope> -- <name> -` | A new local, project, or user server  | As for Remove                                                    |

Verified 2026-11-19 against Claude Code 2.1.328: `--` ends the options, so a name starting with `-`
stays the name, and a name the scope doesn't hold exits 1 with `No MCP server named "<name>" in
<scope> scope`. `claude mcp get -- <name>` health-checks that one server and prints its scope,
`Status: <status>` in the list's wording, and its URL or command line; only the status line is read.

One action runs at a time across every server, because each can rewrite `.claude.json`, and a
Claude Code folder switch waits for it before relaunching. Every action is judged by the state it
leaves (a refusal can exit 0, Connector logout below): a remove rescans and confirms the
Declaration is gone, else reports that Claude Code left it in place (a project key `.claude.json`
spells differently, say); a reset rescans and reports how many `.mcp.json` servers now wait for
approval and how many a settings file still approves or rejects; a logout reads `claude mcp get`
and counts only "Needs authentication" as signed out. Every action drops the session's live
connection statuses, which may no longer hold.

### Adding a server

Locked with the maintainer on 2026-11-22 (#50; the decisions are on the issue). Megatron builds the
server's JSON from the form and hands it to `add-json` on **stdin**, never the command line, which
other processes can read. Main checks every field again (`parseMcpAddInput`; a name uses only letters, numbers, `-` and `_`, Claude Code's own rule), refuses a name its
scope already declares or whose tool prefix another server's tools carry (`mcpAddConflict`),
and in project scope refuses a credential-looking literal, judged by the scanner's own check, since
`.mcp.json` is shared through git; local and user scope keep one behind the form's warning. Values
are never stored or logged. The add is judged by the Declaration it leaves (`findMcpDeclaration`),
and the result notes a project server waiting for approval, which same-name Declaration takes
precedence in each project (`mcpAddPrecedenceNote`), and a bare command not found on PATH.
Verified 2026-11-22 against Claude Code 2.1.330: `add-json` refuses stdin from inside a Claude
Code session (`CLAUDECODE` and related variables), so its permission prompt can't hide a server
from the user. Megatron keeps that guard: started from a Claude Code terminal, an add shows the
CLI's refusal.

### Signing in to a server

Verified 2026-11-22 on Windows against Claude Code 2.1.330 with a disposable HTTP MCP server
and OAuth provider. With piped standard streams, `claude mcp login` discovered the OAuth provider
and registered a client, then exited with “this isn't an interactive terminal.” No authorization
code reached the token endpoint, and `claude mcp get` still reported `Needs authentication`.
Megatron's CLI runner uses piped streams, so offering Login depends on a supported way to
complete the browser flow from that runner.

## Connector logout

Verified 2026-11-19 against Claude Code 2.1.328 (#47), with a throwaway connector. `claude mcp
logout "claude.ai <Name>"` changes nothing: it prints that the connector's credentials live on
claude.ai, not this machine, names `https://claude.ai/customize/connectors` as the place to
disconnect it, and exits 0. The connector still reads `✔ Connected` afterwards, and the
verifying Windows machine's `.credentials.json` (macOS keeps these in the Keychain) holds no
per-server MCP token, only the Claude account sign-in. So a
connector can be disconnected only on claude.ai, where its credentials live, and Megatron offers
no logout for one. Logout stays for remote servers that aren't connectors, and because a
refusal also exits 0, its success is judged by the server's state afterwards, never the exit code.

## Usage panel

Usage → MCP servers reads the same known calls as the server list (`knownMcpCallsSql`) over rolling 24-hour, 7-day, and 30-day
windows, through its own `usage:mcp` channel rather than the polled overview. A call is credited to
the server the MCP section credits it to (`mcpCallOwners`), so the panel and the server list never
disagree; a call on a shared prefix counts in the totals and credits no server. A call's project is
its own `cwd`, else its session's, grouped by Usage project. Error rate is errors over calls that
weren't refused; refusals are counted apart, and a call with no recorded result is not an error.
Result tokens are estimated from returned characters (`CHARS_PER_TOKEN`). When the date calls are
counted from (`usageHistorySince`, the start of the latest unbroken transcript coverage) is newer than
the window's start, the panel names it. The panel refreshes after inventory
scans too, because a changed Declaration can move calls to another server.

## Lint

Findings are derived from the index each time a server is read, never stored: every input is already
there, so they can't go stale. A server Claude Code skips gets only that finding.

| Rule                     | Severity | Fires when                                                                         |
| ------------------------ | -------- | ---------------------------------------------------------------------------------- |
| `mcp-server-skipped`     | warning  | A Declaration has a config problem (url without type, unknown type, no endpoint)   |
| `mcp-inlined-credential` | warning  | A literal credential-looking value; names the literal keys, never a value          |
| `mcp-prefix-collision`   | warning  | Another server sanitizes to the same prefix, so neither is credited with its calls |
| `mcp-pending-approval`   | info     | A `.mcp.json` server in a granted project is neither approved nor rejected         |
| `mcp-shadowed`           | info     | A Declaration loses to a higher-precedence one somewhere                           |
| `mcp-command-not-found`  | info     | A configured stdio Declaration's bare command is on no PATH folder Megatron sees   |

### Command not found

Megatron sees only its own PATH, never the shell `claude` runs in, so `mcp-command-not-found` (#52)
speaks only when that PATH stands in for it, and every doubt is silence: a missing notice costs
less than a false one. It considers a local, project, or user stdio Declaration whose command is a
bare program name (`uvx`, not `./bin/uvx`, `${HOME}/uvx`, or `npx -y pkg`; recorded at scan time
as `command_is_bare`, since only the basename is stored). It stays silent when:

- the server has a recorded call in the last 30 days, which shows it starts;
- the Declaration sets `PATH` in its own `env`;
- Megatron's PATH is launchd's default (`/usr/bin:/bin:/usr/sbin:/sbin`), which a Mac app opened
  from the Dock or Finder gets: it holds none of Homebrew, nvm, or uv. Windows apps inherit the
  user's full PATH;
- any folder could not be checked (permissions, a network share).

Otherwise each absolute PATH folder is checked with one stat per candidate, with `PATHEXT` on
Windows (`executableStatusSync` in `permissions.ts`). Nothing is executed and no file is read.
Plugin servers are not checked: their stored detail doesn't say whether the command had a folder.

## Non-goals

| Non-goal                             | Revisit when                                                        |
| ------------------------------------ | ------------------------------------------------------------------- |
| Reading org-managed MCP config (#53) | The first report from a user on an org-managed install              |
| Login to a server (#50)              | The browser flow can complete through Megatron's CLI runner         |
| Editing a server (#50)               | Claude Code ships an edit command                                   |
| Enable/disable per project           | Claude Code ships a CLI command for it                              |
| Dollar cost per server or tool       | A per-call allocation model is decided in `docs/usage-analytics.md` |

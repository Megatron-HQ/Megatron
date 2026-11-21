# Security and scan integrity hardening

Owns Megatron's security boundaries, the threats each control defends against, scan-integrity rules
at the permission boundary, and resource bounds. `docs/releases.md` owns the release decisions; the
Release and updates section here covers their security consequences.

## Security boundary

- Only the registered application window's main frame, at its exact trusted renderer URL, may
  invoke application IPC. Navigation and redirects outside that page are blocked.
- The preload exposes the typed application API and platform name. Raw IPC and environment
  variables are not exposed. The renderer is sandboxed. Threat: a renderer compromise (for example
  through rendered skill Markdown) must not reach Node or raw IPC. Source modules remain ESM; the
  bundled `out/preload/index.cjs` is the generated-output exception required by Electron.
- Plugin actions require validated identifiers, an enumerated scope, a matching indexed install,
  known enablement, and permission for a recorded project directory. Writes use Claude's CLI,
  resolved to an absolute executable outside the project and launched without a shell. Trusted npm
  installs run through an absolute Node executable and CLI entry. Relative, empty, network and
  project-owned PATH candidates are excluded; Node startup injection variables are removed. Threat:
  plugin actions run with a repository as their working directory, and a cloned repository can
  ship its own `claude` executable or poison `PATH` to be run in its place.
- MCP actions (`claude mcp remove`, `reset-project-choices`, `logout`) take the same CLI path. IPC
  carries only a server id, an enumerated scope, and an absolute project path; main takes the
  server's name from the index, refuses plugin, connector, and observed servers, and runs a local
  or project action only from a granted project folder (a user-scope one from an empty app-private
  folder). The name follows `--`, so a name starting with `-` can't become an option. One MCP
  action runs at a time, since each can rewrite `.claude.json`. Threat: a renderer naming any
  string, or a crafted name, steering the CLI at a server or file the index never listed.
- Cost aggregation uses objects without prototypes, including inner model buckets.

### Config root

Tier 1 is one Claude Code config folder. `claude-folder.ts` picks it once at startup and it stays
fixed for the process; the scan worker receives it in `workerData`. Elsewhere in these docs,
`~/.claude` means this folder.

- Order: the folder chosen in Settings, else `CLAUDE_CONFIG_DIR`, else `~/.claude`. Settings exists
  because a Finder- or Dock-launched macOS app never sees shell variables, and shell aliases switch
  profiles per terminal.
- `CLAUDE_CONFIG_DIR` unset or blank: `~/.claude`, with `.claude.json` in `$HOME`. Set: that folder
  replaces `~/.claude` in Tier 1 and `.claude.json` moves inside it. Verified against Claude Code
  2.1.326, 2026-11-17: the folder is `(CLAUDE_CONFIG_DIR ?? ~/.claude).normalize('NFC')` and
  `.claude.json` is `join(CLAUDE_CONFIG_DIR || homedir(), '.claude.json')`, so "unset" and
  "explicitly `~/.claude`" read different `.claude.json` files, and Settings lists them as two
  options. The Default option, and `~/.claude` picked in the native dialog by any spelling or link,
  save `null`: the unset form, even when the variable is set. The named option (tagged
  `.claude.json inside`) saves the path, as every option but Default does. It is offered when the
  variable names `~/.claude` or `~/.claude/.claude.json` exists, which Claude Code writes only when
  run with the variable naming `~/.claude`, so a Finder- or Dock-launched app can still choose it.
- A folder, from either source, is used only when both its given form and its realpath are
  absolute, not UNC, not a filesystem or drive root, and not `$HOME` or an ancestor of it (also by
  file identity, so another casing or an 8.3 name can't slip past), and the folder holds a Claude
  Code marker (`settings.json`, `.claude.json`, `projects/`, `plugins/`, `skills/`,
  `history.jsonl`). Threat: a value naming `$HOME`, `/` or `~/Documents` would put that whole tree
  in Tier 1. Consequence: a brand-new profile is refused until Claude Code has run in it once. A
  Settings choice is checked when chosen (a refused one is never saved) and again on every launch;
  one that fails later falls through to the variable or the default, with a notice.
- Both sources keep the given form, not the realpath, because Claude Code records paths in that
  form; the Settings choice is saved as chosen and never re-resolved. A linked folder is followed
  by the setup-link rule under Cache preservation, like a linked `~/.claude`. A named folder also
  pins its resolved directory for the process lifetime. A change to a different valid target
  suspends scans and uses the existing profile relaunch flow. An invalid target stays paused.
  The worker checks the pinned target at its scan and write boundaries, and the CLI gate refuses
  the changed target while existing plugin and MCP actions settle.
- A missing folder is held, never replaced: reading another profile in its place would be silently
  wrong. While it is missing, new scans and every CLI run are refused, so a missing drive can't
  empty the index and the CLI can't create folders at its path. Each scan request, and each spawn
  in `runClaude` (the one path every `claude` takes, through the gate main registers with
  `gateClaude`), checks the disk at call time, also while a switch waits to relaunch. A 2-second
  `fs.watchFile` poll notices it leave and return between requests; a returning folder must pass
  the checks above again before anything resumes. Going missing also suspends active scans and
  settles queued requests; reconnect waits for termination and revalidates the folder before one
  fresh scan. Workers recheck the fixed root between tasks, before destructive reconciliation, and
  inside archive transactions. Unavailable sources retain cached rows and cannot establish fresh
  archive coverage. Deleting a data subdirectory in a present profile still reconciles normally.
  These checks narrow same-user filesystem races; they are not an atomic filesystem snapshot.
  `~/.claude` read as the default never pauses, since a fresh install has none until Claude Code
  first runs.
- The marker probe lists names in the one named folder with plain `fs` before it becomes Tier 1.
  Settings' suggestions list the entry names of `$HOME`, of `~/.claude` (for `.claude.json`) and of
  `.claude-*`/`.claude_*` folders (`settings.json`, `.claude.json`, `projects/`); no file contents
  are read. Like CLI discovery, both are a separate capability from `isPathAllowed()`.
- The renderer never names a folder: it chooses by an id from main's own list, or main opens the
  native picker. IPC carries one id of at most 300 characters.
- Switching relaunches: wait for running plugin and MCP actions, refuse new CLI runs, stop scans, then
  `app.relaunch()` and `app.exit(0)`. `exit` skips `before-quit`, so a staged macOS update is not
  swapped in mid-switch.
- CLI runs (`/context`, plugin and MCP actions) get `CLAUDE_CONFIG_DIR` set exactly when the active folder
  is a named one (`.claude.json` inside it), and stripped in every casing otherwise, so a refused
  value or "Use default" leaves both Megatron and the CLI on `~/.claude`. Threat: the CLI changing
  one profile while Megatron shows another.

## Cache preservation

Links inside content someone else wrote (granted repositories, plugin content, and folders nested
inside any skill) are followed only when their canonical target is also approved. The folder
picker stores the canonical grant; restoring grants never resolves a saved root into a new approved
target. Explicit target-folder grants preserve legitimate linked skill stores in repositories. File
reads reject special files, use no-follow/nonblocking flags where supported, and compare full-width
file identity before and after opening. Threat: a symlink or junction inside a granted folder
pointing outside it would read files the user never granted. These checks reduce link-swap races;
they are not an OS-enforced atomic containment guarantee against an actively mutating process
running as the same user.

Links that make up the user's own Claude Code setup are followed to wherever they point:
`~/.claude` itself, a Tier 1 root or file, and each top-level entry of `~/.claude/skills` (one level
deeper inside `synced/`). `setupAnchor()` in `permissions.ts` names that point; a path below it is
approved when it resolves inside the anchor's realpath, recomputed at every read. Anything that can
create these links already runs as the user and could read the target itself, and Claude Code
follows the same links into the model's context. Remaining risk, accepted: when `~/.claude/skills`
is a team's git clone, the repo's author chooses those top-level links. The exposure is bounded:
a target only becomes a skill row if it already holds a `SKILL.md`, the renderer names skills by id
and never by path (the file viewer resolves `source_path` in main), and links nested inside the
target stay strict.

A blocked repo link is reported as a `link_unapproved` scan issue that names its target, and the
user grants through Settings > Claude Code > Project folders. The picker is deliberately not
pre-pointed at the target: the target is the repo author's choice, and a one-click grant would let
a repository ship `.claude/skills/x -> ~/.ssh` as a prompt to approve `~/.ssh`.

Repository discovery metadata in the private preferences cache is descriptive, not an access
capability. Discovery and catalog restoration retain current grants and canonical target checks.
Repository-scoped plugin rows do not broaden plugin actions: the existing IPC install-identity,
enablement, folder access, and CLI working-directory checks still apply.

Grants never nest. A pick inside an existing grant is skipped and reported before it is registered
as readable. Adding a parent absorbs the stored grants inside it: they leave preferences and
in-memory access, and their cached skills stay because the parent covers them. Grants saved by
older versions collapse the same way at startup, before access is restored. Overlap is decided by
`isWithinGrant`, the containment rule `isPathAllowed` uses, so the two cannot disagree. Narrowing
(`folders:narrow`) accepts only a path equal to an existing grant and replaces it with folders
picked in the native dialog, so grants still come only from that dialog. The add dialog may open
in a suggested starting folder, which main computes from Claude Code's recorded project locations
(`suggestGrantStart`), leaving out hidden folders. It never suggests the home folder, anything
above it, or a drive/share root.

The add dialog can also open inside one folder the user clicked: a needs-access notice, a "Not
readable yet" row or a Review… row. The renderer sends that path back, and main accepts it only if
it exactly matches one of its own records of where Claude Code ran (Usage locations,
`plugin_registry.project_path`, `mcp_project_state.project_path`, granted catalog folders) and
passes the same home-and-above rule (`matchRecordedFolder`). Main then uses its own spelling of the
path, so the renderer still never names a folder of its choosing. The picker is aimed only when no
grant covers the folder and a plain `statSync` finds a directory. That existence check, the one
capability outside `isPathAllowed`, lives in `src/main/folder-existence.ts`: it reads nothing
inside the folder. The scan worker runs it too, over recorded folders no grant covers (home and
above, and Claude app chat folders, excluded), so a folder proven gone (`ENOENT`, `ENOTDIR`, or now
a file) leaves the folder suggestions. Only that one bit reaches the renderer, as a `missing`
status on a path it already has from Claude Code's records; any other error counts as not gone.
It runs in the worker because a stat on an unreachable network share blocks until the OS gives
up. macOS TCC does not prompt for it: a fresh, consentless app `stat`ed folders inside
`~/Documents`, `~/Desktop` and `~/Downloads` with no prompt, while listing `~/Documents` prompted
(verified on macOS 27.2.1, 2026-11-21). The picker check matters because Electron 43.8.7 handles a missing `defaultPath` differently by platform
(`shell/browser/ui/file_dialog_{mac.mm,win.cc}` at tag `v43.8.7`): macOS opens the parent, while
Windows types the basename into the Folder box and confirming fails. A target that fails any check
falls back to the suggested start. Every grant still comes from the dialog's own result, and
`link_unapproved` targets are never aimed at, because aim targets come only from Claude Code's
recorded project paths. Every grant change drops
cached skills only where no remaining grant covers them. Threat: a child grant the user believes
went away with its parent would keep that folder readable, invisibly to anyone reading the list.

Rejected: per-folder exclusions, a deny rule inside `isPathAllowed`, to keep a parent minus a few
children. A second rule kind in the chokepoint widens what every read evaluates and what a bug
there can expose; narrowing covers the need with grants alone. Revisit if users need to exclude a
few folders from a parent holding hundreds of projects, where re-picking the rest is impractical.

Hiding a folder (`folders:hide`, stored as `hiddenProjects` in preferences) is display-only and is
never an access rule: `isPathAllowed` never reads it, and a hidden folder inside a grant stays
readable. The scan worker leaves hidden folders out of the index instead. A folder to hide must
pass the same record match as an aimed picker. Show (`folders:show`) accepts only an exact match
with an entry already hidden.

User-data reads remain centralized in `permissions.ts`. Separate capabilities serve fixed CLI
discovery, preparation of Electron's private cache, compiled app assets, and the macOS self-update
(see Release and updates). None accepts an arbitrary renderer filesystem path or broadens the skill
permission set. Production assets use
`megatron://app`, a flat asset whitelist and a restrictive CSP. Browser permissions are denied.
Threat: a `file://` origin would let the renderer read arbitrary local files, and an unanswered
browser permission request could reach the camera, microphone, or other devices.

Unavailable reads differ from confirmed missing sources. Unavailable skill documents, settings,
registries, transcript reads, and transcript metadata checks preserve the last usable index.
Readable siblings can still refresh. An invalid registry structure is not an empty registry.

Live inventory watches validate both the requested root and canonical target before attaching,
and close when a root no longer resolves inside the permission boundary. They expose change
notifications only; scanning and file contents still use guarded reads. Missing discovered child
projects are pruned only beneath a readable grant. Explicitly granted missing roots and unavailable
sources retain cached data. Registry cleanup changes only the derived index, never Claude files.

Deletion reconciliation compares permitted canonical locations, including when recorded paths use
macOS `/var` aliases or Windows junctions. A missing descendant is resolved through its nearest
existing approved ancestor; denied, dangling, or retargeted links cannot establish deletion.
This location lookup grants no access and does not replace guarded reads. The CI matrix runs both
operating systems independently so a failing platform cannot cancel the other platform's
validation.

Complete scans reconcile deleted nested and synced skill roots. Partial scans retain cached name
qualification and plugin disablement. Invocation and turn recovery consider unchanged replay
sessions when their canonical owner changes or disappears, inside the scan transaction.

Lint findings are preserved for unreadable documents and failed rule evaluations. Recursive YAML
metadata is a document finding rather than a process-wide parsing failure.

## Usage correctness

- Stored timestamps are validated and normalized; malformed cached cost timestamps cannot crash
  chart reducers.
- Costs must be finite, nonnegative, and representable in safe integer cents. Counters must be
  nonnegative safe integers. Corrupt cost snapshots leave the prior session snapshot intact.
- Sidechain users cannot reset main-session attribution. Repeated cumulative usage uses
  per-counter maxima, retaining partial fields without summing repeated measurements.
- Rolling activity and model windows exclude future events. Activity day charts include every
  local calendar date intersecting the exact rolling window, including the partial cutoff day.
- Project filtering respects directory boundaries and POSIX case. Full plugin identities keep
  distinct marketplaces separate. Scans invalidate history and invocation queries as well as
  inventory and overview queries.

## Resource bounds and feedback

Threat: a huge transcript history, directory tree, or payload must not exhaust memory or hang the
main process or renderer.

Ingestion and linting run in one coalesced worker with a 60-second deadline and a 384 MiB V8 old
generation limit. Worker termination completes before folder grants change. Focus scans are rate
limited. Directory enumeration returns at most 20,000 entries; nested discovery allows 64 levels
and 50,000 directories. Transcript snapshots retain at most 200,000 records / 128 MiB, and prompt
history at most 500,000 rows / 64 MiB. Limit failures preserve affected cached snapshots and report
partial or failed scans. Transactions preserve consistency on termination; scans are not one
transaction across every source. Native allocations are outside V8's heap limit.

Frontmatter is capped at 256 KiB, 10,000 AST nodes, 32 levels and 100 aliases. Metadata expansion
is counted before serialization and capped at 256 KiB. Threat: YAML alias amplification ("billion
laughs") or cyclic metadata in one `SKILL.md` exhausting memory. The Markdown link scanner makes one
pass over each line. Threat: crafted unmatched delimiters triggering catastrophic regex
backtracking. Plugins keep their quality-check exemption, but resource-limit and cyclic-metadata
findings apply to every source. History queries return 200 rows per page; dialogs expose Load more
and identify searches as applying to loaded entries.

Permission-aware buffered file reads are capped at 16 MiB, and streamed transcript/history lines
at 64 MiB. A ranged read (the reftable reader's blocks) returns at most its byte cap from the given
offset instead of failing as too large; that reader stops after the first 32 MiB of a table. The line assembler scans incoming chunks once; it does not repeatedly split a growing
line. An oversized line fails the source read instead of emitting truncated JSON.

File previews allow 256 KiB per file and 4 MiB of aggregate content. Traversal is capped at 1,024
files, 4,096 entries, and 32 directory levels, with cycle protection. Omitted content or traversal
is explicitly marked as a preview limit. These limits affect previews, not the underlying files.

Scan attempts report complete, partial, or failed outcomes separately from whether the attempt
has finished. Partial results show a status message and retain available data. Settings reports
the rescan result; usage and activity dialogs distinguish loading, errors, and empty results.

## Packaging and local data

Runtime packaging uses a positive allowlist. Threat: developer files, fixtures, or secrets shipping
inside the package. Electron fuses disable RunAsNode, Node startup and inspector injection, and
extra file-protocol privileges. ASAR integrity and ASAR-only loading are enabled. Threat: the
installed app being reused as a general Node runtime, or its ASAR modified to run altered code
under the app's identity. Signed macOS builds retain only the JIT entitlement; ad-hoc release builds
add `disable-library-validation` (see Release and updates). Windows uses per-user NSIS with
elevation disabled, so a compromised installer gets no more than the user's own rights.

The index contains plaintext prompt excerpts, skill arguments, repository paths and usage metadata.
Megatron has no automatic upload of the index. Default macOS cache directories/files use modes
0700/0600. Windows cache ACLs allow only the current user, SYSTEM and Administrators through a fixed
absolute Windows PowerShell command with paths passed as environment values. Linked or special cache
files are rejected, including hardlinks, on every call and before any database opens; that check
fails closed. Existing custom profile parent permissions are preserved; directory changes apply only
to a new directory or the exact default app-owned directory (`megatron`, or `megatron-dev` for an
unpackaged run). Cache files are protected separately.
On Windows each directory and file is changed at most once per process, and a file created after
this process locked its directory is not changed again, because it inherits the protected,
inheritable directory ACL. A SQLite `-wal`/`-shm` sidecar that vanishes before the change is
skipped. If the PowerShell change itself fails (policy-blocked PowerShell, Constrained Language
Mode, an endpoint-security block, a timeout), Megatron logs a warning and keeps running, then retries
on the next database open: the default `%APPDATA%` location already inherits a user/SYSTEM/
Administrators ACL, so failing open costs defense in depth, while failing closed would make the app
unusable on locked-down machines. These permissions do not encrypt data or protect against another
process running as the same user. Prompt history mirrors Claude retention; transcript cache rows
reconcile after a successful authoritative scan. Failed reads can retain older rows until the next
successful scan. To erase the derived cache, quit Megatron and remove `megatron.db`,
`megatron.db-wal` and `megatron.db-shm` from the data folder revealed in Settings; folder grants
live in `preferences.json` and survive.

## Release and updates

**Unsigned by default.** There is no Developer ID or paid Windows signing yet.
`scripts/release-build.mjs` builds macOS ad-hoc signed (`mac.identity: "-"`, not notarized) and
Windows unsigned. The Developer ID / Authenticode path (credential validation,
`forceCodeSigning`, app and DMG notarization, stapling, `trusted`-level verification) runs only
when the repository variable `MEGATRON_SIGNED_RELEASE` is exactly `true`; any value other than
`true`, `false` or unset fails the build. The switch is explicit rather than "sign if secrets
exist" so an expired or deleted secret fails loudly instead of quietly shipping an unsigned
release. Unsigned builds strip `CSC_*` secrets from the build environment, because electron-builder
signs Windows whenever `CSC_LINK` is set. Signing, notarization, and clean-machine install checks
remain open in [#10](https://github.com/Megatron-HQ/Megatron/issues/10).

**Ad-hoc entitlements.** `build/entitlements.mac.adhoc.plist` adds `disable-library-validation` to
`allow-jit`: hardened runtime otherwise refuses Electron's frameworks, which carry Apple's Team ID
while an ad-hoc app carries none. That relaxes library validation for the unsigned build only;
signed builds keep `build/entitlements.mac.plist`.

**The Windows `.pfx` path is likely obsolete.** Since June 2023, CAs issue code-signing keys only on
hardware tokens or cloud HSMs, so a new certificate can't be exported as the `.pfx` that
`CSC_LINK`/`CSC_KEY_PASSWORD` expect. Turning Windows signing on will need a cloud-signing
integration (for example SignPath Foundation or Azure Trusted Signing) wired into
`release-build.mjs`, not just new secrets.

**Release flow.** A `v*` tag must equal `v` + `package.json`'s version (`release-check.mjs tag`).
CI then creates a **draft** GitHub Release and uploads the `-mac.zip` (plus a notarized DMG on a
signed build; ad-hoc builds ship no DMG), `install.sh`, the NSIS installer, blockmaps and
`latest*.yml`. Nothing reaches users until a maintainer publishes the draft. `install.sh` is served
only as a release asset, never from `main`, so it passes the same review as the app.

**Update trust model.** Only the main process talks to the network for updates; the renderer CSP
(`connect-src 'none'`) is unchanged. electron-updater reads `Megatron-HQ/Megatron`'s releases over
HTTPS, downloads the artifact named in `latest*.yml`, and checks its sha512. With no code signature,
nothing beyond that authenticates the publisher: **whoever can publish a release on
Megatron-HQ/Megatron can ship code to every Windows and Mac install**, through the in-app updater,
`install.sh` and the tap. Keep release-capable accounts few and 2FA-protected. No separate update
signing key exists by design: losing one would strand every install.

**macOS self-update.** Squirrel.Mac can't install ad-hoc builds, so `mac-self-update.ts` installs
instead. After electron-updater's sha512 check it extracts the zip into its cache folder and
requires `codesign --verify --deep --strict`, bundle ID `com.megatron.app`, and the version
`latest-mac.yml` announced. It writes only to that staging folder, a result file in the data folder,
and the running bundle's own location (derived from the executable path, never from IPC). The swap
is a detached `/bin/bash` running a constant script with every path as a positional argument, never
interpolated into script text. It waits for the app to exit, renames the old bundle aside and the
new one in on the same volume, restores the old one on any failure, and records the failure for the
next launch. Before downloading, a copy that is translocated, on a read-only volume, or not writable
by this account reports the `install.sh` command instead. `install.sh` makes the same checks
(sha512 against `latest-mac.yml`, signature, bundle ID, version), refuses a Homebrew-managed copy or
a running app, and uses stock macOS binaries only. Neither path sets or keeps a quarantine flag.

electron-updater's `MacUpdater` still starts its Squirrel proxy after each download: a loopback
HTTP server guarded by random 64-byte Basic credentials that serves only the downloaded zip. Megatron
never calls Squirrel, the server can't be closed through a public API, and it ends when the app
quits.

**What a check discloses.** A check runs 10 s after launch, then every 6 hours, unless turned off
in Settings; "Check now" always works. Each check is a request to github.com, which sees the IP
address and which platform's feed (`latest-mac.yml` / `latest.yml`) is fetched; the User-Agent is
electron-builder's generic `electron-builder`. Downloading an update also reveals the version being
fetched. No skills, usage data or paths are sent. electron-updater keeps a random staging ID in
`.updaterId` in the data folder; it is used locally only.

**Homebrew tap.** Publishing a release runs `homebrew-tap.yml`, which hashes the published
`-mac.zip` and pushes `Casks/megatron.rb` to `Megatron-HQ/homebrew-tap` with `HOMEBREW_TAP_TOKEN`:
a fine-grained token scoped to Contents read/write on the tap only, stored in the `release`
environment (deployment rule: tags `v*`). The cask's `postflight_steps` removes
`com.apple.quarantine` from the installed app so Gatekeeper doesn't block the ad-hoc build;
installing from the tap is the user's explicit trust decision. Because the token can change what
Mac users install, rotate it if it is ever exposed.

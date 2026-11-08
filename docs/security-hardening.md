# Security and scan integrity hardening

This work addresses the confirmed codebase audit findings and preserves the original Copilot
regression fixes. The index remains a derived cache; no schema migration is introduced.

## Security boundary

- Only the registered application window's main frame, at its exact trusted renderer URL, may
  invoke application IPC. Navigation and redirects outside that page are blocked.
- The preload exposes the typed application API and platform name. Raw IPC and environment
  variables are not exposed. The renderer is sandboxed. Source modules remain ESM; the bundled
  `out/preload/index.cjs` is the generated-output exception required by Electron.
- Plugin actions require validated identifiers, an enumerated scope, a matching indexed install,
  known enablement, and permission for a recorded project directory. Writes use Claude's CLI,
  resolved to an absolute executable outside the project and launched without a shell. Trusted npm
  installs run through an absolute Node executable and CLI entry. Relative, empty, network and
  project-owned PATH candidates are excluded; Node startup injection variables are removed.
- Cost aggregation uses objects without prototypes, including inner model buckets.

## Cache preservation

Linked skill paths and their canonical targets must both be approved. The folder picker stores
the canonical grant; restoring grants never resolves a saved root into a new approved target.
Explicit target-folder grants preserve legitimate linked skill stores. File reads reject special
files, use no-follow/nonblocking flags where supported, and compare full-width file identity
before and after opening. These checks reduce link-swap races; they are not an OS-enforced atomic
containment guarantee against an actively mutating process running as the same user.

Repository discovery metadata in the private preferences cache is descriptive, not an access
capability. Discovery and catalog restoration retain current grants and canonical target checks.
Revoking an overlapping grant removes cached skills only when no remaining grant covers them.
Repository-scoped plugin rows do not broaden plugin actions: the existing IPC install-identity,
enablement, folder access, and CLI working-directory checks still apply.

User-data reads remain centralized in `permissions.ts`. Separate capabilities serve fixed CLI
discovery, preparation of Electron's private cache, and compiled app assets. None accepts an
arbitrary renderer filesystem path or broadens the skill permission set. Production assets use
`megatron://app`, a flat asset whitelist and a restrictive CSP. Browser permissions are denied.

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
This location lookup grants no access and does not replace guarded reads. Regression tests exercise
real aliases on both platforms, project/local plugin cleanup without source-file writes, explicit
missing grants, revoked access, and broken or retargeted links. The CI matrix completes both operating
systems independently so a failing platform cannot cancel the other platform's validation.

Complete scans reconcile deleted nested and synced skill roots. Partial scans retain cached name
qualification and plugin disablement. Invocation and turn recovery consider unchanged replay
sessions when their canonical owner changes or disappears, inside the scan transaction.

Lint findings are preserved for unreadable documents and failed rule evaluations. Recursive YAML
metadata is a document finding rather than a process-wide parsing failure.

## Usage correctness

- Parser version 9 safely reprocesses cached transcripts after the semantic changes.
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

Ingestion and linting run in one coalesced worker with a 60-second deadline and a 384 MiB V8 old
generation limit. Worker termination completes before folder grants change. Focus scans are rate
limited. Directory enumeration returns at most 20,000 entries; nested discovery allows 64 levels
and 50,000 directories. Transcript snapshots retain at most 200,000 records / 128 MiB, and prompt
history at most 500,000 rows / 64 MiB. Limit failures preserve affected cached snapshots and report
partial or failed scans. Transactions preserve consistency on termination; scans are not one
transaction across every source. Native allocations are outside V8's heap limit.

Frontmatter is capped at 256 KiB, 10,000 AST nodes, 32 levels and 100 aliases. Metadata expansion
is counted before serialization and capped at 256 KiB. The Markdown link scanner makes one pass
over each line. Plugins keep their quality-check exemption, but resource-limit and cyclic-metadata
findings apply to every source. History queries return 200 rows per page; dialogs expose Load more
and identify searches as applying to loaded entries.

Permission-aware buffered file reads are capped at 16 MiB, and streamed transcript/history lines
at 64 MiB. The line assembler scans incoming chunks once; it does not repeatedly split a growing
line. An oversized line fails the source read instead of emitting truncated JSON.

File previews allow 256 KiB per file and 4 MiB of aggregate content. Traversal is capped at 1,024
files, 4,096 entries, and 32 directory levels, with cycle protection. Omitted content or traversal
is explicitly marked as a preview limit. These limits affect previews, not the underlying files.

Scan attempts report complete, partial, or failed outcomes separately from whether the attempt
has finished. Partial results show a status message and retain available data. Settings reports
the rescan result; usage and activity dialogs distinguish loading, errors, and empty results.

## Dependencies and validation

Electron is updated within major 43, Vitest to a maintained Node 22-compatible release, and
compatible transitive security fixes are recorded in the lockfile. Install-script approvals are
explicit for the selected Electron, SQLite, and esbuild packages. The obsolete downloader chain is
replaced with `@electron/get` 5.1.0; `source-map-js` is pinned to 1.2.2. Node 22.12+ within major 22
is required.

Runtime packaging uses a positive allowlist. Electron fuses disable RunAsNode, Node startup and
inspector injection, and extra file-protocol privileges. ASAR integrity and ASAR-only loading are
enabled. Signed macOS builds retain only the JIT entitlement; ad-hoc release builds add
`disable-library-validation` (see Release and updates). Windows uses per-user NSIS with elevation
disabled.

The index contains plaintext prompt excerpts, skill arguments, repository paths and usage metadata.
Megatron has no automatic upload of the index. Default macOS cache directories/files use modes
0700/0600. Windows cache ACLs allow only the current user, SYSTEM and Administrators through a fixed absolute
Windows PowerShell command with paths passed as environment values. Linked or special cache files
are rejected, including hardlinks. Existing custom profile parent permissions are preserved;
directory changes apply only to a new directory or the exact default app-owned directory. Cache
files are protected separately. These permissions do not encrypt data or protect against another process running as
the same user. Prompt history mirrors Claude retention; transcript cache rows reconcile after a
successful authoritative scan. Failed reads can retain older rows until the next successful scan.
To erase the derived cache, quit Megatron and remove `megatron.db`, `megatron.db-wal` and
`megatron.db-shm` from the data folder revealed in Settings; folder grants live in `preferences.json`
and survive. No schema migration or real Claude file modification is part of this work.

Validation uses failing backend regressions followed by full tests, both type checks, lint,
build, a lockfile install, and actual Electron checks in temporary profiles. Windows execution
does not establish macOS packaging correctness; macOS CI and release checks remain required.

## Release and updates (2026-11-04)

The decisions, their reasons, and upgrade paths live in `docs/releases.md`; this section covers
their security consequences.

**Unsigned by default.** There is no Developer ID or paid Windows signing yet.
`scripts/release-build.mjs` builds macOS ad-hoc signed (`mac.identity: "-"`, not notarized) and
Windows unsigned. The Developer ID / Authenticode path (credential validation,
`forceCodeSigning`, app and DMG notarization, stapling, `trusted`-level verification) runs only
when the repository variable `MEGATRON_SIGNED_RELEASE` is exactly `true`; any value other than
`true`, `false` or unset fails the build. The switch is explicit rather than "sign if secrets
exist" so an expired or deleted secret fails loudly instead of quietly shipping an unsigned
release. Unsigned builds strip `CSC_*` secrets from the build environment, because electron-builder
signs Windows whenever `CSC_LINK` is set.

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
CI then creates a **draft** GitHub Release and uploads the DMG, `-mac.zip`, NSIS installer,
blockmaps and `latest*.yml`. Nothing reaches users until a maintainer publishes the draft.

**Update trust model.** Only the main process talks to the network for updates; the renderer CSP
(`connect-src 'none'`) is unchanged. electron-updater reads `Megatron-HQ/Megatron`'s releases over
HTTPS, downloads the artifact named in `latest*.yml`, and checks its sha512. With no code signature,
nothing beyond that authenticates the publisher: **whoever can publish a release on
Megatron-HQ/Megatron can ship code to every Windows install**, and to every Mac install through the
tap. Keep release-capable accounts few and 2FA-protected. The macOS build never installs updates
itself (Squirrel.Mac requires a Developer ID). Its Download button opens a
`github.com/Megatron-HQ/Megatron/releases/tag/v<version>` URL that main builds from the updater's
version, accepting plain semver only; the renderer never supplies the URL.

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

## Verification evidence (2026-10-02)

- Vitest: 848 passed, 4 intentionally skipped, across 41 files.
- Node and renderer type checks, lint, production build, and lockfile installation passed.
- `npm audit` reports zero vulnerabilities for the installed lockfile.
- The full Electron visual sweep captured and reviewed 144 screenshots at the default and
  minimum window sizes, including ten new error/loading/limit scenarios. No document overflow
  or renderer console/page errors were detected. Twenty captures were skipped because their
  required local data was absent; six older baseline files have no matching scenario.
- Isolated Electron checks verified blocked external navigation, rejected external-page IPC,
  absence of raw IPC exposure, rolling-total reconciliation, and an open history dialog updating
  after rescan without reopening. Expected ungranted plugin settings report a partial scan.
- A 600 MiB synthetic transcript scanned in 3.2 seconds cold and 4 ms unchanged, with 99 MiB
  peak process RSS. Both scans completed. Long-line probes covered 8, 16, and 32 MiB inputs.

Benchmarks are local observations on this Windows machine, not performance guarantees.
Visual verification uses temporary profiles; fixture handlers exist only in the verifier's
entry point and are absent from the production bundle. No real Claude files or plugin installs
were modified during verification.

## Verification evidence (2026-10-10)

- Vitest: 909 passed, with four platform-specific tests and one opt-in benchmark skipped,
  across 53 files. Six package/release-security regressions passed separately.
- Node and renderer type checks, lint, production build, lockfile installation and generated
  mirror checks passed. The refreshed advisory scan reports zero known vulnerabilities.
- The full visual sweep produced 164 captures (20 new, 120 changed, 24 unchanged) and 24 explicit
  local-data skips. Every new/changed capture was reviewed at both sizes; data-drift baselines
  were retained. No document overflow or renderer console/page errors were detected by the runner.
  A separate empty/many-folder check found and corrected dialog height clipping at the minimum
  size; the correction was captured and reviewed once at both sizes.
- Actual Electron IPC verified an authorized synthetic project plugin action using a trusted
  native executable. The hostile project-local command marker was absent. Native and npm CLI
  module fixtures passed too. All fixtures used temporary profiles/projects and never reached
  the real Claude CLI.
- Runtime checks verified the sandbox, context bridge, trusted-frame IPC, constrained asset
  protocol, blocked navigation and worker/SQLite scans. The rebuilt fused Windows executable
  launched and populated its isolated index from the ASAR worker.
- The actual Windows package passed inspection of 9,578 archive entries, unpacked file roots and
  all six required fuses. Per-user NSIS built with elevation and its helper disabled. Signature
  verification correctly rejected the unsigned local artifact.
- Actual signed/notarized release artifacts and clean Windows/macOS installation, upgrade and
  uninstall remain pending. This Windows session does not establish macOS runtime correctness.

Finding coverage, commands and remaining release requirements are recorded in
[security-fix-status-2026-10-10.md](security-fix-status-2026-10-10.md).

## Live inventory verification (2026-11-05)

- Vitest: 1,202 passed and four skipped across 70 files. Type checks, lint, build, and generated
  mirror checks passed.
- An isolated Windows Electron check disabled focus refreshes and exercised real additions,
  edits, deletions, directory moves, plugin settings, and deletion of a project's `.claude`
  directory. Typical live updates completed in 1.2–1.4 seconds. Selection recovery, retention of
  an explicitly granted missing project, and unchanged Claude registry contents were verified.
  No renderer errors were observed. These timings are local observations, not guarantees.
- The completed full visual sweep produced 338 captures and 16 explicit local-data skips,
  with no horizontal overflow or renderer console/page errors. All 119 new/changed captures
  were reviewed at the actual default and minimum window sizes; live-data differences were
  not promoted. This includes ten new captures for scoped warnings, removed-project recovery,
  and retention of the manual rescan result through inventory-only and full background scans.
- Simulated scan screens isolate their notification timeline from real background scans in
  the test-only entry point. A separate Electron check confirmed the source-badge tooltip at
  both sizes after one capture missed its hover timing; that capture was not promoted.

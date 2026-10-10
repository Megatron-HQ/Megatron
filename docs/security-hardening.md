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

User-data reads remain centralized in `permissions.ts`. Separate capabilities serve fixed CLI
discovery, preparation of Electron's private cache, and compiled app assets. None accepts an
arbitrary renderer filesystem path or broadens the skill permission set. Production assets use
`megatron://app`, a flat asset whitelist and a restrictive CSP. Browser permissions are denied.

Unavailable reads differ from confirmed missing sources. Unavailable skill documents, settings,
registries, transcript reads, and transcript metadata checks preserve the last usable index.
Readable siblings can still refresh. An invalid registry structure is not an empty registry.

Complete scans reconcile deleted nested and synced skill roots. Partial scans retain cached name
qualification and plugin disablement. Invocation and turn recovery consider unchanged replay
sessions when their canonical owner changes or disappears, inside the scan transaction.

Lint findings are preserved for unreadable documents and failed rule evaluations. Recursive YAML
metadata is a document finding rather than a process-wide parsing failure.

## Usage correctness

- Parser version 9 safely reprocesses cached transcripts after the semantic changes.
- Stored timestamps are validated and normalized; malformed cached cost timestamps cannot crash
  chart reducers. Resident samples use the same first-turn timestamp policy.
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
enabled. macOS retains only the JIT entitlement. Windows uses per-user NSIS with elevation disabled.
The manual release workflow requires platform-specific credentials, timestamped Windows signatures
with the expected publisher, Developer ID validation, and app/DMG notarization and stapling. It
creates artifacts without publishing a release.

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
`megatron.db-shm` from the data folder revealed in Settings. No schema migration or real Claude file
modification is part of this work.

Validation uses failing backend regressions followed by full tests, both type checks, lint,
build, a lockfile install, and actual Electron checks in temporary profiles. Windows execution
does not establish macOS packaging correctness; macOS CI and release checks remain required.

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

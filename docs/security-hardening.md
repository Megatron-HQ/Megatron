# Security and scan integrity hardening

This work addresses the confirmed codebase audit findings and preserves the original Copilot
regression fixes. The index remains a derived cache; no schema migration is introduced.

## Security boundary

- Only the registered application window's main frame, at its exact trusted renderer URL, may
  invoke application IPC. Navigation and redirects outside that page are blocked.
- The preload exposes the typed application API and platform name. Raw IPC and environment
  variables are not exposed. The isolated, unsandboxed ESM preload is retained.
- Plugin actions require validated identifiers, an enumerated scope, a matching indexed install,
  known enablement, and permission for a recorded project directory. Writes still use Claude's CLI.
- Cost aggregation uses objects without prototypes, including inner model buckets.

## Cache preservation

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
explicit for the selected Electron, SQLite, and esbuild packages. Windows installer scripts are
not needed for the macOS shipping target.

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

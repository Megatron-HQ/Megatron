# Security fix status — 2026-10-10

The code fixes and release safeguards from the approved audit plan are implemented. Public
release is still gated on actual signing/notarization and clean-machine
installation checks. This report records what was verified and what remains unverified; it is
not a guarantee that every possible vulnerability has been found.

The audit reviewed commit `6a8a79b471bb99f43da2ee958731284cd7ba7dcb`. No release was published,
and no real Claude configuration, skills, transcripts or
plugin installations were changed by the security fixtures.

## Finding coverage

| Finding                                     | Implemented change                                                                                                                                                                                                                                   | Verification and remaining scope                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1: Project-local Claude executable hijack  | Resolve an absolute native Claude executable or trusted npm CLI entry outside the selected project; use an absolute Node executable for npm installs; launch with `shell: false`; sanitize PATH and Node startup variables.                          | Native and npm fixtures passed, including spaces and scoped arguments. A full Electron IPC fixture authorized a synthetic indexed project install and ran the trusted executable; the project-local `claude.cmd` marker was absent. Installed CLI directories remain part of the user's trusted software environment. |
| A2: Markdown link backtracking              | Replace the quadratic link regex with a single-pass extractor handling escapes and nested target parentheses.                                                                                                                                        | Adversarial unmatched delimiters and normal link regressions passed.                                                                                                                                                                                                                                                  |
| A3: YAML metadata amplification             | Share bounded frontmatter parsing between ingestion, linting and Markdown rendering. Limit document size, AST nodes, nesting, aliases and expanded metadata before serialization. Reject cycles.                                                     | Alias amplification, cycles and size/depth limits passed; usable name/description survive invalid optional metadata. Security limits also apply to plugin skills.                                                                                                                                                     |
| A4: Linked files escape granted directories | Require both the discovered path and canonical target to be approved; persist canonical grants; restore saved roots without approving a retargeted link. Reject special files and compare opened file identity.                                      | Windows junction escape, explicit target grants, retargeted roots and restored grants passed. Portable checks reduce races but do not provide atomic OS containment against an actively mutating same-user process.                                                                                                   |
| H1: Unbounded scanning and IPC payloads     | Coalesce scans in a cancellable worker with time/heap limits; bound directories, retained transcript/history data and previews; paginate invocation queries at 200 rows. Wait for worker termination before permission changes.                      | Real worker success, crash, deadline and cancellation tests passed. Stable paging, source preservation and traversal limits passed. Paging UI was exercised with 203 synthetic invocations. Native memory and cross-source transaction limitations are described below.                                               |
| H2: Unsandboxed preload                     | Enable the renderer sandbox and preserve context isolation/node integration restrictions. Keep source ESM; emit only the generated preload as CommonJS.                                                                                              | The running Electron app verified sandbox preferences, bridge availability and absence of raw Node/IPC access. The generated-output exception is recorded in `CLAUDE.md` and its generated mirror.                                                                                                                    |
| H3: File protocol and browser permissions   | Serve compiled renderer assets through constrained `megatron://app` routes; restrict CSP; deny browser permission checks, requests and device access; retain frame-bound IPC and navigation restrictions.                                            | Runtime checks verified the custom origin, unavailable arbitrary asset routes, blocked external navigation and rejected IPC from an untrusted page. Safe Markdown rendering was reviewed in the app.                                                                                                                  |
| H4: Fuses, integrity and macOS entitlements | Disable RunAsNode, Node environment injection, inspector arguments and extra file privileges. Enable ASAR integrity and ASAR-only loading. Keep only the macOS JIT entitlement.                                                                      | The actual Windows package is inspected by `verify-package.mjs` and exercised by the packaged smoke script. Actual signed macOS runtime/SQLite behavior remains a release check.                                                                                                                                      |
| H5: Broad packaging inclusion               | Use a positive compiled-runtime/resource allowlist plus production dependencies; inspect ASAR and unpacked files for developer files and sensitive filenames.                                                                                        | Artifact validation and negative manifest regressions passed. Production output contains no visual fixture handlers.                                                                                                                                                                                                  |
| H6: Release authenticity                    | Select per-user NSIS without elevation or an elevation helper; require release credentials and signing; verify timestamped Windows signatures and expected publisher; enable Developer ID/hardened runtime/notarization and app/DMG stapling checks. | Configuration, credential rejection and local unsigned packaging are verified. Actual certificate identity, notarization and clean installation/upgrade/uninstall are pending. Local unsigned artifacts are development evidence only.                                                                                |

## Additional plan items

- Electron is pinned to 43.7.9. The obsolete downloader chain is removed through
  `@electron/get` 5.1.0, and `source-map-js` is pinned to 1.2.2. The refreshed lockfile installs
  successfully with `npm ci`. `npm audit` reports zero known advisories across all installed
  dependencies as of this verification, including development dependencies.
- CI actions are pinned to verified commit SHAs, repository permissions are read-only, and
  moderate-or-higher dependency advisories fail CI. Backend and package security regressions,
  type checking, lint, builds and package inspection are part of the checks.
- New/default app-owned cache directories are protected, as are the fixed SQLite/preferences
  files. Windows ACLs retain the current user, SYSTEM and Administrators; macOS uses 0700/0600.
  Linked/special cache objects and hardlinked cache files are rejected. An existing custom
  profile's parent permissions are preserved. Protection does not encrypt the plaintext index
  or defend against processes running as the same user.
- Folder guidance explains explicit target grants for linked skills. The dialog now keeps its
  header and actions visible with a long folder list at the minimum size. Existing button,
  tooltip, loading and revoke behavior is preserved.
- History dialogs load bounded pages, retain filters/expansion/grouping/navigation, expose
  retry and Load more controls, and explain that search applies to loaded entries. There is no
  schema change, migration or cache reset.

## Verification evidence

| Check                             | Result                                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                        | 909 passed; 4 platform-specific skips and 1 opt-in benchmark skipped; 53 test files passed.                                                                                                                                                              |
| `npm run test:package-security`   | 6 passed.                                                                                                                                                                                                                                                |
| `npm run build`                   | Both TypeScript checks and all main/worker/preload/renderer builds passed.                                                                                                                                                                               |
| `npm ci`                          | Lockfile installation and automatic lifecycle scripts passed.                                                                                                                                                                                            |
| `npm audit --json`                | Zero known vulnerabilities; 888 installed dependency entries.                                                                                                                                                                                            |
| `node scripts/cli-ipc-smoke.mjs`  | Full Electron plugin IPC fixture passed without reaching the real Claude CLI or executing the hostile project script.                                                                                                                                    |
| `node scripts/security-smoke.mjs` | Sandbox, bridge, trusted/untrusted IPC, asset protocol, navigation and worker/SQLite scans passed in a temporary profile.                                                                                                                                |
| Full visual sweep                 | 164 captures: 20 new, 120 changed and 24 unchanged; 24 captures explicitly skipped for unavailable local data. No document overflow or renderer console/page errors were detected by the runner.                                                         |
| Screenshot review                 | All 140 new/changed captures reviewed at both supported sizes. Live counts, dates and permission-related partial-scan status account for data drift; those changed baselines were not promoted. Twenty reviewed new captures were accepted individually. |
| Folder dialog follow-up           | Empty and 15-folder states captured at both sizes; one height correction made and rechecked. The long-list dialog now fits inside the minimum viewport with the list scrolling.                                                                          |

The visual sweep is a human conformance check, not a behavioral E2E assertion gate. Existing
long-path wrapping in the plugin uninstall confirmation remains a separate UI issue: its path
can extend past the dialog and is not caught by document-level overflow checks. No uninstall
was executed during visual verification. Six historical orphaned baselines were reported.

Final lint and generated-mirror checks passed. The rebuilt Windows NSIS package uses
`oneClick=true`, `perMachine=false`, elevation disabled and no elevation helper. Package
inspection verified all 9,578 ASAR entries, the unpacked allowlist and all six required fuse
settings. The resources directory contains only `app.asar` and `app.asar.unpacked`.

`node scripts/security-smoke.mjs --packaged` passed: the fused executable launched normally
and its ASAR worker populated the isolated SQLite index. Signature-required verification
correctly rejected this unsigned local package. Installer creation and packaged launch are
verified; clean installation, upgrade and uninstall were not run on this development machine.

## Remaining release work

Tracked in [GitHub issue #10](https://github.com/Megatron-HQ/Megatron/issues/10).

1. Configure the release environment's `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`,
   `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` secrets, plus the exact
   `MEGATRON_WINDOWS_PUBLISHER` certificate subject variable. Do not commit credentials.
2. Run the manual signed release workflow. It requires credentials before packaging,
   forces code signing, validates signatures/publisher and app integrity, submits the DMG for
   notarization, staples tickets and validates them. It uploads build artifacts without
   publishing a public release.
3. On clean ordinary-user Windows/macOS machines, install, launch, scan, exercise read-only
   views and a disposable plugin fixture, upgrade, uninstall and relaunch. Check Windows
   signature/SmartScreen behavior and macOS Gatekeeper, signature, notarization and SQLite
   behavior with the reduced entitlements. This session had no clean-machine VM or Mac.
4. Re-run the advisory and package checks against the exact release commit and artifacts,
   then publish only artifacts that pass those checks.

Worker heap limits cover V8 allocations; buffers/native SQLite allocations are outside that
limit. The worker deadline and source budgets reduce exposure but are not a total process-RSS
cap. Source transactions remain individually atomic; terminating a scan can leave earlier
sources refreshed and later sources cached. The UI reports that result as partial/failed.

Canonicalization and full-width file identity checks narrow filesystem race windows rather
than replacing OS-specific atomic handle containment. The app does not claim to protect a user
from another process already running under their own account. Cache retention follows the
existing reconciliation policy; failed/unavailable sources can retain previous cached rows.

The detailed maintained behavior and budgets are in [security-hardening.md](security-hardening.md).

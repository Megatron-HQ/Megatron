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
- Cost aggregation uses objects without prototypes, including inner model buckets.

## Cache preservation

Linked skill paths and their canonical targets must both be approved. The folder picker stores
the canonical grant; restoring grants never resolves a saved root into a new approved target.
Explicit target-folder grants preserve legitimate linked skill stores. File reads reject special
files, use no-follow/nonblocking flags where supported, and compare full-width file identity
before and after opening. Threat: a symlink or junction inside a granted folder pointing outside
it would read files the user never granted. These checks reduce link-swap races; they are not an
OS-enforced atomic containment guarantee against an actively mutating process running as the same
user.

Repository discovery metadata in the private preferences cache is descriptive, not an access
capability. Discovery and catalog restoration retain current grants and canonical target checks.
Revoking an overlapping grant removes cached skills only when no remaining grant covers them.
Repository-scoped plugin rows do not broaden plugin actions: the existing IPC install-identity,
enablement, folder access, and CLI working-directory checks still apply.

User-data reads remain centralized in `permissions.ts`. Separate capabilities serve fixed CLI
discovery, preparation of Electron's private cache, and compiled app assets. None accepts an
arbitrary renderer filesystem path or broadens the skill permission set. Production assets use
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
at 64 MiB. The line assembler scans incoming chunks once; it does not repeatedly split a growing
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
files are rejected, including hardlinks. Existing custom profile parent permissions are preserved;
directory changes apply only to a new directory or the exact default app-owned directory. Cache
files are protected separately. These permissions do not encrypt data or protect against another
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

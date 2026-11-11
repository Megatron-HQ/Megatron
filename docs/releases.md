# Releases

How Megatron is published on macOS and Windows: what was decided, why, and how to upgrade it. Every
decision here follows from one constraint: **no paid code signing** (founders' call, November 2026).
Security consequences live in `docs/security-hardening.md` ("Release and updates"); what data must
survive an update is ruled by `docs/data-model.md`.

## Decisions

| Decision                                                                                                                                                                                       | Why                                                                                                                                                      | Where                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Unsigned by default. Signing runs only when the repo variable `MEGATRON_SIGNED_RELEASE` is exactly `true`; any other non-empty value fails the build                                           | Explicit, so an expired or deleted secret fails loudly instead of quietly shipping unsigned                                                              | `scripts/release-build.mjs`, `.github/workflows/release.yml`         |
| macOS: arm64 only, ad-hoc signed (`identity: "-"`), DMG + zip. Ad-hoc builds add `disable-library-validation`                                                                                  | arm64 won't launch unsigned code, and hardened runtime rejects Electron's Apple-Team-signed frameworks inside an ad-hoc app                              | `electron-builder.yml`, `build/entitlements.mac.adhoc.plist`         |
| macOS primary channel: own tap `Megatron-HQ/homebrew-tap` (`brew install --cask megatron-hq/tap/megatron`); DMG secondary                                                                      | homebrew/cask has disabled Gatekeeper-failing casks since 2026-09-01, and Homebrew 7.0.11 has no `--no-quarantine`, so the cask strips quarantine itself | `.github/homebrew/megatron.rb`, `.github/workflows/homebrew-tap.yml` |
| macOS updates: check only; `brew upgrade` (or a fresh DMG) installs                                                                                                                            | Squirrel.Mac refuses to install into an app without a Developer ID                                                                                       | `src/main/updater.ts`                                                |
| Windows: x64 per-user NSIS, unsigned, full auto-update — quiet download, "Restart to update", install on quit, never forced                                                                    | SmartScreen's "Run anyway" is the price of no signing; updates still verify sha512                                                                       | `electron-builder.yml`, `src/main/updater.ts`                        |
| Flow: `v*` tag (must equal `package.json`'s version) → CI builds a **draft** GitHub Release → a human publishes → the tap workflow writes the cask                                             | Nothing reaches users without a person reviewing the draft                                                                                               | `scripts/release-check.mjs`, both workflows                          |
| Update checks on by default (10 s after launch, then every 6 h) with a Settings toggle; the notice is an info-tone dot on the Settings gear. Main builds every URL; the renderer supplies none | DESIGN.md's One Stamp and Tones-Aren't-The-Stamp rules; the renderer stays untrusted                                                                     | `src/main/updater.ts`, `AppRail.tsx`, `SettingsDialog.tsx`           |
| The index rebuilds on any `schema.sql` change, folder grants live in `preferences.json`, and `usage-history.db` is additive-only                                                               | Shipped users can't run `db:reset`, and the archive can't be rebuilt                                                                                     | `docs/data-model.md`                                                 |
| A release line is proven by a two-release **dry run** (vN → vN+1) on both OSes before it is announced                                                                                          | An update path only exists between two published releases                                                                                                | —                                                                    |

## Upgrade paths

**Apple Developer ID (paid).**

1. Add `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` and the `APPLE_*` secrets to the `release` environment
   and set the switch; the existing signed path notarizes and staples.
2. In `updater.ts`, give `darwin` the Windows behavior (download, install on quit, "Restart to
   update") and adjust the Settings copy.
3. In the cask, add `auto_updates true` and drop the quarantine `postflight_steps`; submitting to
   official homebrew/cask becomes possible. Drop the README's Open Anyway steps.

**The switch is global.** With `MEGATRON_SIGNED_RELEASE=true`, both matrix jobs demand credentials
(`validateReleaseEnvironment`). To sign one platform first, make the switch per-platform in
`release-build.mjs` and `release.yml`.

**Windows signing.**

- Options: SignPath Foundation (free for open source; apply once `references/` is confirmed free of
  non-OSS code) or Azure Trusted Signing (paid; `win.azureSignOptions`). The existing `CSC_LINK`
  `.pfx` path is likely dead: since June 2023, CAs issue code-signing keys only on hardware tokens or
  cloud HSMs.
- The first signed release locks in a publisher. electron-updater checks each update against the
  `publisherName` in the _installed_ app's `app-update.yml` (`NsisUpdater.verifySignature`, 6.8.x).
  Unsigned builds carry none, so they accept any update. Once a signed build is installed, a
  certificate with a different subject breaks updates for every copy, unless an earlier build
  already listed both names (`publisherName` under `win.signtoolOptions` / `win.azureSignOptions`
  takes an array).

**More architectures.** Add arches to the `electron-builder.yml` targets. An Intel Mac build also
changes the cask: its `depends_on arch: :arm64` and single zip URL become per-arch URLs or a
universal build.

## Gotchas

- Artifact names stay space-free: GitHub rewrites spaces in asset URLs, which breaks `latest*.yml`.
- electron-builder is 26.x. Context7's default docs are v27, which renamed APIs; query the 26.x
  docs.
- `package.json` has no `productName`, so `userData` is `~/Library/Application Support/megatron`
  (lowercase); the cask's `zap` paths and `scripts/db.mjs` depend on it.
- Homebrew 7 casks use `postflight_steps`; `brew style` rejects a legacy `postflight` block.
- Unsigned builds strip `CSC_*` from the build environment, because electron-builder signs Windows
  whenever `CSC_LINK` is set.
- electron-updater emits `error` _and_ rejects `checkForUpdates()` for the same failure;
  `updater.ts` reports it once.
- `verify-package.mjs` checks at three levels (`none`, `adhoc`, `trusted`), matching the build.

## Open until the first dry run (as of 2026-11-07)

Update this list as the dry run answers each item.

- `release.yml` and `homebrew-tap.yml` have never run; their first run is the `v0.1.0` tag.
- Whether the cask's sandboxed `postflight_steps` actually removes quarantine. Fallback: the
  README's Open Anyway steps.
- An unsigned NSIS update end to end. The code path skips verification; it hasn't been observed yet.
- `HOMEBREW_TAP_TOKEN` must be regenerated before launch.

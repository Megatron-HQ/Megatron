---
name: git-workflow
description: Use before any commit, push, pull request, or release in Megatron.
---

# Git workflow

## Branches

- **Work on `staging`**, the default branch. Never push to `main`: it is production, and it receives staging only through a "Promote staging" PR once the changes are final. A person merges that PR.
- **Releases come only from `main`.** `release-check.mjs` refuses a tag whose commit isn't contained in `origin/main`.

## Commits

- **A commit that ships a user-facing feature adds a highlight to the `next` entry** in `src/shared/whats-new.json`, creating the entry if it's absent (4 highlights at most). That entry becomes the What's new card users see after updating. Fixes, CI, docs and refactors leave it alone.

## Release PR

- **The release PR bumps the version with `npm version <x.y.z> --no-git-tag-version`.** Its hook renames `next` to `<x.y.z>`. A release without `next` ships no card. `docs/releases.md` owns the details.

## Push

Before each push, complete applicable local verification. After every push, monitor GitHub Actions for the exact pushed commit SHA and wait for **both** `check (macos-latest)` and `check (windows-latest)` to finish successfully. Do not report the commit/push task complete while either job is queued, running, failed, cancelled, or unverified. Investigate failures, fix and revalidate locally, push the correction, and verify both jobs again. Include the final commit SHA and successful CI run link in the completion report. If CI cannot be checked, state that verification is incomplete.

// Runs as npm's `version` lifecycle script: after `npm version <x>` bumps package.json, the What's
// new draft written on staging under "next" becomes the entry for <x>. release-check.mjs refuses to
// tag while "next" remains, so this only removes the manual step, not the safety net.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WHATS_NEW_DRAFT_KEY = 'next'
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// Returns whether the file changed. A catalog without a draft is a quiet release and stays as is.
export function stampWhatsNewFile(path, version) {
  if (!RELEASE_VERSION.test(version))
    throw new Error(`"${version}" is not a release version; pass npm version an explicit x.y.z`)
  const catalog = JSON.parse(readFileSync(path, 'utf8'))
  if (!Object.hasOwn(catalog, WHATS_NEW_DRAFT_KEY)) return false
  if (Object.hasOwn(catalog, version))
    throw new Error(
      `${path} already has a "${version}" entry; merge "${WHATS_NEW_DRAFT_KEY}" into it by hand`
    )
  const { [WHATS_NEW_DRAFT_KEY]: draft, ...released } = catalog
  writeFileSync(path, JSON.stringify({ [version]: draft, ...released }, null, 2) + '\n')
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  const catalogPath = fileURLToPath(new URL('../src/shared/whats-new.json', import.meta.url))
  if (stampWhatsNewFile(catalogPath, version))
    console.log(`What's new: stamped "${WHATS_NEW_DRAFT_KEY}" as ${version}`)
}

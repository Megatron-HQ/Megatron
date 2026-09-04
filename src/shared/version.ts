interface ParsedSemver {
  major: string
  minor: string
  patch: string
  prerelease: string[] | null
}

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function compareNumericIdentifiers(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  if (a === b) return 0
  return a < b ? -1 : 1
}

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) return null

  const prerelease = match[4]?.split('.') ?? null
  if (
    prerelease?.some(
      (identifier) =>
        /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')
    )
  ) {
    return null
  }

  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease
  }
}

export function isSemanticVersion(version: string): boolean {
  return parseSemver(version) !== null
}

function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1

  const sharedLength = Math.min(a.length, b.length)
  for (let index = 0; index < sharedLength; index++) {
    const aIdentifier = a[index]
    const bIdentifier = b[index]
    if (aIdentifier === bIdentifier) continue

    const aNumeric = /^\d+$/.test(aIdentifier)
    const bNumeric = /^\d+$/.test(bIdentifier)
    if (aNumeric && bNumeric) return compareNumericIdentifiers(aIdentifier, bIdentifier)
    if (aNumeric) return -1
    if (bNumeric) return 1
    return aIdentifier < bIdentifier ? -1 : 1
  }

  return a.length - b.length
}

function compareSemver(a: string, b: string): number | null {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)
  if (!parsedA || !parsedB) return null

  for (const field of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumericIdentifiers(parsedA[field], parsedB[field])
    if (comparison !== 0) return comparison
  }

  return comparePrerelease(parsedA.prerelease, parsedB.prerelease)
}

export function isUpdateAvailable(
  installedVersion: string,
  availableVersion: string | null
): boolean {
  const installed = installedVersion.trim()
  const available = availableVersion?.trim()
  if (!available || available === 'unknown') return false
  if (installed === 'unknown') return true

  const semverComp = compareSemver(available, installed)
  if (semverComp !== null) return semverComp > 0

  // Non-semver identifiers (for example, immutable commit SHAs) have no ordering metadata.
  // The marketplace snapshot is the target state, so a distinct known identifier is actionable.
  return installed !== available
}

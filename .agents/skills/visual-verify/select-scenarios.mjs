// Resolves which scenarios a `npm run verify:visual` run should capture.
// Split out of verify.mjs so it can be unit-tested without launching Electron —
// verify.mjs itself can't be (it builds and drives the packaged app).
//
// Default (no --only) is still the full sweep. `--only <screen,screen>` narrows
// the run to the scenarios tagged with those screens (scenarios.mjs `screen`
// field), plus any scenario that has no baseline yet — a newly added screen must
// be captured its first time even if its screen wasn't the one named. See
// SKILL.md "Scope the run".

/** The set of every screen name at least one scenario is tagged with. */
export function knownScreens(scenarios) {
  return new Set(scenarios.flatMap((scenario) => [].concat(scenario.screen)))
}

/**
 * Pull `--only` out of a raw argv slice. Accepts `--only a,b` and `--only=a,b`.
 * Returns null when the flag is absent (→ full run), a non-empty string[] of
 * screen names otherwise. Throws when the flag is present but names nothing —
 * that's a mistake, not a request for a full run.
 */
export function parseOnly(argv) {
  let raw = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') {
      raw = argv[i + 1] ?? ''
      break
    }
    if (argv[i].startsWith('--only=')) {
      raw = argv[i].slice('--only='.length)
      break
    }
  }
  if (raw === null) return null

  const screens = raw
    .split(',')
    .map((screen) => screen.trim())
    .filter(Boolean)
  if (screens.length === 0) {
    throw new Error('--only was given but names no screens (e.g. --only skill-detail,sidebar)')
  }
  return screens
}

/** True if `.visual-verify-baselines/` holds any size's PNG for this scenario. */
function hasBaseline(scenarioName, baselineNames) {
  for (const file of baselineNames) {
    // "<scenario-name>--<size-label>.png" — "--" is only ever the size separator.
    const separator = file.lastIndexOf('--')
    if (separator !== -1 && file.slice(0, separator) === scenarioName) return true
  }
  return false
}

/**
 * @param scenarios  the full scenario list (scenarios.mjs)
 * @param only       parseOnly()'s result — null for a full run, else screen names
 * @param baselineNames  filenames in `.visual-verify-baselines/` (readdir output)
 * @returns the scenarios to capture this run
 * @throws if `only` names a screen no scenario is tagged with
 */
export function selectScenarios(scenarios, only, baselineNames) {
  if (only === null) return scenarios

  const known = knownScreens(scenarios)
  const unknown = only.filter((screen) => !known.has(screen))
  if (unknown.length > 0) {
    throw new Error(
      `--only names unknown screen(s): ${unknown.join(', ')}\n` +
        `valid screens: ${[...known].sort().join(', ')}`
    )
  }

  return scenarios.filter(
    (scenario) =>
      [].concat(scenario.screen).some((screen) => only.includes(screen)) ||
      !hasBaseline(scenario.name, baselineNames)
  )
}

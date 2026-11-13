// Everything the fixture check decides from data it already has: whether two screenshots differ,
// which components no fixture renders, which edits changed nothing, and what to print. No browser,
// no server, no file system, so `node --test` covers it.
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export function shotPath(id, size, theme) {
  return `${id}--${size}-${theme}.png`
}

export function selectFixtures(ids, filter) {
  if (!filter) return ids
  const wanted = filter.toLowerCase()
  return ids.filter((id) => id.toLowerCase().includes(wanted))
}

/**
 * Null when both PNGs show the same pixels. Otherwise the number of differing pixels, the smallest
 * box around them, and a PNG of before, after and the diff side by side.
 *
 * Any difference counts (no tolerance, anti-aliasing included): both renders come from the same
 * browser on the same machine, where a repeat is byte-identical, so a one-step colour change in a
 * design token is a real change and not rendering noise.
 */
export function compareShots(beforeFile, afterFile) {
  if (beforeFile.equals(afterFile)) return null
  const before = PNG.sync.read(beforeFile)
  const after = PNG.sync.read(afterFile)
  const { width, height } = after
  if (before.width !== width || before.height !== height) {
    return { pixels: width * height, box: { x: 0, y: 0, width, height }, composite: afterFile }
  }
  const diff = new PNG({ width, height })
  const pixels = pixelmatch(before.data, after.data, diff.data, width, height, {
    threshold: 0,
    includeAA: true
  })
  if (pixels === 0) return null

  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      // pixelmatch paints a differing pixel pure red and everything else a shade of grey.
      if (diff.data[at] !== 255 || diff.data[at + 1] !== 0 || diff.data[at + 2] !== 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }

  const composite = new PNG({ width: width * 3, height })
  for (const [index, image] of [before, after, diff].entries()) {
    PNG.bitblt(image, composite, 0, 0, width, height, index * width, 0)
  }
  return {
    pixels,
    box: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
    composite: PNG.sync.write(composite)
  }
}

// `blocked` files are reached but not walked through.
function reachable(graph, start, blocked) {
  const seen = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file !== start && file === blocked) continue
    for (const imported of graph.get(file) ?? []) {
      if (seen.has(imported)) continue
      seen.add(imported)
      queue.push(imported)
    }
  }
  return seen
}

/**
 * A component is covered when a fixture reaches it through imports. The app shell imports every
 * screen, so reaching a component only through the shell does not count: otherwise one whole-app
 * fixture would cover everything and a new screen would never need a fixture of its own.
 *
 * `pending` lists components allowed to be uncovered. An entry that is covered, or is no longer a
 * component, is stale, so the list can only shrink.
 */
export function coverageProblems({ graph, fixtures, components, pending, shell }) {
  const covered = new Set()
  for (const fixture of fixtures) {
    for (const file of reachable(graph, fixture, shell)) covered.add(file)
  }
  const allowed = new Set(pending)
  const known = new Set(components)
  return {
    uncovered: components.filter((file) => !covered.has(file) && !allowed.has(file)).sort(),
    stale: pending.filter((file) => covered.has(file) || !known.has(file)).sort()
  }
}

/**
 * Edited files that at least one fixture imports, where none of those fixtures rendered
 * differently. Either the edit is not visual, or no fixture shows the state it changes.
 */
export function unseenEdits({ graph, fixtures, edited, changed }) {
  const changedFixtures = new Set(changed)
  const fixtureFiles = new Set(fixtures)
  const reach = new Map(fixtures.map((fixture) => [fixture, reachable(graph, fixture)]))
  const unseen = []
  for (const file of edited) {
    if (fixtureFiles.has(file)) continue
    const importers = fixtures.filter((fixture) => reach.get(fixture).has(file))
    if (importers.length === 0 || importers.some((fixture) => changedFixtures.has(fixture)))
      continue
    unseen.push({ file, fixtures: importers.length })
  }
  return unseen
}

/** One entry per distinct problem of a fixture, naming the variants that share it. */
export function formatErrors(errors) {
  const grouped = new Map()
  for (const { id, variant, message } of errors) {
    const key = `${id}\n${message}`
    grouped.set(key, [...(grouped.get(key) ?? []), variant])
  }
  return [...grouped].flatMap(([key, variants]) => {
    const [id, message] = key.split('\n')
    return [`ERROR ${id} (${variants.join(', ')})`, `  ${message}`]
  })
}

/** The text the check prints and whether it should exit non-zero. Unchanged shots are not listed. */
export function formatReport({ fixtures, shots, errors, uncovered, stale, unseen }) {
  const changed = shots.filter((shot) => shot.status === 'changed')
  const fresh = shots.filter((shot) => shot.status === 'new')
  const lines = [
    `${fixtures} fixtures, ${shots.length} shots: ${changed.length} changed, ${fresh.length} new, ${errors.length} errors`
  ]

  lines.push(...formatErrors(errors))
  for (const shot of changed) {
    const { box } = shot
    lines.push(
      `CHANGED ${shot.id} ${shot.variant}: ${shot.pixels} px in ${box.width}x${box.height} at ${box.x},${box.y}`,
      `  ${shot.composite}`
    )
  }
  for (const shot of fresh) lines.push(`NEW ${shot.id} ${shot.variant}`, `  ${shot.path}`)
  for (const file of uncovered) {
    lines.push(
      `UNCOVERED ${file}: no fixture imports it, directly or through another component. ` +
        'Add a fixture file beside it or beside the component that renders it.'
    )
  }
  for (const file of stale) {
    lines.push(`STALE ${file} is covered or gone. Remove it from scripts/fixtures/pending.json.`)
  }
  for (const { file, fixtures: count } of unseen) {
    lines.push(
      `WARNING ${file} was edited but none of the ${count} fixture files that import it rendered differently. ` +
        'If the edit is visual, add a fixture for the state it changes.'
    )
  }
  return {
    text: lines.join('\n'),
    failed: errors.length > 0 || uncovered.length > 0 || stale.length > 0
  }
}

import { APP_SECTIONS, type AppSection } from './ipc'
import { compareSemver, isSemanticVersion } from './version'

// Authored on staging under this key; the release PR renames it to the version it ships in.
// release-check refuses to tag while it remains, so a written entry can't be dropped silently.
export const WHATS_NEW_DRAFT_KEY = 'next'

// Each id maps to a live miniature in the renderer (components/whats-new/previews). The renderer
// keys its registry by this union, so an id without a component fails the web typecheck.
export const WHATS_NEW_PREVIEW_IDS = ['usage-skill-cost'] as const
export type WhatsNewPreviewId = (typeof WHATS_NEW_PREVIEW_IDS)[number]

// Each id marks one control with data-whats-new, where "Show me" rings it and a dot waits.
export const WHATS_NEW_ANCHOR_IDS = ['usage-skill-cost'] as const
export type WhatsNewAnchorId = (typeof WHATS_NEW_ANCHOR_IDS)[number]

export const WHATS_NEW_MAX_HIGHLIGHTS = 4
const MAX_TITLE_LENGTH = 60
const MAX_BODY_LENGTH = 160

export type WhatsNewAction =
  | { kind: 'section'; section: AppSection; anchor?: WhatsNewAnchorId }
  | { kind: 'settings'; anchor?: WhatsNewAnchorId }
  | { kind: 'palette' }

export interface WhatsNewHighlight {
  title: string
  body: string
  preview?: WhatsNewPreviewId
  action?: WhatsNewAction
}

export interface WhatsNewRelease {
  version: string
  title: string
  highlights: WhatsNewHighlight[]
}

// What main tells the renderer at launch. Main owns the bundled catalog and the seen record, so the
// renderer never decides what is news. `latest` is what Settings replays.
export interface WhatsNewInitialState {
  unseen: WhatsNewRelease[] // newest first; empty means the card stays hidden
  latest: WhatsNewRelease | null
  dots: WhatsNewAnchorId[]
}

export interface WhatsNewCatalog {
  releases: WhatsNewRelease[] // newest first
  draft: WhatsNewRelease | null
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(where: string, problem: string): never {
  throw new Error(`whats-new.json ${where}: ${problem}`)
}

function requireOnlyFields(where: string, value: Fields, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown !== undefined) fail(where, `unknown field "${unknown}"`)
}

function requireText(where: string, value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') fail(where, 'must be non-empty text')
  if (value.length > maximumLength) fail(where, `must be at most ${maximumLength} characters`)
  return value
}

function requireMember<T extends string>(where: string, value: unknown, members: readonly T[]): T {
  if (!members.includes(value as T)) fail(where, `must be one of ${members.join(', ')}`)
  return value as T
}

function parseAnchor(where: string, value: Fields): { anchor?: WhatsNewAnchorId } {
  return value.anchor === undefined
    ? {}
    : { anchor: requireMember(`${where}.anchor`, value.anchor, WHATS_NEW_ANCHOR_IDS) }
}

function parseAction(where: string, value: unknown): WhatsNewAction {
  if (!isFields(value)) fail(where, 'must be an object')
  switch (value.kind) {
    case 'section':
      requireOnlyFields(where, value, ['kind', 'section', 'anchor'])
      return {
        kind: 'section',
        section: requireMember(`${where}.section`, value.section, APP_SECTIONS),
        ...parseAnchor(where, value)
      }
    case 'settings':
      requireOnlyFields(where, value, ['kind', 'anchor'])
      return { kind: 'settings', ...parseAnchor(where, value) }
    case 'palette':
      requireOnlyFields(where, value, ['kind'])
      return { kind: 'palette' }
    default:
      return fail(`${where}.kind`, 'must be section, settings or palette')
  }
}

function parseHighlight(where: string, value: unknown): WhatsNewHighlight {
  if (!isFields(value)) fail(where, 'must be an object')
  requireOnlyFields(where, value, ['title', 'body', 'preview', 'action'])
  return {
    title: requireText(`${where}.title`, value.title, MAX_TITLE_LENGTH),
    body: requireText(`${where}.body`, value.body, MAX_BODY_LENGTH),
    ...(value.preview === undefined
      ? {}
      : { preview: requireMember(`${where}.preview`, value.preview, WHATS_NEW_PREVIEW_IDS) }),
    ...(value.action === undefined ? {} : { action: parseAction(`${where}.action`, value.action) })
  }
}

function parseRelease(key: string, value: unknown): WhatsNewRelease {
  const where = `"${key}"`
  if (!isFields(value)) fail(where, 'must be an object')
  requireOnlyFields(where, value, ['title', 'highlights'])
  const highlights = value.highlights
  if (
    !Array.isArray(highlights) ||
    highlights.length === 0 ||
    highlights.length > WHATS_NEW_MAX_HIGHLIGHTS
  )
    fail(`${where}.highlights`, `must list 1 to ${WHATS_NEW_MAX_HIGHLIGHTS} highlights`)
  return {
    version: key,
    title: requireText(`${where}.title`, value.title, MAX_TITLE_LENGTH),
    highlights: highlights.map((highlight, index) =>
      parseHighlight(`${where}.highlights[${index}]`, highlight)
    )
  }
}

// Throws on the first problem, naming where it is: the catalog is authored by hand and a test
// parses the shipped file, so a bad entry fails CI instead of reaching users.
export function parseWhatsNewCatalog(raw: unknown): WhatsNewCatalog {
  if (!isFields(raw)) fail('root', 'must be an object keyed by version')
  let draft: WhatsNewRelease | null = null
  const releases: WhatsNewRelease[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (key === WHATS_NEW_DRAFT_KEY) draft = parseRelease(key, value)
    else if (isSemanticVersion(key)) releases.push(parseRelease(key, value))
    else fail(`"${key}"`, `key must be a semantic version or "${WHATS_NEW_DRAFT_KEY}"`)
  }
  releases.sort((first, second) => compareSemver(second.version, first.version) ?? 0)
  return { releases, draft }
}

const isAtOrBelow = (version: string, ceiling: string): boolean =>
  (compareSemver(version, ceiling) ?? 1) <= 0

// `seenVersion` null means an upgrader from before this feature: there is no record of what they
// ran last, so only the running version's own entry is news to them.
export function selectUnseenReleases(
  releases: WhatsNewRelease[],
  currentVersion: string,
  seenVersion: string | null
): WhatsNewRelease[] {
  if (!isSemanticVersion(currentVersion)) return []
  const seen = seenVersion !== null && isSemanticVersion(seenVersion) ? seenVersion : null
  if (seen === null)
    return releases.filter((entry) => compareSemver(entry.version, currentVersion) === 0)
  return releases.filter(
    (entry) =>
      isAtOrBelow(entry.version, currentVersion) && (compareSemver(entry.version, seen) ?? 0) > 0
  )
}

export function latestReleaseUpTo(
  releases: WhatsNewRelease[],
  currentVersion: string
): WhatsNewRelease | null {
  if (!isSemanticVersion(currentVersion)) return null
  return releases.find((entry) => isAtOrBelow(entry.version, currentVersion)) ?? null
}

export function anchorsOf(releases: WhatsNewRelease[]): WhatsNewAnchorId[] {
  const anchors = releases.flatMap((entry) =>
    entry.highlights.flatMap((highlight) =>
      highlight.action && 'anchor' in highlight.action && highlight.action.anchor
        ? [highlight.action.anchor]
        : []
    )
  )
  return [...new Set(anchors)]
}

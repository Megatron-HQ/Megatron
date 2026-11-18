import assert from 'node:assert/strict'
import test from 'node:test'
import { knownScreens, parseOnly, selectScenarios } from './select-scenarios.mjs'

const FIXTURE = [
  { name: 'skill-detail-open', screen: 'skill-detail' },
  { name: 'skill-detail-disabled', screen: 'skill-detail' },
  { name: 'sidebar-nav-hover', screen: 'sidebar' },
  { name: 'sidebar-filter-closes-open-detail', screen: ['sidebar', 'skill-detail'] },
  { name: 'plugin-detail-open', screen: 'plugin-detail' },
  // Stands in for a just-added scenario: tagged, but no baseline captured yet.
  { name: 'plugin-detail-freshly-added', screen: 'plugin-detail' }
]

// Every scenario above has both sizes' baselines except plugin-detail-freshly-added.
const BASELINES = [
  'skill-detail-open--default.png',
  'skill-detail-open--min.png',
  'skill-detail-disabled--default.png',
  'skill-detail-disabled--min.png',
  'sidebar-nav-hover--default.png',
  'sidebar-nav-hover--min.png',
  'sidebar-filter-closes-open-detail--default.png',
  'sidebar-filter-closes-open-detail--min.png',
  'plugin-detail-open--default.png',
  'plugin-detail-open--min.png'
]

const names = (scenarios) => scenarios.map((s) => s.name)

test('parseOnly reads both flag forms and absence', () => {
  assert.equal(parseOnly(['--foo', 'bar']), null)
  assert.deepEqual(parseOnly(['--only', 'skill-detail,sidebar']), ['skill-detail', 'sidebar'])
  assert.deepEqual(parseOnly(['--only=skill-detail']), ['skill-detail'])
  assert.deepEqual(parseOnly(['--only', ' skill-detail , , sidebar ']), ['skill-detail', 'sidebar'])
})

test('parseOnly throws when the flag names nothing', () => {
  assert.throws(() => parseOnly(['--only']), /names no screens/)
  assert.throws(() => parseOnly(['--only', ',']), /names no screens/)
})

test('knownScreens unions string and array tags', () => {
  assert.deepEqual([...knownScreens(FIXTURE)].sort(), ['plugin-detail', 'sidebar', 'skill-detail'])
})

test('no --only returns the full list unchanged', () => {
  assert.equal(selectScenarios(FIXTURE, null, BASELINES), FIXTURE)
})

test('--only filters to scenarios tagged with a named screen', () => {
  // All baselined scenarios except the two sidebar ones are dropped;
  // plugin-detail-freshly-added rides along only because it has no baseline.
  const selected = names(selectScenarios(FIXTURE, ['sidebar'], BASELINES))
  assert.ok(selected.includes('sidebar-nav-hover'))
  assert.ok(selected.includes('sidebar-filter-closes-open-detail'))
  assert.ok(!selected.includes('skill-detail-open'))
  assert.ok(!selected.includes('plugin-detail-open'))
})

test('a multi-screen scenario is selected by either of its screens', () => {
  assert.ok(
    names(selectScenarios(FIXTURE, ['skill-detail'], BASELINES)).includes(
      'sidebar-filter-closes-open-detail'
    )
  )
  assert.ok(
    names(selectScenarios(FIXTURE, ['sidebar'], BASELINES)).includes(
      'sidebar-filter-closes-open-detail'
    )
  )
})

test('a scenario with no baseline is captured despite a non-matching --only', () => {
  assert.deepEqual(names(selectScenarios(FIXTURE, ['skill-detail'], BASELINES)), [
    'skill-detail-open',
    'skill-detail-disabled',
    'sidebar-filter-closes-open-detail',
    'plugin-detail-freshly-added'
  ])
})

test('a baselined scenario on a non-matching screen is excluded', () => {
  assert.ok(
    !names(selectScenarios(FIXTURE, ['plugin-detail'], BASELINES)).includes('sidebar-nav-hover')
  )
})

test('an unknown --only screen throws, naming it and the valid set', () => {
  assert.throws(
    () => selectScenarios(FIXTURE, ['sidbar'], BASELINES),
    (err) => {
      assert.match(err.message, /unknown screen\(s\): sidbar/)
      assert.match(err.message, /valid screens: plugin-detail, sidebar, skill-detail/)
      return true
    }
  )
})

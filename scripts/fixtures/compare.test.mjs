import assert from 'node:assert/strict'
import test from 'node:test'
import { PNG } from 'pngjs'
import {
  compareShots,
  coverageProblems,
  formatReport,
  selectFixtures,
  shotPath,
  unseenEdits
} from './compare.mjs'

function png(width, height, paint = () => [255, 255, 255, 255]) {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) image.data.set(paint(x, y), (y * width + x) * 4)
  }
  return PNG.sync.write(image)
}

test('identical screenshots are not a change', () => {
  assert.equal(compareShots(png(4, 3), png(4, 3)), null)
})

test('the same pixels in a differently encoded file are not a change', () => {
  const image = new PNG({ width: 4, height: 3 })
  image.data.fill(255)
  const recompressed = PNG.sync.write(image, { deflateLevel: 0 })
  assert.notDeepEqual(recompressed, png(4, 3))
  assert.equal(compareShots(png(4, 3), recompressed), null)
})

test('a change reports how many pixels moved and the smallest box around them', () => {
  const after = png(10, 8, (x, y) =>
    (x === 2 && y === 3) || (x === 6 && y === 5) ? [0, 0, 0, 255] : [255, 255, 255, 255]
  )
  const result = compareShots(png(10, 8), after)
  assert.equal(result.pixels, 2)
  assert.deepEqual(result.box, { x: 2, y: 3, width: 5, height: 3 })
})

test('a one-step colour change counts, because both renders come from the same machine', () => {
  const after = png(4, 3, (x, y) =>
    x === 1 && y === 1 ? [255, 255, 254, 255] : [255, 255, 255, 255]
  )
  assert.equal(compareShots(png(4, 3), after).pixels, 1)
})

test('the composite puts before, after and the diff side by side', () => {
  const before = png(4, 3, () => [10, 20, 30, 255])
  const after = png(4, 3, (x, y) => (x === 0 && y === 0 ? [200, 0, 0, 255] : [10, 20, 30, 255]))
  const composite = PNG.sync.read(compareShots(before, after).composite)
  assert.equal(composite.width, 12)
  assert.equal(composite.height, 3)
  const pixel = (x, y) => [...composite.data.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 3)]
  assert.deepEqual(pixel(0, 0), [10, 20, 30])
  assert.deepEqual(pixel(4, 0), [200, 0, 0])
  assert.deepEqual(pixel(5, 0), [10, 20, 30])
  assert.deepEqual(pixel(8, 0), [255, 0, 0])
})

test('a different size is a change over the whole image', () => {
  const result = compareShots(png(4, 3), png(5, 3))
  assert.equal(result.pixels, 15)
  assert.deepEqual(result.box, { x: 0, y: 0, width: 5, height: 3 })
})

test('a shot path keeps the fixture id readable and names its size and theme', () => {
  assert.equal(
    shotPath('views/SkillInventory/RowHover', 'min', 'dark'),
    'views/SkillInventory/RowHover--min-dark.png'
  )
})

test('a filter matches part of an id without regard to case, and no filter matches all', () => {
  const ids = ['App/LoadError', 'views/SkillInventory/RowHover', 'views/SkillInventory/Stale']
  assert.deepEqual(selectFixtures(ids, 'skillinventory/r'), ['views/SkillInventory/RowHover'])
  assert.deepEqual(selectFixtures(ids, undefined), ids)
})

const graph = new Map([
  ['App.fixture.tsx', ['App.tsx', 'fixtures/data.ts']],
  ['App.tsx', ['views/SkillInventory.tsx', 'components/Sidebar.tsx']],
  ['views/SkillInventory.fixture.tsx', ['views/SkillInventory.tsx']],
  ['views/SkillInventory.tsx', ['components/SourceBadge.tsx', 'lib/source-name.ts']],
  ['components/Sidebar.tsx', ['components/ContextBudgetDialog.tsx']]
])
const fixtures = ['App.fixture.tsx', 'views/SkillInventory.fixture.tsx']
const components = [
  'App.tsx',
  'views/SkillInventory.tsx',
  'components/SourceBadge.tsx',
  'components/Sidebar.tsx',
  'components/ContextBudgetDialog.tsx'
]

test('a component reached only through the whole app is not covered', () => {
  const result = coverageProblems({ graph, fixtures, components, pending: [], shell: 'App.tsx' })
  assert.deepEqual(result.uncovered, [
    'components/ContextBudgetDialog.tsx',
    'components/Sidebar.tsx'
  ])
  assert.deepEqual(result.stale, [])
})

test('pending components are allowed to be uncovered', () => {
  const result = coverageProblems({
    graph,
    fixtures,
    components,
    pending: ['components/Sidebar.tsx', 'components/ContextBudgetDialog.tsx'],
    shell: 'App.tsx'
  })
  assert.deepEqual(result, { uncovered: [], stale: [] })
})

test('a pending entry that is now covered, or no longer a component, is stale', () => {
  const result = coverageProblems({
    graph,
    fixtures,
    components,
    pending: [
      'components/Sidebar.tsx',
      'components/ContextBudgetDialog.tsx',
      'components/SourceBadge.tsx',
      'components/Deleted.tsx'
    ],
    shell: 'App.tsx'
  })
  assert.deepEqual(result.stale, ['components/Deleted.tsx', 'components/SourceBadge.tsx'])
})

test('import cycles do not hang the coverage walk', () => {
  const cyclic = new Map([
    ['a.fixture.tsx', ['a.tsx']],
    ['a.tsx', ['b.tsx']],
    ['b.tsx', ['a.tsx']]
  ])
  const result = coverageProblems({
    graph: cyclic,
    fixtures: ['a.fixture.tsx'],
    components: ['a.tsx', 'b.tsx'],
    pending: [],
    shell: 'App.tsx'
  })
  assert.deepEqual(result, { uncovered: [], stale: [] })
})

test('an edit is unseen when every fixture that imports the file rendered the same', () => {
  const result = unseenEdits({
    graph,
    fixtures,
    edited: ['components/SourceBadge.tsx', 'lib/source-name.ts'],
    changed: []
  })
  assert.deepEqual(result, [
    { file: 'components/SourceBadge.tsx', fixtures: 2 },
    { file: 'lib/source-name.ts', fixtures: 2 }
  ])
})

test('an edit is seen when any fixture that imports the file changed, even through the app', () => {
  const result = unseenEdits({
    graph,
    fixtures,
    edited: ['components/SourceBadge.tsx', 'components/Sidebar.tsx'],
    changed: ['App.fixture.tsx']
  })
  assert.deepEqual(result, [])
})

test('an edit no fixture imports, or an edit to a fixture itself, is not reported as unseen', () => {
  const result = unseenEdits({
    graph,
    fixtures,
    edited: ['lib/unused.ts', 'views/SkillInventory.fixture.tsx'],
    changed: []
  })
  assert.deepEqual(result, [])
})

const clean = {
  fixtures: 2,
  shots: [
    { id: 'App/Default', variant: 'default-light', status: 'same' },
    { id: 'App/Default', variant: 'min-light', status: 'same' }
  ],
  errors: [],
  uncovered: [],
  stale: [],
  unseen: []
}

test('a clean run passes and lists no fixture', () => {
  const report = formatReport(clean)
  assert.equal(report.failed, false)
  assert.doesNotMatch(report.text, /App\/Default/)
  assert.match(report.text, /2 fixtures, 2 shots: 0 changed, 0 new, 0 errors/)
})

test('changed and new shots are listed with their evidence but do not fail the run', () => {
  const report = formatReport({
    ...clean,
    shots: [
      {
        id: 'App/Default',
        variant: 'default-light',
        status: 'changed',
        pixels: 812,
        box: { x: 12, y: 40, width: 300, height: 40 },
        composite: '.fixtures/diff/App/Default--default-light.png'
      },
      { id: 'App/Default', variant: 'min-light', status: 'same' },
      {
        id: 'App/New',
        variant: 'default-light',
        status: 'new',
        path: '.fixtures/shots/App/New--default-light.png'
      }
    ]
  })
  assert.equal(report.failed, false)
  assert.match(
    report.text,
    /CHANGED App\/Default default-light: 812 px in 300x40 at 12,40\n {2}\.fixtures\/diff\/App\/Default--default-light\.png/
  )
  assert.match(
    report.text,
    /NEW App\/New default-light\n {2}\.fixtures\/shots\/App\/New--default-light\.png/
  )
  assert.doesNotMatch(report.text, /min-light/)
})

test('an error fails the run and is listed once for the variants that share it', () => {
  const report = formatReport({
    ...clean,
    errors: [
      { id: 'App/Default', variant: 'default-light', message: 'console: boom' },
      { id: 'App/Default', variant: 'min-light', message: 'console: boom' },
      { id: 'App/Default', variant: 'min-light', message: 'horizontal overflow' }
    ]
  })
  assert.equal(report.failed, true)
  assert.match(report.text, /ERROR App\/Default \(default-light, min-light\)\n {2}console: boom/)
  assert.match(report.text, /ERROR App\/Default \(min-light\)\n {2}horizontal overflow/)
})

test('an uncovered component or a stale pending entry fails the run', () => {
  const uncovered = formatReport({ ...clean, uncovered: ['components/Foo.tsx'] })
  assert.equal(uncovered.failed, true)
  assert.match(uncovered.text, /UNCOVERED components\/Foo\.tsx/)
  const stale = formatReport({ ...clean, stale: ['components/Bar.tsx'] })
  assert.equal(stale.failed, true)
  assert.match(stale.text, /STALE components\/Bar\.tsx/)
})

test('an unseen edit is a warning, not a failure', () => {
  const report = formatReport({ ...clean, unseen: [{ file: 'lib/source-name.ts', fixtures: 6 }] })
  assert.equal(report.failed, false)
  assert.match(
    report.text,
    /WARNING lib\/source-name\.ts was edited but none of the 6 fixture files/
  )
})

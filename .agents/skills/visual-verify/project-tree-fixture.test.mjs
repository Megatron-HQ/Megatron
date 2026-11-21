import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectTreeFixture } from './project-tree-fixture.mjs'

// The fixture stands in for main's getPluginDetail (src/main/db/queries.ts), so it must keep that
// contract: PluginDetail's scoping reads every field, and a missing one blanked the whole renderer
// in the plugins-selected-child-detail-removed scenario.
test('plugin detail carries every field getPluginDetail returns, including components', () => {
  for (const mode of ['project-tree-live', 'project-tree-live-removed']) {
    const detail = projectTreeFixture(
      'plugins:detail',
      ['build-tools', 'fixture-market'],
      undefined,
      mode
    )
    assert.equal(detail.plugin.name, 'build-tools')
    assert.deepEqual(detail.components, [])
    assert.deepEqual(detail.skills, [])
    assert.equal(detail.totalInvocations, 0)
  }
})

test('plugin detail is null for a plugin that no longer exists, as getPluginDetail returns', () => {
  assert.equal(
    projectTreeFixture(
      'plugins:detail',
      ['missing-tool', 'fixture-market'],
      undefined,
      'project-tree-live'
    ),
    null
  )
})

// The grant notices only show while a listed install needs a folder no grant covers, and the
// Add folder… result only stays visible while the pick leaves the grants as they were.
test('ungranted mode lists Megatron installs that need a grant beside readable ones', () => {
  const mode = 'project-tree-ungranted'
  const grants = projectTreeFixture('folders:list', [], undefined, mode).map((row) => row.path)
  const installs = projectTreeFixture('plugins:list', [], undefined, mode).flatMap(
    (plugin) => plugin.installs
  )
  const megatron = installs.filter((install) => install.project_path?.endsWith('\\Megatron'))
  const site = installs.filter((install) => install.project_path?.endsWith('\\Megatron-site'))

  assert.deepEqual(grants, ['C:\\Projects\\Megatron HQ\\Megatron-site'])
  assert.ok(megatron.length > 0)
  assert.ok(megatron.every((install) => !install.enablement_known && !install.project_missing))
  assert.ok(site.every((install) => install.enablement_known))
})

test('ungranted mode picks a folder already covered, leaving the grants unchanged', () => {
  const mode = 'project-tree-ungranted'
  const result = projectTreeFixture('folders:pickAndAdd', [], undefined, mode)
  assert.deepEqual(result.folders, projectTreeFixture('folders:list', [], undefined, mode))
  assert.equal(result.skipped.length, 1)
})

test('ungranted mode records more ungranted folders than the five Settings previews', () => {
  const catalog = projectTreeFixture('usage:projects', [], undefined, 'project-tree-ungranted')
  const ungranted = catalog.locations.filter((location) => location.status === 'needs_access')
  assert.ok(ungranted.length > 5)
  assert.equal(catalog.projects.length, catalog.locations.length)
})

// Review… only replaces Add folder… while the visible rows need more than one project's grant.
test('multi mode adds a second ungranted project to the plugins needing a grant', () => {
  const installs = projectTreeFixture(
    'plugins:list',
    [],
    undefined,
    'project-tree-ungranted-multi'
  ).flatMap((plugin) => plugin.installs)
  const blocked = new Set(
    installs
      .filter((install) => install.project_path !== null && !install.enablement_known)
      .map((install) => install.project_path)
  )
  assert.ok(blocked.size > 1)
})

// The Hidden list and Not readable yet must disagree on no row: a hidden folder Claude Code ran in
// leaves Not readable yet, so Show all counts one fewer.
test('ungranted mode hides one recorded folder and one only Claude Code still records', () => {
  const mode = 'project-tree-ungranted'
  const hidden = projectTreeFixture('folders:listHidden', [], undefined, mode)
  const recorded = projectTreeFixture('usage:projects', [], undefined, mode).locations.map(
    (location) => location.path
  )
  assert.equal(hidden.filter((path) => recorded.includes(path)).length, 1)
  assert.equal(hidden.length, 2)
})

test('ungranted mode hides a folder without opening a scan, returning the new list', () => {
  const mode = 'project-tree-ungranted'
  const before = projectTreeFixture('folders:listHidden', [], undefined, mode)
  const after = projectTreeFixture('folders:hide', ['C:\\Clients\\Atlas'], undefined, mode)
  assert.deepEqual(after, [...before, 'C:\\Clients\\Atlas'])
})

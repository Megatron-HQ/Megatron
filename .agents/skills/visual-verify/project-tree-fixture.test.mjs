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

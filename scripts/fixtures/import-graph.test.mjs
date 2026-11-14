import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizePath } from 'vite'
import { coverageProblems } from './compare.mjs'
import { importGraph } from './render.mjs'

for (const placeholderFirst of [true, false]) {
  test(`coverage follows the transformed module when the placeholder is ${placeholderFirst ? 'first' : 'last'}`, async () => {
    const tree = await mkdtemp(join(tmpdir(), 'megatron-fixture-graph-'))
    const source = 'src/renderer/src'
    const path = (file) => `${normalizePath(tree)}/${source}/${file}`
    try {
      await mkdir(join(tree, source, 'fixtures'), { recursive: true })
      for (const file of ['fixtures/gallery.tsx', 'Panel.fixture.tsx', 'Panel.tsx', 'Badge.tsx']) {
        await writeFile(join(tree, source, file), '')
      }
      const placeholder = { id: null, importedModules: new Set() }
      const transformed = {
        id: path('Panel.tsx'),
        importedModules: new Set([{ file: path('Badge.tsx') }])
      }
      const nodes = new Map([
        [path('fixtures/gallery.tsx'), new Set([{ importedModules: new Set() }])],
        [
          path('Panel.fixture.tsx'),
          new Set([{ importedModules: new Set([{ file: path('Panel.tsx') }]) }])
        ],
        [
          path('Panel.tsx'),
          new Set(placeholderFirst ? [placeholder, transformed] : [transformed, placeholder])
        ],
        [path('Badge.tsx'), new Set([{ importedModules: new Set() }])]
      ])
      const server = {
        environments: {
          client: {
            transformRequest: async () => ({ code: '' }),
            moduleGraph: { getModulesByFile: (file) => nodes.get(file) }
          }
        }
      }
      const graph = await importGraph(server, tree)
      const coverage = coverageProblems({ ...graph, pending: [], shell: `${source}/App.tsx` })
      assert.deepEqual(
        coverage.uncovered,
        [],
        'A component rendered through Panel was incorrectly reported as uncovered.'
      )
    } finally {
      await rm(tree, { recursive: true, force: true })
    }
  })
}

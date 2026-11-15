import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stampWhatsNewFile } from './stamp-whats-new.mjs'

const entry = (title) => ({ title, highlights: [{ title: 'New', body: 'Something new.' }] })

function catalogFile(context, catalog) {
  const directory = mkdtempSync(join(tmpdir(), 'megatron-whats-new-stamp-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'whats-new.json')
  writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n')
  return path
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

test('renames the next draft to the version being released, keeping older entries', (context) => {
  const path = catalogFile(context, { next: entry('Draft'), '0.2.0': entry('Old') })
  assert.equal(stampWhatsNewFile(path, '0.3.0'), true)
  assert.deepEqual(read(path), { '0.3.0': entry('Draft'), '0.2.0': entry('Old') })
})

test('puts the stamped release first, so the file reads newest first', (context) => {
  const path = catalogFile(context, { '0.2.0': entry('Old'), next: entry('Draft') })
  stampWhatsNewFile(path, '0.3.0')
  assert.deepEqual(Object.keys(read(path)), ['0.3.0', '0.2.0'])
})

test('leaves a catalog without a draft untouched, for a quiet patch release', (context) => {
  const path = catalogFile(context, { '0.2.0': entry('Old') })
  const before = readFileSync(path, 'utf8')
  assert.equal(stampWhatsNewFile(path, '0.2.1'), false)
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('refuses to overwrite an entry the version already has', (context) => {
  const path = catalogFile(context, { next: entry('Draft'), '0.3.0': entry('Existing') })
  assert.throws(() => stampWhatsNewFile(path, '0.3.0'), /already has a "0\.3\.0" entry/)
  assert.deepEqual(read(path), { next: entry('Draft'), '0.3.0': entry('Existing') })
})

test('refuses a version that is not semver, such as an npm version keyword', (context) => {
  const path = catalogFile(context, { next: entry('Draft') })
  assert.throws(() => stampWhatsNewFile(path, 'minor'), /not a release version/)
})

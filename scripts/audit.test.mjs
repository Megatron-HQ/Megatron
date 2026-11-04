import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockingAdvisories } from './audit.mjs'

const advisory = (name, severity, id) => ({
  name,
  severity,
  title: `${name} issue`,
  url: `https://github.com/advisories/${id}`
})
const report = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities })
const accepted = { 'GHSA-aaaa-aaaa-aaaa': 'fixture reason' }

test('ignores an accepted advisory and the packages that only inherit it', () => {
  const found = blockingAdvisories(
    report({
      minimatch: { via: [advisory('minimatch', 'moderate', 'GHSA-aaaa-aaaa-aaaa')] },
      eslint: { via: ['minimatch'] }
    }),
    accepted
  )
  assert.deepEqual(found, [])
})
test('blocks a moderate or higher advisory that is not accepted, once per advisory', () => {
  const found = blockingAdvisories(
    report({
      undici: { via: [advisory('undici', 'high', 'GHSA-bbbb-bbbb-bbbb')] },
      '@electron/get': { via: ['undici'] },
      'fast-uri': {
        via: [
          advisory('fast-uri', 'moderate', 'GHSA-cccc-cccc-cccc'),
          advisory('fast-uri', 'moderate', 'GHSA-cccc-cccc-cccc')
        ]
      }
    }),
    accepted
  )
  assert.equal(found.length, 2)
  assert.match(found.join('\n'), /GHSA-bbbb-bbbb-bbbb/)
  assert.match(found.join('\n'), /GHSA-cccc-cccc-cccc/)
})
test('ignores advisories below moderate', () => {
  const found = blockingAdvisories(
    report({ 'fast-uri': { via: [advisory('fast-uri', 'low', 'GHSA-dddd-dddd-dddd')] } }),
    accepted
  )
  assert.deepEqual(found, [])
})
test('fails closed when npm did not return an audit report', () => {
  assert.throws(
    () => blockingAdvisories({ error: { code: 'ENOAUDIT', summary: 'offline' } }, accepted),
    /audit report/
  )
})

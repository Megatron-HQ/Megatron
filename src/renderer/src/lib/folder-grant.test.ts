import { describe, expect, it } from 'vitest'
import { skippedGrantMessage } from './folder-grant'

describe('skippedGrantMessage', () => {
  it('says a re-picked folder is already in the list, whatever its spelling', () => {
    expect(skippedGrantMessage({ path: '/work/acme', coveredBy: '/work/acme' })).toBe(
      'acme is already in the list.'
    )
    expect(skippedGrantMessage({ path: 'C:\\Work\\Acme\\', coveredBy: 'c:/work/acme' })).toBe(
      'Acme is already in the list.'
    )
  })

  it('names the granted parent that already includes a picked folder', () => {
    expect(skippedGrantMessage({ path: '/work/acme', coveredBy: '/work' })).toBe(
      'acme is already included in work.'
    )
  })
})

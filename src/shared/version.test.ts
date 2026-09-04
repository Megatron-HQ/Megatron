import { describe, expect, it } from 'vitest'
import { isUpdateAvailable } from './version'

describe('isUpdateAvailable', () => {
  it('detects semver patch, minor, and major updates', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true)
    expect(isUpdateAvailable('1.0.0', '1.1.0')).toBe(true)
    expect(isUpdateAvailable('1.0.0', '2.0.0')).toBe(true)
  })

  it('handles semver with leading v', () => {
    expect(isUpdateAvailable('v1.0.0', 'v1.0.1')).toBe(true)
    expect(isUpdateAvailable('v1.0.0', '1.0.1')).toBe(true)
    expect(isUpdateAvailable('1.0.0', 'v1.0.1')).toBe(true)
  })

  it('does not flag identical versions as update available', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('v1.2.3', '1.2.3')).toBe(false)
  })

  it('does not flag downgrades as update available for semver', () => {
    expect(isUpdateAvailable('1.1.0', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('2.0.0', '1.9.9')).toBe(false)
  })

  it('orders numeric prerelease identifiers numerically', () => {
    expect(isUpdateAvailable('1.0.0-rc.2', '1.0.0-rc.10')).toBe(true)
  })

  it('ignores semver build metadata when deciding whether an update exists', () => {
    expect(isUpdateAvailable('1.0.0+build.1', '1.0.0+build.2')).toBe(false)
  })

  it('detects commit SHA / hash differences', () => {
    expect(isUpdateAvailable('0120fb83da5d', '1dd995193ba2')).toBe(true)
    expect(isUpdateAvailable('0120fb83da5d', '0120fb83da5d')).toBe(false)
  })

  it('detects update when installed is unknown but available is known', () => {
    expect(isUpdateAvailable('unknown', '1.0.0')).toBe(true)
    expect(isUpdateAvailable('unknown', '1dd995193ba2')).toBe(true)
  })

  it('returns false when available is null or unknown', () => {
    expect(isUpdateAvailable('1.0.0', null)).toBe(false)
    expect(isUpdateAvailable('1.0.0', 'unknown')).toBe(false)
    expect(isUpdateAvailable('unknown', null)).toBe(false)
    expect(isUpdateAvailable('unknown', 'unknown')).toBe(false)
  })
})

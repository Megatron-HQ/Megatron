import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import * as security from './ipc-security'

const api = security as typeof security & {
  resolveBundledAsset: (url: string, directory: string) => string | null
}
describe('bundled application protocol', () => {
  it('allows only the main document and flat bundled assets', () => {
    expect(api.resolveBundledAsset('megatron://app/index.html', '/bundle')).toBe(
      resolve('/bundle', 'index.html')
    )
    expect(api.resolveBundledAsset('megatron://app/assets/index-Abc123.js', '/bundle')).toBe(
      resolve('/bundle', 'assets', 'index-Abc123.js')
    )
  })
  it('rejects traversal, arbitrary files and other origins before URL normalization', () => {
    for (const url of [
      'file:///etc/passwd',
      'https://app/index.html',
      'megatron://evil/index.html',
      'megatron://user@app/index.html',
      'megatron://app:123/index.html',
      'megatron://app/assets/../index.html',
      'megatron://app/assets/%2e%2e/index.html',
      'megatron://app/assets/%252e%252e/index.html',
      'megatron://app/assets/a%2f..%2fsecret.json',
      'megatron://app/assets/a\\..\\secret.json',
      'megatron://app/settings.json',
      'megatron://app/assets/secret.env',
      'megatron://app/index.html?file=secret',
      'megatron://app//index.html',
      'megatron://app/assets/a.js/extra'
    ])
      expect(api.resolveBundledAsset(url, '/bundle')).toBeNull()
  })
})

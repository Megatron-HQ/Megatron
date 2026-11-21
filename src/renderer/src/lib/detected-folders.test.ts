import { describe, expect, it } from 'vitest'
import { detectedFolders, ungrantedDetectedFolders } from './detected-folders'

const home = '/Users/me'
const label = (path: string): string => path.split('/').at(-1)!

describe('detectedFolders', () => {
  it('leaves out home, anything above it, and a drive root', () => {
    const rows = detectedFolders(
      [{ path: '/Users/me' }, { path: '/Users' }, { path: '/' }, { path: '/Users/me/acme' }],
      home,
      label
    )
    expect(rows.map((row) => row.path)).toEqual(['/Users/me/acme'])
  })

  it('folds a folder recorded inside another one into it', () => {
    const rows = detectedFolders(
      [{ path: '/Users/me/acme/packages/web' }, { path: '/Users/me/acme' }],
      home,
      label
    )
    expect(rows.map((row) => row.path)).toEqual(['/Users/me/acme'])
  })

  it('drops a worktree together with the folders recorded inside it', () => {
    const rows = detectedFolders(
      [
        { path: '/Users/me/acme' },
        { path: '/Users/me/acme-wt', worktree: true },
        { path: '/Users/me/acme-wt/src' }
      ],
      home,
      label
    )
    expect(rows.map((row) => row.path)).toEqual(['/Users/me/acme'])
  })

  it('sorts by label, numbers in numeric order', () => {
    const rows = detectedFolders(
      [{ path: '/Users/me/app10' }, { path: '/Users/me/Beta' }, { path: '/Users/me/app2' }],
      home,
      label
    )
    expect(rows).toEqual([
      { path: '/Users/me/app2', label: 'app2' },
      { path: '/Users/me/app10', label: 'app10' },
      { path: '/Users/me/Beta', label: 'Beta' }
    ])
  })
})

describe('ungrantedDetectedFolders', () => {
  it('keeps only the folders no grant covers', () => {
    const rows = [
      { path: '/work/acme', label: 'acme' },
      { path: '/work-other/api', label: 'api' },
      { path: '/solo', label: 'solo' }
    ]
    const folders = [
      { path: '/work', granted_at: '2026-11-21T00:00:00.000Z' },
      { path: '/solo/', granted_at: '2026-11-21T00:00:00.000Z' }
    ]
    expect(ungrantedDetectedFolders(rows, folders, [])).toEqual([
      { path: '/work-other/api', label: 'api' }
    ])
  })

  it('leaves out a hidden folder and anything inside one', () => {
    const rows = [
      { path: '/orca/staghorn', label: 'staghorn' },
      { path: '/orca/site/web', label: 'web' },
      { path: '/orca/site-docs', label: 'site-docs' }
    ]
    expect(ungrantedDetectedFolders(rows, [], ['/orca/staghorn/', '/orca/site'])).toEqual([
      { path: '/orca/site-docs', label: 'site-docs' }
    ])
  })
})
